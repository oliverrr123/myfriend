-- Keep provider acceptance distinct from actual SMS delivery.
alter table public.family_messages add column outbound_message_id text;
create index family_messages_outbound on public.family_messages(outbound_message_id)
  where outbound_message_id is not null;

-- Append one receipt per status: callbacks may be duplicated or out of order,
-- and can arrive before the sender has saved Twilio's message SID.
create table public.family_sms_delivery_events (
  message_sid text not null check (message_sid ~ '^SM[0-9a-fA-F]{32}$'),
  status text not null check (status in ('accepted','scheduled','queued','sending','sent','delivered','undelivered','failed','canceled','read')),
  error_code text,
  received_at timestamptz not null default now(),
  primary key (message_sid,status)
);
alter table public.family_sms_delivery_events enable row level security;
revoke all on public.family_sms_delivery_events from public,anon,authenticated;
grant all on public.family_sms_delivery_events to service_role;
