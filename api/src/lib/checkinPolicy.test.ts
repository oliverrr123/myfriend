import { sharedReportText } from './familyAssistantPolicy';
import { test } from "node:test";
import assert from "node:assert/strict";
import { canCheckIn, canShareReport, parseCheckinPreferences } from "./checkinPolicy";
const p={enabled:true,timezone:"Europe/Prague",call_hour:10,report_channel:"messages" as const,consent_senior_phone:"+12025550189",calls_consent_at:"2026-09-08",reports_consent_at:"2026-09-08"};
const sub={status:"active",senior_phone_number:"+12025550189"};
test("calls require consent from the current senior and active billing",()=>{
 assert.equal(canCheckIn(p,sub),true);
 assert.equal(canCheckIn({...p,calls_consent_at:null},sub),false);
 assert.equal(canCheckIn(p,{...sub,status:"past_due"}),false);
 assert.equal(canCheckIn(p,{...sub,senior_phone_number:"+12025550190"}),false);
 assert.equal(canCheckIn({...p,enabled:false},sub),false);
});
test("report sharing is a separate choice and is independent from delivery preference",()=>{
 assert.equal(canShareReport({...p,reports_consent_at:null},sub),false);
 assert.equal(canShareReport({...p,report_channel:"none"},sub),true);
});
test("timezones, hours and channels are validated",()=>{
 assert.ok(parseCheckinPreferences(p));
 for(const bad of [{call_hour:25},{call_hour:9.5},{timezone:"Moon/Base"},{report_channel:"imessage"},{enabled:"true"}]) assert.equal(parseCheckinPreferences({...p,...bad}),null);
});
test("missing check-ins are not presented as an assessment of wellbeing",()=>{
 assert.match(sharedReportText(false,null),/doesn't tell us how they're doing/);
 assert.doesNotMatch(sharedReportText(true,"They enjoyed their morning walk."),/morning walk/);
});
import { canPlaceFamilyCall } from './checkinPolicy';

test('family dialing requires rollout, an active plan, current consent, and confirmed windows', () => {
 const sub = { status: 'active', senior_phone_number: '+12025550111' };
 const p = { enabled: true, timezone: 'UTC', call_hour: 10, report_channel: 'none' as const, consent_senior_phone: sub.senior_phone_number, calls_consent_at: 'now', schedule_confirmed_at: 'now' };
 assert.equal(canPlaceFamilyCall(p, sub, true), true);
 assert.equal(canPlaceFamilyCall(p, sub, false), false);
 assert.equal(canPlaceFamilyCall({ ...p, enabled: false }, sub, true), false);
 assert.equal(canPlaceFamilyCall({ ...p, schedule_confirmed_at: null }, sub, true), false);
 assert.equal(canPlaceFamilyCall({ ...p, consent_senior_phone: '+12025550112' }, sub, true), false);
 assert.equal(canPlaceFamilyCall(p, { ...sub, status: 'canceled' }, true), false);
 assert.equal(canPlaceFamilyCall(null, sub, true), false);
});
