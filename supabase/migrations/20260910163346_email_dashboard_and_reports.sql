alter table public.daily_checkin_preferences
  drop constraint daily_checkin_preferences_report_channel_check;
alter table public.daily_checkin_preferences
  add constraint daily_checkin_preferences_report_channel_check
  check (report_channel in ('none', 'sms', 'messages', 'email'));

create table public.email_login_attempts (
  bucket_key text primary key,
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0)
);
alter table public.email_login_attempts enable row level security;
revoke all on public.email_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.email_login_attempts to service_role;

create function public.claim_email_login_attempt(bucket_key text, maximum integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  if maximum < 1 or maximum > 100 or length(bucket_key) <> 64 then
    return false;
  end if;
  delete from public.email_login_attempts where window_start < now() - interval '1 day';
  insert into public.email_login_attempts as limits (bucket_key, window_start, attempts)
  values (claim_email_login_attempt.bucket_key, now(), 1)
  on conflict on constraint email_login_attempts_pkey do update set
    attempts = case when limits.window_start <= now() - interval '1 hour' then 1 else limits.attempts + 1 end,
    window_start = case when limits.window_start <= now() - interval '1 hour' then now() else limits.window_start end
  returning attempts into used;
  return used <= maximum;
end;
$$;
revoke all on function public.claim_email_login_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.claim_email_login_attempt(text, integer) to service_role;
