-- Retain efficient subscription lookup after removing daily uniqueness.
create index daily_checkin_runs_subscription_date_idx
  on public.daily_checkin_runs(subscription_id, local_date);

-- Replace windows and confirm the linked caller's choice in one transaction.
-- Lock the user so concurrent saves cannot accumulate windows.
create function public.replace_friendly_call_preferences(target_user uuid, windows jsonb)
returns table(id uuid) language plpgsql security invoker set search_path = '' as $$
declare caller_phone text;
begin
  if jsonb_typeof(windows) is distinct from 'array' or jsonb_array_length(windows) not between 1 and 28 then
    raise exception 'Provide between 1 and 28 calling windows';
  end if;
  select u.phone_number into strict caller_phone from public.users u where u.id=target_user for update;
  delete from public.calling_preferences p where p.user_id=target_user;
  return query insert into public.calling_preferences(user_id,weekdays,hour_range_from,hour_range_to,agent_id,agent_phone_number)
    select target_user,w->>'weekdays',w->>'hour_range_from',w->>'hour_range_to',w->>'agent_id',w->>'agent_phone_number'
    from jsonb_array_elements(windows) w returning calling_preferences.id;
  insert into public.daily_checkin_preferences(subscription_id,enabled,consent_senior_phone,calls_consent_at,schedule_confirmed_at)
    select s.id,true,caller_phone,now(),now() from public.subscriptions s
    where s.senior_phone_number=caller_phone and s.status='active'
    on conflict(subscription_id) do update set enabled=true,consent_senior_phone=excluded.consent_senior_phone,
      calls_consent_at=excluded.calls_consent_at,schedule_confirmed_at=excluded.schedule_confirmed_at,updated_at=now();
end;
$$;
revoke all on function public.replace_friendly_call_preferences(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.replace_friendly_call_preferences(uuid,jsonb) to service_role;
