alter table public.daily_checkin_preferences add column digest_timezone text;
create table public.family_daily_digests (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.subscriptions(id) on delete cascade,
 senior_phone text not null, recipient_phone text not null,
 local_date date not null, timezone text not null,
 window_start timestamptz not null, window_end timestamptz not null,
 status text not null default 'building' check(status in ('building','sending','submitted','unknown','skipped')),
 claim_token uuid not null default gen_random_uuid(), locked_at timestamptz not null default now(),
 consent_context text not null, message text, safe_events jsonb,
 message_sid text, created_at timestamptz not null default now(),
 unique(subscription_id,local_date), check(window_end>window_start)
);
create table public.family_digest_events (
 call_id text primary key,
 subscription_id uuid not null references public.subscriptions(id) on delete cascade,
 senior_phone text not null,
 kind text not null check(kind in ('conversation','medication','water','reminder')),
 answered boolean not null,
 ended_at timestamptz not null, available_at timestamptz not null default now(),
 digest_id uuid references public.family_daily_digests(id),
 check(available_at>=ended_at)
);
create index family_digest_events_pending_idx on public.family_digest_events(subscription_id,available_at) where digest_id is null;
create index family_digest_events_digest_idx on public.family_digest_events(digest_id);
create index family_digest_events_subscription_idx on public.family_digest_events(subscription_id);
alter table public.family_daily_digests enable row level security;
alter table public.family_digest_events enable row level security;
revoke all on public.family_daily_digests,public.family_digest_events from public,anon,authenticated;
grant all on public.family_daily_digests,public.family_digest_events to service_role;

create function public.claim_family_daily_digest(p_subscription_id uuid,p_timezone text,p_consent_context text,p_now timestamptz default now())
returns setof public.family_daily_digests language plpgsql security invoker set search_path=public as $$
declare
 d public.family_daily_digests; sub public.subscriptions;
 local_day date; cutoff timestamptz; window_begin timestamptz; previous_end timestamptz;
begin
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid digest timezone'; end if;
 perform pg_advisory_xact_lock(hashtextextended('family-digest:'||p_subscription_id::text,0));
 select * into sub from subscriptions where id=p_subscription_id;
 if not exists(select 1 from daily_checkin_preferences p where p.subscription_id=p_subscription_id
   and p.enabled and p.report_channel='messages' and p.recipient_consent_at is not null
   and p.calls_consent_at is not null and p.reports_consent_at is not null
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
 if not exists(select 1 from family_digest_events where subscription_id=p_subscription_id
   and senior_phone=sub.senior_phone_number and digest_id is null and available_at>=window_begin and available_at<cutoff) then return; end if;
 insert into family_daily_digests(subscription_id,senior_phone,recipient_phone,local_date,timezone,window_start,window_end,consent_context,locked_at)
 values(p_subscription_id,sub.senior_phone_number,sub.buyer_phone_number,local_day,p_timezone,window_begin,cutoff,p_consent_context,p_now) returning * into d;
 update family_digest_events set digest_id=d.id where subscription_id=p_subscription_id and senior_phone=sub.senior_phone_number
   and digest_id is null and available_at>=window_begin and available_at<cutoff;
 return next d;
end $$;
revoke all on function public.claim_family_daily_digest(uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_family_daily_digest(uuid,text,text,timestamptz) to service_role;
