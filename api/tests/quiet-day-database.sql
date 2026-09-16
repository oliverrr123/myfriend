-- Run after the feature migration inside a transaction that is ALWAYS rolled back.
do $$
declare u uuid; b uuid; s uuid; p public.daily_checkin_preferences; q jsonb; n integer; digest public.family_daily_digests; prior uuid;
begin
 insert into public.users(phone_number,timezone) values('+12025550171','UTC') returning id into u;
 insert into public.users(phone_number,timezone) values('+12025550172','UTC') returning id into b;
 insert into public.subscriptions(buyer_phone_number,senior_phone_number,buyer_user_id,senior_user_id,status)
 values('+12025550172','+12025550171',b,u,'active') returning id into s;
 insert into public.daily_checkin_preferences(subscription_id,enabled,report_channel,recipient_consent_at,reports_consent_at,calls_consent_at,consent_senior_phone,schedule_confirmed_at,timezone,digest_timezone,call_status,call_status_changed_at)
 values(s,true,'messages','2026-09-01','2026-09-01','2026-09-01','+12025550171','2026-09-01','UTC','UTC','accepted','2026-09-01');
 insert into public.calling_preferences(user_id,weekdays,hour_range_from,hour_range_to) values(u,'1,2,3,4,5','10:00','11:00');
 q=public.family_quiet_day_context(s,'2026-09-18T20:00Z','2026-09-19T20:00Z');
 assert q->>'kind'='off_day','Confirmed weekdays explain an off day';
 assert q->'weekdays'='[1,2,3,4,5]'::jsonb,'All confirmed weekdays retained';
 assert public.family_quiet_day_context(s,'2026-09-17T20:00Z','2026-09-18T20:00Z') is null,'A due call with no activity is NOT a preference explanation';
 update public.calling_preferences set hour_range_from='18:00',hour_range_to='21:00' where user_id=u;
 assert public.family_quiet_day_context(s,'2026-09-18T20:00Z','2026-09-19T20:00Z') is null,'Previous-evening window overlaps Saturday report';
 update public.calling_preferences set hour_range_from='10:00',hour_range_to='11:00' where user_id=u;
 update public.daily_checkin_preferences set call_status='not_set',calls_consent_at=null where subscription_id=s;
 assert public.family_quiet_day_context(s,'2026-09-18T20:00Z','2026-09-19T20:00Z') is null,'Missing choice is not refusal';
 perform public.set_family_call_choices(s,'+12025550171','declined',null,null);
 select * into p from public.daily_checkin_preferences where subscription_id=s;
 assert p.call_status='declined' and p.calls_consent_at is null and p.reports_consent_at is not null,'Decline preserves independent sharing';
 prior=p.call_preference_version;
 perform public.set_family_call_choices(s,'+12025550171','declined',null,null);
 select * into p from public.daily_checkin_preferences where subscription_id=s;
 assert p.call_preference_version=prior,'Repeated confirmation does not repeat notice';
 select * into digest from public.claim_family_daily_digest(s,'UTC','test-consent','2026-09-19T20:01Z');
 assert digest.quiet_context->>'kind'='declined','No-call decline creates evening digest';
 assert digest.preference_notice_version=prior,'Notice tied to exact choice';
 select count(*) into n from public.claim_family_daily_digest(s,'UTC','test-consent','2026-09-19T20:02Z');
 assert n=0,'Concurrent worker cannot claim same digest';
 update public.family_daily_digests set status='submitted' where id=digest.id;
 select count(*) into n from public.claim_family_daily_digest(s,'UTC','test-consent','2026-09-20T20:01Z');
 assert n=0,'Refusal notice is not repeated the next day';
 perform public.set_family_call_choices(s,'+12025550171',null,false,null);
 select * into p from public.daily_checkin_preferences where subscription_id=s;
 assert p.call_status='declined' and p.reports_consent_at is null,'Sharing revocation preserves call choice';
 assert public.family_quiet_day_context(s,'2026-09-19T20:00Z','2026-09-20T20:00Z') is null,'No notice without sharing consent';
 perform public.set_family_call_choices(s,'+12025550171','paused',true,'2026-09-22T10:00Z');
 q=public.family_quiet_day_context(s,'2026-09-19T20:00Z','2026-09-20T20:00Z');
 assert q->>'kind'='paused' and q->>'pause_until' is not null,'Dated pause has structured explanation';
 assert public.family_quiet_day_context(s,'2026-09-22T20:00Z','2026-09-23T20:00Z') is null,'Expired pause cannot explain a new quiet day';
 perform public.replace_friendly_call_preferences(u,'[{"weekdays":"1,2,3,4,5","hour_range_from":"10:00","hour_range_to":"11:00"}]');
 select * into p from public.daily_checkin_preferences where subscription_id=s;
 assert p.call_status='accepted' and p.call_pause_until is null and p.reports_consent_at is not null,'Confirmed new schedule resumes calls without changing sharing';
 assert p.call_preference_version<>prior,'Schedule creates fresh preference version';
 -- Recipient-local daily cutoff crosses the fall DST transition without inventing a call.
 update public.users set timezone='Europe/Prague' where id=u;
 select * into digest from public.claim_family_daily_digest(s,'Europe/Prague','test-consent','2026-10-25T19:01Z');
 assert digest.quiet_context->>'kind'='off_day','DST off day uses confirmed weekdays';
 assert digest.window_end-digest.window_start=interval '25 hours','DST reporting window is 25 hours';
 update public.family_daily_digests set status='submitted' where id=digest.id;
 -- Failed validation is atomic and must preserve the saved choice.
 begin
  perform public.set_family_call_choices(s,'+12025550999','declined',false,null);
  raise exception 'Wrong caller accepted';
 exception when others then
  if sqlerrm='Wrong caller accepted' then raise; end if;
 end;
 select * into p from public.daily_checkin_preferences where subscription_id=s;
 assert p.call_status='accepted' and p.reports_consent_at is not null,'Wrong caller changed nothing';
 assert not has_function_privilege('anon','public.set_family_call_choices(uuid,text,text,boolean,timestamptz)','EXECUTE'),'Anonymous writes forbidden';
 assert not has_function_privilege('authenticated','public.family_quiet_day_context(uuid,timestamptz,timestamptz)','EXECUTE'),'Client cannot read private preferences';
end $$;
select 'quiet-day database assertions passed; transaction will roll back' as result;
