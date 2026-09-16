-- Family messaging is isolated from the loved one's voice conversations.
create table public.family_message_connections (
  subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
  provider text not null check (provider in ('photon','twilio')),
  sender_phone text not null,
  route jsonb not null default '{}'::jsonb,
  opted_out boolean not null default false,
  pending_action jsonb,
  pending_code text,
  pending_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.family_messages (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('photon','twilio')),
  provider_message_id text not null,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  sender_phone text not null,
  route jsonb not null default '{}'::jsonb,
  body text not null check (length(body) <= 4000),
  reply text,
  sharing_context text,
  status text not null default 'queued' check (status in ('queued','processing','sending','sent','failed','unknown','skipped')),
  attempts integer not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider, provider_message_id)
);
create index family_messages_queue on public.family_messages(created_at) where status = 'queued';
create index family_messages_history on public.family_messages(subscription_id,created_at desc);
alter table public.family_message_connections enable row level security;
alter table public.family_messages enable row level security;
revoke all on public.family_message_connections, public.family_messages from anon,authenticated;
grant all on public.family_message_connections, public.family_messages to service_role;

create function public.claim_family_message() returns setof public.family_messages
language plpgsql security definer set search_path = public as $$
declare candidate uuid;
begin
  -- Recover work interrupted before delivery; never retry an uncertain send.
  update family_messages set status='queued',locked_at=null
    where status='processing' and locked_at < now()-interval '2 minutes';
  select m.id into candidate from family_messages m
    where m.status='queued' and m.attempts < 3
    and not exists(select 1 from family_messages p where p.subscription_id=m.subscription_id and p.status in ('processing','sending'))
    order by m.created_at for update skip locked limit 1;
  if candidate is null then return; end if;
  -- Serialize claims across workers per account, including simultaneous selections.
  if not pg_try_advisory_xact_lock(hashtextextended((select subscription_id::text from family_messages where id=candidate),0)) then return; end if;
  if exists(select 1 from family_messages p where p.subscription_id=(select subscription_id from family_messages where id=candidate) and p.status in ('processing','sending')) then return; end if;
  return query update family_messages set status='processing',locked_at=now(),attempts=attempts+1 where id=candidate returning *;
end $$;
revoke all on function public.claim_family_message() from public,anon,authenticated;
grant execute on function public.claim_family_message() to service_role;

alter table public.daily_checkin_preferences drop constraint daily_checkin_preferences_report_channel_check;
alter table public.daily_checkin_preferences add constraint daily_checkin_preferences_report_channel_check check (report_channel in ('none','sms','messages'));
