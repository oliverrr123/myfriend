import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],console});return exports;}
const policy=load('src/lib/dailyDigestPolicy.ts'),consent=load('src/lib/checkinPolicy.ts'),sharing=load('src/lib/familyAssistantPolicy.ts',{'./checkinPolicy':consent});
const noAnswerWriter=load('src/lib/dailyDigestWriter.ts',{'./digestVoice':load('src/lib/digestVoice.ts',{'./dailyDigestPolicy':policy}),'./digestContentGuard':{},'./digestModel':{}});
const worker=load('src/lib/dailyDigestWorker.ts',{'./supabase':{},'./checkinPolicy':consent,'./familyAssistantPolicy':sharing,'./familyTestScope':{},'./dailyDigestPrivacy':{},'./dailyDigestWriter':{},'./dailyDigestPolicy':policy,'./reportDelivery':{},'./quietDayDigest':load('src/lib/quietDayDigest.ts',{'./digestVoice':load('src/lib/digestVoice.ts',{'./dailyDigestPolicy':policy})})});
function setup({revoked=false,ambiguous=false,stale=false,ready=true,allowed=true,empty=false,unanswered=false,quiet=null,preferenceChanged=false,noCallConsent=false}={}){
 const sub={id:'sub',status:'active',buyer_phone_number:'+12025550123',senior_phone_number:'+12025550124'};
 const prefs={subscription_id:'sub',enabled:true,report_channel:'messages',calls_consent_at:noCallConsent?null:'2026-09-01',call_status:quiet?.status,call_preference_version:quiet?.version,reports_consent_at:'2026-09-01',recipient_consent_at:'2026-09-01',consent_senior_phone:sub.senior_phone_number,digest_timezone:'Europe/Prague',subscriptions:sub};
 const stamp=JSON.stringify([sharing.sharingContext(prefs,sub.senior_phone_number),prefs.recipient_consent_at,sub.buyer_phone_number]);
 const digest={id:'digest',recipient_phone:sub.buyer_phone_number,senior_phone:sub.senior_phone_number,status:'building',claim_token:'lease',consent_context:stamp,quiet_context:quiet};
 const events=empty?[]:['conversation','medication','water'].map((kind,i)=>({call_id:String(i),kind,answered:!unanswered,ended_at:'2026-09-15T17:00:00Z',available_at:'2026-09-15T17:01:00Z'}));
 const sends=[];let claimed=false;
 const db={rpc:async(name)=>{if(name==='family_quiet_day_context')return{data:quiet};if(claimed)return {data:[]};claimed=true;return{data:[{...digest}]};},from(table){let patch=null,filters=[],single=false;const b={select(){return b},eq(k,v){filters.push([k,v]);return b},order(){return b},limit(){return b},maybeSingle(){single=true;return b},single(){single=true;return b},update(v){patch=v;return b},then(resolve,reject){let data=null;
  if(table==='daily_checkin_preferences')data=single?{...prefs,...(revoked?{reports_consent_at:null}:{}),...(preferenceChanged?{call_preference_version:'new'}:{})}:[prefs];
  if(table==='onboarding_submissions')data={answers:{relationship:'grandmother'}};
  if(table==='family_message_connections')data={opted_out:false,sender_phone:sub.buyer_phone_number};
  if(table==='family_digest_events')data=events;
  if(table==='conversation_storage')data={summary:'Secret diagnosis and address. Also discussed gardening.'};
  if(table==='family_daily_digests'&&patch){if(stale)digest.claim_token='new lease';if(filters.every(([k,v])=>digest[k]===v)){Object.assign(digest,patch);data={id:digest.id};}}
  return Promise.resolve({data,error:null}).then(resolve,reject);
 }};return b;}};
 const deps={db,now:()=>new Date('2026-09-15T18:00:00Z'),ready:()=>ready,allowed:()=>allowed,sanitize:async({summary,...e})=>({...e,topics:e.kind==='conversation'?['gardening']:[]}),write:async(events,relationship)=>{assert.equal(relationship,'grandmother');if(unanswered)return noAnswerWriter.writeDailyDigest(events,relationship);const text=policy.renderDailyDigest(events);return text?{message:'Hey! '+text,generated:true}:null;},send:async(to,message)=>{sends.push({to,message});if(ambiguous)throw new Error('outcome unknown');return{ok:true,sid:'message'}}};
 return {digest,sends,run:()=>worker.processDailyDigests(deps)};
}
test('one daily message combines friendly/medication/water calls without raw text; repeated worker does not resend',async()=>{const s=setup();await s.run();await s.run();assert.equal(s.sends.length,1);assert.match(s.sends[0].message,/2 reminder calls/);assert.match(s.sends[0].message,/gardening/);assert.doesNotMatch(s.sends[0].message,/Secret|diagnosis|address|took|medication/);assert.equal(s.digest.status,'submitted');assert.equal(s.sends[0].message,s.digest.message);assert.match(s.sends[0].message,/^Hey!/);});
test('consent revoked during summarization prevents delivery',async()=>{const s=setup({revoked:true});await s.run();assert.equal(s.sends.length,0);assert.equal(s.digest.status,'skipped');});
test('stale worker lease cannot send',async()=>{const s=setup({stale:true});await s.run();assert.equal(s.sends.length,0);});
test('ambiguous external send is marked unknown and is never retried',async()=>{const s=setup({ambiguous:true});await s.run();await s.run();assert.equal(s.sends.length,1);assert.equal(s.digest.status,'unknown');});
test('unavailable provider, out-of-scope recipient, and no activity send nothing',async()=>{for(const options of [{ready:false},{allowed:false},{empty:true}]){const s=setup(options);await s.run();assert.equal(s.sends.length,0);}});

test('an unanswered-only window sends the check-in nudge once at the daily worker, with no medication inference',async()=>{const s=setup({unanswered:true});await s.run();await s.run();assert.equal(s.sends.length,1);assert.match(s.sends[0].message,/tried calling your grandma/);assert.match(s.sends[0].message,/give her a call to check in/);assert.doesNotMatch(s.sends[0].message,/medication|took|gardening|emergency/);assert.equal(s.sends[0].message,s.digest.message);});

for(const kind of ['off_day','paused','declined']) test(`quiet ${kind} produces one message with independent sharing consent`,async()=>{
 const s=setup({empty:true,noCallConsent:kind!=='off_day',quiet:{kind,status:kind==='off_day'?'accepted':kind,version:'v1',weekdays:[1,2,3,4,5]}});await s.run();await s.run();assert.equal(s.sends.length,1);assert.equal(s.digest.status,'submitted');
 assert.doesNotMatch(s.sends[0].message,/couldn.t reach|check in|gardening|medication/);
});
test('preference changed while generating means stale explanation is skipped',async()=>{const s=setup({empty:true,preferenceChanged:true,quiet:{kind:'declined',status:'declined',version:'v1'}});await s.run();assert.equal(s.sends.length,0);assert.equal(s.digest.status,'skipped');});
test('new pause notice is included once with real call update',async()=>{const s=setup({quiet:{kind:'paused',status:'paused',version:'v1'}});await s.run();assert.equal(s.sends.length,1);assert.match(s.sends[0].message,/gardening/);assert.match(s.sends[0].message,/asked to pause/);});
