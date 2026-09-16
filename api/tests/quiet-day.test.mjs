import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],console});return exports;}
const policy=load('src/lib/checkinPolicy.ts'),daily=load('src/lib/dailyDigestPolicy.ts'),voice=load('src/lib/digestVoice.ts',{'./dailyDigestPolicy':daily}),{parseCallChoice,quietDayMessage}=load('src/lib/quietDayDigest.ts',{'./digestVoice':voice});
const now=new Date('2026-09-16T12:00:00Z');
test('missing choice stays unknown; explicit false is declined and does not revoke sharing',()=>{assert.equal(parseCallChoice({},now),null);const x=parseCallChoice({allow_calls:false},now);assert.equal(x.status,'declined');assert.equal(x.reports,null);assert.equal(parseCallChoice({allow_reports:true},now).status,null);});
test('pause dates require explicit timezone, valid future time and consistent choices',()=>{assert.equal(parseCallChoice({call_status:'paused',pause_until:'2026-09-21T10:00:00-07:00'},now).pauseUntil,'2026-09-21T17:00:00.000Z');for(const body of [{call_status:'paused',pause_until:'2026-09-21'},{call_status:'paused',pause_until:'2026-09-01T00:00:00Z'},{call_status:'declined',pause_until:'2026-09-21T00:00:00Z'},{call_status:'accepted',allow_calls:false},{allow_reports:'true'}])assert.equal(parseCallChoice(body,now),null);});
test('call refusal and pause do not cancel separately allowed family updates',()=>{
 const sub={status:'active',senior_phone_number:'+12025550124'},p={enabled:true,consent_senior_phone:sub.senior_phone_number,calls_consent_at:'2026-09-01',reports_consent_at:'2026-09-01',call_status:'paused',call_pause_until:'2026-09-21T00:00:00Z'};
 assert.equal(policy.canCheckIn(p,sub,now),false);assert.equal(policy.canShareReport(p,sub),true);assert.equal(policy.canCheckIn(p,sub,new Date('2026-09-22')),true);
 assert.equal(policy.canCheckIn({...p,call_pause_until:null},sub,new Date('2026-09-22')),false);
 assert.equal(policy.canShareReport({...p,call_status:'declined',calls_consent_at:null},sub),true);
 assert.equal(policy.canShareReport({...p,reports_consent_at:null},sub),false);assert.equal(policy.canShareReport({...p,consent_senior_phone:'+12025550999'},sub),false);
});
test('quiet notices use only structured facts and relationship pronouns',()=>{
 assert.match(quietDayMessage({kind:'off_day',version:'v',weekdays:[1,2,3,4,5]},'grandmother'),/grandma.*She prefers calls on weekdays/);
 assert.match(quietDayMessage({kind:'declined',version:'v'},'grandfather'),/grandpa.*his choice/);
 assert.match(quietDayMessage({kind:'paused',version:'v',pause_until:'2026-09-21T17:00:00Z',timezone:'America/Los_Angeles'},'grandmother'),/Monday, September 21.*10:00 AM/);
 assert.equal(quietDayMessage(null,'grandmother'),null);assert.equal(quietDayMessage({kind:'off_day',version:'v',weekdays:[7]},null),null);
});
