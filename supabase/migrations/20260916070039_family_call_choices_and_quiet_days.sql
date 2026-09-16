-- Explicit caller choices: never interpret missing consent as a refusal.
alter table public.daily_checkin_preferences
 add column call_status text not null default 'not_set' check(call_status in ('not_set','accepted','declined','paused')),
 add column call_pause_until timestamptz,
 add column call_status_changed_at timestamptz,
 add column call_preference_version uuid not null default gen_random_uuid(),
 add constraint family_pause_only_when_paused check(call_pause_until is null or call_status='paused');
update public.daily_checkin_preferences p set call_status='accepted',call_status_changed_at=calls_consent_at
 from public.subscriptions s where s.id=p.subscription_id and p.calls_consent_at is not null
 and p.consent_senior_phone=s.senior_phone_number;
alter table public.family_daily_digests add column quiet_context jsonb, add column preference_notice_version uuid;
create unique index family_preference_notice_once on public.family_daily_digests(subscription_id,preference_notice_version)
 where preference_notice_version is not null and status in ('building','sending','submitted','unknown');

create function public.set_family_call_choices(p_subscription_id uuid,p_phone text,p_call_status text,p_allow_reports boolean,p_pause_until timestamptz default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.daily_checkin_preferences; s public.subscriptions; changed boolean; old_phone text;
begin
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.status is distinct from 'active' or s.senior_phone_number is distinct from p_phone then raise exception 'Only the active linked caller can choose'; end if;
 if p_call_status is not null and p_call_status not in ('accepted','declined','paused') then raise exception 'Invalid call status'; end if;
 if p_call_status is null and p_allow_reports is null then raise exception 'No explicit choice'; end if;
 if p_pause_until is not null and (p_call_status is distinct from 'paused' or p_pause_until<=now()) then raise exception 'Invalid pause end'; end if;
 select * into p from public.daily_checkin_preferences where subscription_id=p_subscription_id for update;
 if not found then raise exception 'No family request exists'; end if;
 old_phone=p.consent_senior_phone;
 -- A new linked caller must never inherit the previous person's choices.
 if old_phone is distinct from p_phone then
  p.call_status='not_set'; p.call_pause_until=null; p.calls_consent_at=null; p.reports_consent_at=null; p.schedule_confirmed_at=null;
 end if;
 changed=p_call_status is not null and (p.call_status is distinct from p_call_status or p.call_pause_until is distinct from p_pause_until);
 if p_call_status is not null then
  p.call_status=p_call_status; p.call_pause_until=p_pause_until;
  if p_call_status='accepted' then p.calls_consent_at=coalesce(p.calls_consent_at,now()); end if;
  if p_call_status='declined' then p.calls_consent_at=null; end if;
 end if;
 if p_allow_reports is not null then p.reports_consent_at=case when p_allow_reports then coalesce(p.reports_consent_at,now()) else null end; end if;
 update public.daily_checkin_preferences set
  consent_senior_phone=p_phone,call_status=p.call_status,call_pause_until=p.call_pause_until,
  calls_consent_at=p.calls_consent_at,reports_consent_at=p.reports_consent_at,schedule_confirmed_at=p.schedule_confirmed_at,
  call_status_changed_at=case when changed or old_phone is distinct from p_phone then now() else call_status_changed_at end,
  call_preference_version=case when changed or old_phone is distinct from p_phone then gen_random_uuid() else call_preference_version end,
  updated_at=now() where subscription_id=p_subscription_id;
 return jsonb_build_object('call_status',p.call_status,'pause_until',p.call_pause_until,'sharing_allowed',p.reports_consent_at is not null);
end $$;
revoke all on function public.set_family_call_choices(uuid,text,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.set_family_call_choices(uuid,text,text,boolean,timestamptz) to service_role;

-- Schedule writes are explicit accepted choices, and invalidate stale quiet-day snapshots.
create or replace function public.replace_friendly_call_preferences(target_user uuid, windows jsonb)
returns table(id uuid) language plpgsql security invoker set search_path='' as $$
declare caller_phone text; caller_timezone text;
begin
 if jsonb_typeof(windows) is distinct from 'array' or jsonb_array_length(windows) not between 1 and 28 then raise exception 'Provide between 1 and 28 calling windows'; end if;
 select u.phone_number,coalesce(u.timezone,'UTC') into strict caller_phone,caller_timezone from public.users u where u.id=target_user for update;
 delete from public.calling_preferences p where p.user_id=target_user;
 return query insert into public.calling_preferences(user_id,weekdays,hour_range_from,hour_range_to,agent_id,agent_phone_number)
 select target_user,w->>'weekdays',w->>'hour_range_from',w->>'hour_range_to',w->>'agent_id',w->>'agent_phone_number' from jsonb_array_elements(windows) w returning calling_preferences.id;
 insert into public.daily_checkin_preferences(subscription_id,enabled,consent_senior_phone,calls_consent_at,schedule_confirmed_at,timezone,call_status,call_status_changed_at)
 select s.id,true,caller_phone,now(),now(),caller_timezone,'accepted',now() from public.subscriptions s where s.senior_phone_number=caller_phone and s.status='active'
 on conflict(subscription_id) do update set enabled=true,consent_senior_phone=excluded.consent_senior_phone,
 calls_consent_at=excluded.calls_consent_at,schedule_confirmed_at=excluded.schedule_confirmed_at,timezone=excluded.timezone,
 call_status='accepted',call_pause_until=null,call_status_changed_at=now(),call_preference_version=gen_random_uuid(),updated_at=now();
end $$;
revoke all on function public.replace_friendly_call_preferences(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_friendly_call_preferences(uuid,jsonb) to service_role;

-- A snapshot of a confirmed choice; no free-text reasons or private conversation content.
create function public.family_quiet_day_context(p_subscription_id uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.daily_checkin_preferences; s public.subscriptions; pref record; local_day date;
 days integer[]='{}'; d integer; starts timestamptz; ends timestamptz; tz text; base jsonb; any_window boolean=false;
begin
 select * into p from public.daily_checkin_preferences where subscription_id=p_subscription_id;
 select * into s from public.subscriptions where id=p_subscription_id;
 if not p.enabled or s.status is distinct from 'active' or p.consent_senior_phone is distinct from s.senior_phone_number
  or p.reports_consent_at is null or p.report_channel<>'messages' or p.recipient_consent_at is null
  or p.call_status_changed_at is null or p.call_status_changed_at>=p_end then return null; end if;
 base=jsonb_build_object('version',p.call_preference_version,'status',p.call_status);
 if p.call_status='declined' or (p.call_status='paused' and (p.call_pause_until is null or p.call_pause_until>p_start)) then
  if p.call_status='paused' and p.call_pause_until is not null and p.call_pause_until<=p_end then return null; end if;
  if exists(select 1 from public.family_daily_digests where subscription_id=p_subscription_id
   and preference_notice_version=p.call_preference_version and status in ('building','sending','submitted','unknown')) then return null; end if;
  return base||jsonb_build_object('kind',p.call_status,'pause_until',p.call_pause_until,'timezone',p.timezone);
 end if;
 if p.call_status not in ('accepted','paused') or p.calls_consent_at is null or p.schedule_confirmed_at is null
  or p.schedule_confirmed_at>p_start or p.call_status_changed_at>p_start then return null; end if;
 select u.timezone into tz from public.users u where u.id=s.senior_user_id;
 if tz is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=tz) then return null; end if;
 for pref in select * from public.calling_preferences where user_id=s.senior_user_id loop
  if pref.weekdays is null or pref.weekdays !~ '^[0-6](,[0-6])*$' or pref.hour_range_from is null or pref.hour_range_to is null then return null; end if;
  any_window=true;
  foreach d in array string_to_array(pref.weekdays,',')::integer[] loop
   if not d=any(days) then days=array_append(days,d); end if;
  end loop;
  -- Include yesterday for windows crossing midnight. Timestamp conversion handles DST.
  for local_day in select x::date from generate_series(((p_start at time zone tz)::date-1)::timestamp,((p_end at time zone tz)::date)::timestamp,interval '1 day') x loop
   if extract(dow from local_day)::integer=any(string_to_array(pref.weekdays,',')::integer[]) then
    starts=(local_day+pref.hour_range_from::time) at time zone tz;
    ends=(local_day+case when pref.hour_range_to::time<=pref.hour_range_from::time then 1 else 0 end+pref.hour_range_to::time) at time zone tz;
    if starts<p_end and ends>p_start then return null; end if;
   end if;
  end loop;
 end loop;
 if not any_window then return null; end if;
 select array_agg(x order by x) into days from unnest(days) x;
 return base||jsonb_build_object('kind','off_day','weekdays',to_jsonb(days),'timezone',tz);
end $$;
revoke all on function public.family_quiet_day_context(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.family_quiet_day_context(uuid,timestamptz,timestamptz) to service_role;

create or replace function public.claim_family_daily_digest(p_subscription_id uuid,p_timezone text,p_consent_context text,p_now timestamptz default now())
returns setof public.family_daily_digests language plpgsql security invoker set search_path=public as $$
declare
 d public.family_daily_digests; sub public.subscriptions;
 local_day date; cutoff timestamptz; window_begin timestamptz; previous_end timestamptz; context jsonb; has_events boolean;
begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid digest timezone'; end if;
 perform pg_advisory_xact_lock(hashtextextended('family-digest:'||p_subscription_id::text,0));
 select * into sub from subscriptions where id=p_subscription_id;
 if not exists(select 1 from daily_checkin_preferences p where p.subscription_id=p_subscription_id
   and p.enabled and p.report_channel='messages' and p.recipient_consent_at is not null
   and p.reports_consent_at is not null
   and p.consent_senior_phone=sub.senior_phone_number and sub.status='active') then return; end if;
 local_day=(p_now at time zone p_timezone)::date;
 if (p_now at time zone p_timezone)::time < time '20:00' then local_day=local_day-1; end if;
 cutoff=(local_day+time '20:00') at time zone p_timezone;
 window_begin=((local_day-1)+time '20:00') at time zone p_timezone;
 -- Interrupted/ambiguous sends are never retried.
 update family_daily_digests set status='unknown' where subscription_id=p_subscription_id and status='sending' and locked_at<p_now-interval '10 minutes';
 -- Resume unfinished generation before opening a later window.
 select * into d from family_daily_digests where subscription_id=p_subscription_id and status='building' order by window_end limit 1;
 if found then
   if d.locked_at>p_now-interval '10 minutes' then return; end if;
   update family_daily_digests set claim_token=gen_random_uuid(),locked_at=p_now where id=d.id returning * into d;
   return next d; return;
 end if;
 if exists(select 1 from family_daily_digests where subscription_id=p_subscription_id and (local_date=local_day or window_end>=cutoff)) then return; end if;
 select max(window_end) into previous_end from family_daily_digests where subscription_id=p_subscription_id;
 -- Clock/timezone changes cannot replay events or overlap already handled windows.
 window_begin=greatest(window_begin,coalesce(previous_end,window_begin));
 select exists(select 1 from family_digest_events where subscription_id=p_subscription_id
   and senior_phone=sub.senior_phone_number and digest_id is null and available_at>=window_begin and available_at<cutoff) into has_events;
 context=public.family_quiet_day_context(p_subscription_id,window_begin,cutoff);
 if has_events and context->>'kind'='off_day' then context=null; end if;
 if not has_events and context is null then return; end if;
 insert into family_daily_digests(subscription_id,senior_phone,recipient_phone,local_date,timezone,window_start,window_end,consent_context,locked_at,quiet_context,preference_notice_version)
 values(p_subscription_id,sub.senior_phone_number,sub.buyer_phone_number,local_day,p_timezone,window_begin,cutoff,p_consent_context,p_now,context,case when context->>'kind' in ('declined','paused') then (context->>'version')::uuid else null end) returning * into d;
 update family_digest_events set digest_id=d.id where subscription_id=p_subscription_id and senior_phone=sub.senior_phone_number
   and digest_id is null and available_at>=window_begin and available_at<cutoff;
 return next d;
end $$;
revoke all on function public.claim_family_daily_digest(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_family_daily_digest(uuid,text,text,timestamptz) to service_role;
