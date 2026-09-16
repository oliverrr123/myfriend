import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
function load(file,deps={},extra={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],process:{env:{}},console,Intl,Date,AbortSignal,...extra});return exports;}
const policy=load('src/lib/dailyDigestPolicy.ts');
const facts=load('src/lib/dailyDigestEvents.ts',{'./supabase':{},'./subscriptions':{},'./checkinPolicy':{}});
const event={call_id:'one',kind:'conversation',answered:true,summary:'Private words: Marie, diagnosis, 45 River Road, pills, debt.',ended_at:'2026-09-15T17:00:00Z',available_at:'2026-09-15T17:05:00Z'};
test('one combined digest, deduped calls, no medication adherence or source text',()=>{
 const events=[{...event,topics:['gardening','Marie','diagnosis']},{...event,kind:'conversation',topics:['gardening']},{...event,call_id:'med',kind:'medication',topics:[]},{...event,call_id:'water',kind:'water',topics:[]}];
 const result=policy.renderDailyDigest(events);
 assert.match(result,/a chat/);assert.match(result,/gardening/);assert.match(result,/2 reminder calls were answered/);
 assert.doesNotMatch(result,/Marie|diagnosis|River|pills|debt|medication|took|hydrated/);assert.equal(policy.renderDailyDigest([]),null);
});
test('no safe topic produces a basic activity update; no completed action claims',()=>{
 const result=policy.renderDailyDigest([{...event,topics:[]}]);
 assert.equal(result,'MyFriend daily update\n\nYour loved one had a chat with MyFriend.');
 assert.match(policy.renderDailyDigest([{...event,answered:false,topics:[]}]),/answer wasn't confirmed/);
});
test('20:00 uses recipient timezone, exact boundary, and late final transcripts roll forward',()=>{
 const before=policy.digestWindow(new Date('2026-09-15T17:59:59Z'),'Europe/Prague');
 const now=policy.digestWindow(new Date('2026-09-15T18:00:00Z'),'Europe/Prague');
 assert.equal(before.localDate,'2026-09-14');assert.equal(now.localDate,'2026-09-15');
 assert.equal(now.start,'2026-09-14T18:00:00.000Z');assert.equal(now.end,'2026-09-15T18:00:00.000Z');
 assert.equal(policy.eventInWindow(event,now),true);
 assert.equal(policy.eventInWindow({...event,available_at:now.end},now),false);
 const next=policy.digestWindow(new Date('2026-09-16T18:00:00Z'),'Europe/Prague');
 assert.equal(policy.eventInWindow({...event,available_at:'2026-09-15T18:05:00Z'},next),true);
});
test('DST creates contiguous 23/25-hour calendar windows',()=>{
 for(const [date,hours] of [['2026-03-29T18:00:00Z',23],['2026-10-25T19:00:00Z',25]]){
  const w=policy.digestWindow(new Date(date),'Europe/Prague');assert.equal((Date.parse(w.end)-Date.parse(w.start))/3600000,hours);
 }
 const w=policy.digestWindow(new Date('2026-09-15T03:00:00Z'),'America/Los_Angeles');assert.equal(w.localDate,'2026-09-14');
});
test('reminder facts distinguish medication/water, voicemail, and human reply',()=>{
 const base={conversation_id:'x',metadata:{start_time_unix_secs:1,call_duration_secs:30},transcript:[{role:'user',message:'Yes, thank you.'}],conversation_initiation_client_data:{dynamic_variables:{reminder_call:'true',reason:'Take medication'}}};
 assert.equal(facts.digestCallFacts(base).kind,'medication');assert.equal(facts.digestCallFacts(base).answered,true);
 assert.equal(facts.digestCallFacts({...base,conversation_initiation_client_data:{dynamic_variables:{reminder_call:'true',reason:'Drink water'}}}).kind,'water');
 assert.equal(facts.digestCallFacts({...base,transcript:[{role:'user',message:'Please leave a message after the beep'}]}).answered,false);
 assert.equal(facts.digestCallFacts({...base,transcript:[{role:'user',message:'Message for 650-537-8540.'}]}).answered,false);
 assert.equal(facts.digestCallFacts({...base,transcript:[]}).answered,false);
});
test('old per-call formatter no longer exposes raw summaries',()=>{
 const old=load('src/lib/familyAssistantPolicy.ts',{'./checkinPolicy':{}});
 assert.doesNotMatch(old.sharedReportText(true,event.summary),/Marie|Private words|diagnosis/);
});

test('webhook records all call types idempotently, without raw text or pre-consent calls',async()=>{
 const rows=new Map();
 const sub={id:'sub',status:'active',senior_phone_number:'+12025550124'};
 const prefs={enabled:true,report_channel:'messages',consent_senior_phone:sub.senior_phone_number,calls_consent_at:'2026-09-01',reports_consent_at:'2026-09-01',recipient_consent_at:'2026-09-01'};
 const consent=load('src/lib/checkinPolicy.ts');
 const db={from(table){return table==='daily_checkin_preferences'?{select(){return this},eq(){return this},maybeSingle:async()=>({data:prefs})}:{upsert:async(value,options)=>{assert.equal(options.onConflict,'call_id');assert.equal(options.ignoreDuplicates,true);if(!rows.has(value.call_id))rows.set(value.call_id,value);return{error:null}}}}};
 const recorder=load('src/lib/dailyDigestEvents.ts',{'./supabase':{supabase:db},'./subscriptions':{findSubscriptionByPhone:async()=>sub},'./checkinPolicy':consent});
 const call={conversation_id:'chat',metadata:{start_time_unix_secs:Date.parse('2026-09-14T17:00:00Z')/1000,call_duration_secs:60,phone_call:{external_number:sub.senior_phone_number}},transcript:[{role:'user',message:'Private medical details'}]};
 await recorder.recordDailyDigestEvent(call);await recorder.recordDailyDigestEvent(call);
 for(const reason of ['Take medication','Drink water'])await recorder.recordDailyDigestEvent({...call,conversation_id:reason,conversation_initiation_client_data:{dynamic_variables:{reminder_call:true,reason}}});
 assert.equal(rows.size,3);assert.equal(rows.get('Take medication').kind,'medication');assert.equal(rows.get('Drink water').kind,'water');
 assert.doesNotMatch(JSON.stringify([...rows.values()]),/Private medical details|summary|transcript/);
 await recorder.recordDailyDigestEvent({...call,conversation_id:'before-consent',metadata:{...call.metadata,start_time_unix_secs:Date.parse('2026-08-31')/1000}});
 prefs.reports_consent_at=null;
 await recorder.recordDailyDigestEvent({...call,conversation_id:'revoked'});
 assert.equal(rows.size,3);
});


const failure={type:'call_initiation_failure',event_timestamp:Date.parse('2026-09-14T17:00:00Z')/1000,data:{conversation_id:'missed',failure_reason:'no-answer',metadata:{type:'twilio',body:{Direction:'outbound-api',CallStatus:'no-answer',To:'+12025550124'}}}};
test('confirmed missed outbound calls use the failure event; technical failures never imply a missed answer',()=>{
 const call=facts.unansweredFailureCall(failure);assert.equal(call.metadata.phone_call.external_number,'+12025550124');assert.equal(facts.digestCallFacts(call).answered,false);
 const busy={...failure,data:{...failure.data,failure_reason:'busy',metadata:{type:'sip',body:{to_number:'+12025550124'}}}};
 assert(facts.unansweredFailureCall(busy));
 for(const event of [null,{}, {...failure,type:'post_call_audio'}, {...failure,event_timestamp:NaN}, {...failure,event_timestamp:Date.now()/1000+3600}, {...failure,data:{...failure.data,failure_reason:'unknown'}}, {...failure,data:{...failure.data,metadata:{type:'twilio',body:{...failure.data.metadata.body,CallStatus:'failed'}}}}, {...failure,data:{...failure.data,metadata:{type:'twilio',body:{...failure.data.metadata.body,Direction:'inbound'}}}}, {...failure,data:{...failure.data,metadata:{type:'sip',body:{to_number:'invalid'}}}}])assert.equal(facts.unansweredFailureCall(event),null);
});
test('a human mentioning voicemail or replying after a greeting is an answered call',()=>{
 const base={conversation_id:'x',metadata:{start_time_unix_secs:1,call_duration_secs:30}};
 for(const transcript of [[{role:'user',message:'I listened to my voicemail today.'}],[{role:'user',message:'You have reached my voicemail.'},{role:'user',message:'Hello, I picked up, how are you?'}]])assert.equal(facts.digestCallFacts({...base,transcript}).answered,true);
});
test('failed attempts are deduplicated, consent-gated and do not retain provider metadata',async()=>{
 const rows=new Map();let reads=0;
 const sub={id:'sub',status:'active',senior_phone_number:'+12025550124'};
 const prefs={enabled:true,report_channel:'messages',consent_senior_phone:sub.senior_phone_number,calls_consent_at:'2026-09-01',reports_consent_at:'2026-09-01',recipient_consent_at:'2026-09-01'};
 const db={from(table){reads++;return table==='daily_checkin_preferences'?{select(){return this},eq(){return this},maybeSingle:async()=>({data:prefs})}:{upsert:async(value)=>{if(!rows.has(value.call_id))rows.set(value.call_id,value);return{error:null}}}}};
 const recorder=load('src/lib/dailyDigestEvents.ts',{'./supabase':{supabase:db},'./subscriptions':{findSubscriptionByPhone:async()=>sub},'./checkinPolicy':load('src/lib/checkinPolicy.ts')});
 await recorder.recordUnansweredDigestEvent(failure);await recorder.recordUnansweredDigestEvent(failure);
 assert.equal(rows.size,1);assert.equal(rows.get('missed').answered,false);
 assert.doesNotMatch(JSON.stringify([...rows.values()]),/CallStatus|Direction|transcript|summary|failure_reason/);
 const before=reads;
 await recorder.recordDailyDigestEvent({...facts.unansweredFailureCall(failure),metadata:{...facts.unansweredFailureCall(failure).metadata,phone_call:{external_number:sub.senior_phone_number,direction:'inbound'}}});
 assert.equal(reads,before);
 prefs.reports_consent_at=null;
 await recorder.recordUnansweredDigestEvent({...failure,data:{...failure.data,conversation_id:'revoked'}});
 assert.equal(rows.size,1);
});
