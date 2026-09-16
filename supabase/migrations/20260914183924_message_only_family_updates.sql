-- Preserve existing SMS opt-ins under the canonical channel name. Email
-- recipients must explicitly opt into text messages; never convert consent.
update public.daily_checkin_preferences
set report_channel = 'messages'
where report_channel = 'sms';

update public.daily_checkin_preferences
set report_channel = 'none', recipient_consent_at = null
where report_channel = 'email';

alter table public.daily_checkin_preferences
  drop constraint if exists daily_checkin_preferences_report_channel_check;
alter table public.daily_checkin_preferences
  add constraint daily_checkin_preferences_report_channel_check
  check (report_channel in ('none', 'messages'));
