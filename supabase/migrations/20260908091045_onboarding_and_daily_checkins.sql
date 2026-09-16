-- Server-only data. The website talks to the authenticated MyFriend API.
create table public.onboarding_submissions (
  checkout_session_id text primary key,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  billing_plan text not null check (billing_plan in ('monthly', 'annual')),
  livemode boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.onboarding_submissions(subscription_id);

create table public.daily_checkin_preferences (
  subscription_id uuid primary key references public.subscriptions(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'America/New_York',
  call_hour integer not null default 10 check (call_hour between 8 and 20),
  report_channel text not null default 'none' check (report_channel in ('none', 'sms')),
  recipient_consent_at timestamptz,
  consent_senior_phone text,
  calls_consent_at timestamptz,
  reports_consent_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.daily_checkin_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  senior_phone text not null,
  local_date date not null,
  call_id text unique,
  status text not null default 'calling' check (status in ('calling', 'completed', 'not_confirmed', 'failed', 'unknown')),
  summary text,
  duration_seconds integer,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sending', 'submitted', 'failed', 'unknown', 'skipped')),
  message_sid text,
  error_code text,
  created_at timestamptz not null default now(),
  unique(subscription_id, local_date)
);
alter table public.onboarding_submissions enable row level security;
alter table public.daily_checkin_preferences enable row level security;
alter table public.daily_checkin_runs enable row level security;
revoke all on public.onboarding_submissions, public.daily_checkin_preferences, public.daily_checkin_runs from anon, authenticated;
grant all on public.onboarding_submissions, public.daily_checkin_preferences, public.daily_checkin_runs to service_role;
