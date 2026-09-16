-- A family member may suggest availability, but only the linked loved one's
-- voice-agent tool writes the authoritative calling_preferences rows.
alter table public.daily_checkin_preferences
  add column if not exists proposed_schedule jsonb,
  add column if not exists schedule_confirmed_at timestamptz;

alter table public.daily_checkin_preferences
  add constraint daily_checkin_preferences_proposed_schedule_object
  check (proposed_schedule is null or jsonb_typeof(proposed_schedule) = 'object');

-- Friendly-call preferences can contain more than one window per day. Each
-- resulting conversation is already deduplicated by its unique call_id.
alter table public.daily_checkin_runs
  drop constraint if exists daily_checkin_runs_subscription_id_local_date_key;

comment on column public.daily_checkin_preferences.proposed_schedule is
  'Family-requested availability shown to the loved one as a suggestion; never an active calling schedule.';
comment on column public.daily_checkin_preferences.schedule_confirmed_at is
  'When the linked loved one last made their spoken friendly-call schedule authoritative.';
