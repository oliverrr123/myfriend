import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},extra={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],process:{env:{}},console,AbortSignal,...extra});return exports;}
const policy=load('src/lib/dailyDigestPolicy.ts');
const guard=load('src/lib/digestContentGuard.ts');
const voice=load('src/lib/digestVoice.ts',{'./dailyDigestPolicy':policy});
const objectSchema=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const base={call_id:'chat',kind:'conversation',answered:true,summary:'The caller made dinner and watched a quiz show. Private diagnosis and address.',ended_at:'2026-09-15T17:00:00Z',available_at:'2026-09-15T17:05:00Z'};
function privacy(candidate,review){return load('src/lib/dailyDigestPrivacy.ts',{'./dailyDigestPolicy':policy,'./digestVoice':voice,'./digestContentGuard':guard,'./digestModel':{objectSchema,digestModel:async name=>name==='family_shareable_facts'?candidate:review}});}
const candidate={details:[{category:'cooking',text:'made dinner',evidence_ids:[0]},{category:'television',text:'watched a quiz show',evidence_ids:[0]}],reminder_type:'none',medication_report:'not_confirmed',medication_evidence:''};
const approved={approved_detail_indexes:[0,1],reminder_type_correct:true,medication_report_correct:true};
test('specific details require source review; raw summaries and extra source fields are discarded',async()=>{
 const p=privacy({...candidate,details:[{category:'cooking',text:'made dinner',evidence_ids:[0]},{category:'television',text:'private diagnosis',evidence_ids:[0]}]},{...approved,approved_detail_indexes:[0]});
 const safe=await p.sanitizeDigestEvent({...base,transcript:'secret',unexpected:'secret'});
 assert.equal(JSON.stringify(safe.details),'["made dinner"]');assert.equal(Object.hasOwn(safe,'summary'),false);assert.equal(Object.hasOwn(safe,'transcript'),false);assert.doesNotMatch(JSON.stringify(safe),/secret|diagnosis/);
});
test('medication self-report requires reviewed, verbatim evidence; plans stay plans',async()=>{
 for(const [report,summary] of [['reported_taken','The caller said they had already taken their medication.'],['planned','The caller said they would take their medication after dinner.']]){
  const safe=await privacy({...candidate,details:[],reminder_type:'medication',medication_report:report,medication_evidence:summary},approved).sanitizeDigestEvent({...base,kind:'medication',summary});
  assert.equal(safe.medication_report,report);
 }
});
test('invented or rejected medication evidence, ordinary chats and unanswered calls cannot confirm adherence',async()=>{
 for(const patch of [{medication_evidence:'invented evidence'},{}]){
  const p=privacy({...candidate,reminder_type:'medication',medication_report:'reported_taken',medication_evidence:base.summary,...patch},{...approved,medication_report_correct:false});
  assert.equal((await p.sanitizeDigestEvent({...base,kind:'medication'})).medication_report,'not_confirmed');
 }
 const p=privacy({...candidate,reminder_type:'medication',medication_report:'reported_taken',medication_evidence:base.summary},approved);
 assert.equal((await p.sanitizeDigestEvent(base)).medication_report,'not_confirmed');
 assert.equal((await p.sanitizeDigestEvent({...base,answered:false,kind:'medication'})).medication_report,'not_confirmed');
 const invalid=privacy({...candidate,reminder_type:'medication',medication_report:'reported_taken',medication_evidence:'fabricated substring'},approved);
 assert.equal((await invalid.sanitizeDigestEvent({...base,kind:'medication'})).medication_report,'not_confirmed');
});
test('extraction and review failures fail closed to activity only',async()=>{
 for(const [c,r] of [[null,approved],[candidate,null],[{details:'wrong type'},approved]]){
  const safe=await privacy(c,r).sanitizeDigestEvent(base);assert.equal(safe.details.length,0);assert.equal(safe.medication_report,'not_confirmed');
 }
});
test('structured client handles network errors, refusals and malformed JSON without exposing raw data',async()=>{
 for(const fetch of [async()=>{throw Error('offline')},async()=>({ok:false}),async()=>({ok:true,json:async()=>({choices:[{message:{refusal:'no',content:'{}'}}]})}),async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})]){
  const model=load('src/lib/digestModel.ts',{}, {fetch,process:{env:{OPENAI_API_KEY:'fake'}}});
  assert.equal(await model.digestModel('fixture',objectSchema({}), 'instruction',{}),null);
 }
});
test('temporary provider rate limit retries without skipping generation',async()=>{
 let calls=0;
 const fetch=async()=>++calls===1?{ok:false,status:429,headers:{get:()=>null}}:{ok:true,json:async()=>({choices:[{message:{content:'{"ok":true}'}}]})};
 const model=load('src/lib/digestModel.ts',{}, {fetch,setTimeout:callback=>callback(),process:{env:{OPENAI_API_KEY:'fake'}}});
 assert.equal((await model.digestModel('fixture',objectSchema({ok:{type:'boolean'}}),'test',{})).ok,true);
 assert.equal(calls,2);
});
function writer(replies,inputs=[]){return load('src/lib/dailyDigestWriter.ts',{'./dailyDigestPolicy':policy,'./digestVoice':voice,'./digestContentGuard':guard,'./digestModel':{objectSchema,digestModel:async(name,schema,prompt,input)=>{inputs.push({name,input});return replies.shift();}}});}
const safe={...base,summary:undefined,topics:[],details:['made dinner'],reminder_type:'none',medication_report:'not_confirmed'};
test('AI writer uses reviewed facts and known relationship, with exact deduplicated counts',async()=>{
 const inputs=[],body='She told me about making dinner.',text='Hey! I chatted with your grandma today. '+body+' '+voice.digestClosing('grandmother',['chat'],true);
 const result=await writer([{body},{approved:true}],inputs).writeDailyDigest([safe,safe],'grandmother');
 assert.equal(result.message,text);assert.equal(result.generated,true);assert.equal(inputs[0].input.answered_calls,1);
 assert.equal(inputs[0].input.relationship,'grandma');assert.doesNotMatch(JSON.stringify(inputs),/diagnosis|address|call_id|summary/);
});
test('unsafe draft or failed reviewer falls back without including source or draft details',async()=>{
 for(const result of [{approved:false},null]){
  const output=await writer([{body:'Their diagnosis is secret.'},result]).writeDailyDigest([safe],'grandfather');
  assert.equal(output.generated,false);assert.match(output.message,/grandpa/);assert.doesNotMatch(output.message,/diagnosis|secret/);
 }
});
test('medication writer sees distinct reported-taken and planned statuses',async()=>{
 const inputs=[];
 await writer([{body:'They answered two medication reminders.'},{approved:true}],inputs).writeDailyDigest([
 {...safe,call_id:'med1',kind:'medication',reminder_type:'medication',medication_report:'reported_taken'},
 {...safe,call_id:'med2',kind:'medication',reminder_type:'medication',medication_report:'planned'},
 ]);
 assert.equal(inputs[0].input.answered_calls,2);assert.equal(inputs[0].input.calls[0].medication_report,'reported_taken');assert.equal(inputs[0].input.calls[1].medication_report,'planned');
});
test('no facts stay brief, unknown relationship falls back, unanswered calls never become chats',async()=>{
 const w=writer([null]);assert.equal(await w.writeDailyDigest([]),null);
 const output=await w.writeDailyDigest([{...safe,answered:false}],'<script>Grandma</script>');
 assert.match(output.message,/loved one/);assert.match(output.message,/couldn't reach/);assert.doesNotMatch(output.message,/grandma|had a call|diagnosis/i);
});
test('overlong and contact-bearing drafts are rejected before review',async()=>{
 for(const text of ['Hey '+ 'word '.repeat(100),'Hey visit https://example.com','Contact +12345678901']){
  const result=await writer([{body:text}]).writeDailyDigest([safe]);assert.equal(result.generated,false);
 }
});
test('sensitive categories are blocked even when both models approve them',async()=>{
 for(const text of ['Asked about BMI and healthy weight','Discussed religious modesty','Discussed wire transfers for charity','Discussed legality of public sex','Asked about the weather in Zadar for their grandson']){
  assert.equal(guard.detailIsShareable(text),false);
  const p=privacy({...candidate,details:[{category:'everyday technology',text,evidence_ids:[0]}]},approved);
  assert.equal((await p.sanitizeDigestEvent({...base,summary:text})).details.length,0);
  const result=await writer([{body:text},{approved:true}]).writeDailyDigest([safe]);assert.equal(result.generated,false);
 }
});
test('nonexistent evidence span cannot create an otherwise harmless detail',async()=>{
 const p=privacy({...candidate,details:[{category:'gardening',text:'watered the roses',evidence_ids:[99]}]},approved);
 assert.equal((await p.sanitizeDigestEvent(base)).details.length,0);
});
test('draft cannot invent medication or promote plans to completion even when model review approves',async()=>{
 for(const [event,body] of [
  [safe,'They said they took their medication.'],
  [{...safe,reminder_type:'medication',medication_report:'planned'},'They said they took their medication.'],
  [{...safe,reminder_type:'medication',medication_report:'not_confirmed'},'They said they would take their medication.'],
  [{...safe,reminder_type:'medication',medication_report:'reported_taken'},'They took their medication.'],
 ]){
  const result=await writer([{body},{approved:true}]).writeDailyDigest([event]);assert.equal(result.generated,false);
 }
});
test('closings vary across digests, remain stable on retries, and fit the recipient relationship',()=>{
 const closings=new Set();
 for(let i=0;i<40;i++){
  const ids=['first-'+i,'second-'+i];const closing=voice.digestClosing('grandmother',ids,true);
  closings.add(closing);assert.equal(closing,voice.digestClosing('grandmother',[...ids].reverse(),true));
  assert.doesNotMatch(closing,/she would|happy|misses|should|day!|him|them/i);
 }
 assert(closings.size>=5);assert([...closings].some(c=>c.includes('give her a call')));
 for(let i=0;i<40;i++)assert.doesNotMatch(voice.digestClosing('grandfather',['missed-'+i],false),/call|say hello/);
 assert.equal(voice.digestVoice('grandfather').object,'him');assert.equal(voice.digestVoice(null).object,'them');
});
test('first-person voice and relationship pronouns are enforced without public call counts',async()=>{
 for(const [relationship,body,person] of [['grandmother','She told me about dinner.','grandma'],['grandfather','He told me about dinner.','grandpa'],[null,'They told me about dinner.','loved one']]){
  const result=await writer([{body},{approved:true}]).writeDailyDigest([safe],relationship);
  assert.equal(result.generated,true);assert(result.message.includes(`I chatted with your ${person}`));assert(result.message.includes(body));assert.doesNotMatch(result.message,/\d+ calls|with MyFriend/);
 }
 for(const body of ['They told me about dinner.','She chatted with the agent.','We discussed dinner.','She answered 8 calls.']){
  const result=await writer([{body},{approved:true}]).writeDailyDigest([safe],'grandmother');assert.equal(result.generated,false);
 }
});


test('general learning survives while personal medical disclosures remain blocked',async()=>{
 const summary='Peter asked how the brain works and how motivation relates to a sense of purpose.';
 const p=privacy({...candidate,details:[{category:'science',text:'asked how the brain works',evidence_ids:[0]}]},approved);
 const safe=await p.sanitizeDigestEvent({...base,summary});
 assert.deepEqual([...safe.details],['asked how the brain works']);
 assert.equal(guard.detailIsShareable('asked how the brain works'),true);
 assert.equal(guard.detailIsShareable('has a brain disease'),false);
 const result=await writer([null]).writeDailyDigest([safe],'grandmother');
 assert.match(result.message,/She asked how the brain works/);assert.doesNotMatch(result.message,/Peter/);
});
test('source evidence can contain a name or location that is excluded from outgoing text',async()=>{
 const summary='Marie asked about the weather in Zadar for her grandson.';
 const p=privacy({...candidate,details:[{category:'weather',text:'asked about the weather',evidence_ids:[0]}]},approved);
 const safe=await p.sanitizeDigestEvent({...base,summary});assert.equal(safe.details.length,1);
 const result=await writer([null]).writeDailyDigest([safe]);assert.match(result.message,/asked about the weather/);assert.doesNotMatch(result.message,/Marie|Zadar|grandson/);
});
test('empty or badly styled drafts retain approved facts and typed medication self-reports',async()=>{
 const event={...safe,kind:'medication',reminder_type:'medication',medication_report:'reported_taken'};
 for(const draft of [null,{body:''},{body:'The agent chatted with her.'}]){
  const result=await writer([draft]).writeDailyDigest([event],'grandmother');
  assert.equal(result.generated,false);assert(result.fallbackReason);assert.match(result.message,/She made dinner/);assert.match(result.message,/she said she had already taken her medication/);
 }
});


test('source spans preserve exact evidence across paragraph breaks without model quote copying',async()=>{
 const summary='The caller asked about average heights.\n\nThen they discussed a private diagnosis.';
 let reviewInput;
 const p=load('src/lib/dailyDigestPrivacy.ts',{'./dailyDigestPolicy':policy,'./digestContentGuard':guard,'./digestModel':{objectSchema,digestModel:async(name,schema,prompt,input)=>{
  if(name==='family_shareable_facts')return {...candidate,details:[{category:'science',text:'asked about average heights',evidence_ids:[0]}]};
  reviewInput=input;return approved;
 }}});
 const result=await p.sanitizeDigestEvent({...base,summary});
 assert.equal(result.details[0],'asked about average heights');
 assert.equal(reviewInput.candidate.details[0].evidence,'The caller asked about average heights.');
 assert.equal(Object.hasOwn(result,'evidence_ids'),false);
 const rejected=await privacy({...candidate,details:[{category:'science',text:'asked about average heights',evidence_ids:[0]}]},{...approved,approved_detail_indexes:[]}).sanitizeDigestEvent(base);
 assert.equal(rejected.details.length,0);
});
test('fact fallback keeps first-person possessives and relationship pronouns grammatical',async()=>{
 const result=await writer([null]).writeDailyDigest([{...safe,details:["requested the agent switch to English to demonstrate the agent's capabilities",'said she would watch TV']}],'grandfather');
 assert.match(result.message,/He asked me to switch to English to demonstrate my capabilities/);
 assert.match(result.message,/He said he would watch TV/);
 assert.doesNotMatch(result.message,/me's|she|her/);
});

test('private source material cannot become a harmless-looking activity through euphemism',async()=>{
 for(const [summary,text] of [
  ['The caller asked about private clubs permitting sexual activity.','asked about private clubs with social rules'],
  ['The caller described their religious views on modesty.','discussed personal values'],
  ['The caller requested their bank account balance.','asked about using a phone service'],
 ]){
  const result=await privacy({...candidate,details:[{category:'practical questions',text,evidence_ids:[0]}]},approved).sanitizeDigestEvent({...base,summary});
  assert.equal(result.details.length,0);
 }
});

test('source context prevents disguising an adult-only club as a generic social activity',async()=>{
 const summary='The user asked about sexual activity in private clubs. The discussion covered membership and social rules.';
 const result=await privacy({...candidate,details:[{category:'practical questions',text:'asked about social activities',evidence_ids:[1]}]},approved).sanitizeDigestEvent({...base,summary});
 assert.equal(result.details.length,0);
 assert.equal(guard.evidenceHasPrivateContext('The caller cooked dinner.',summary),false);
});
test('one bounded style repair can preserve AI prose without losing approved facts',async()=>{
 const result=await writer([{body:'We discussed dinner.'},{body:'She told me about making dinner.'},{approved:true}]).writeDailyDigest([safe],'grandmother');
 assert.equal(result.generated,true);assert.match(result.message,/She told me about making dinner/);
});


test('unanswered-only days get a gentle check-in nudge without AI, reassurance or a cheerful closing',async()=>{
 for(const [relationship,label,object] of [['grandmother','grandma','her'],['grandfather','grandpa','him'],[null,'loved one','them']]){
  for(const count of [1,3]){
   const inputs=[];
   const result=await writer([],inputs).writeDailyDigest(Array.from({length:count},(_,i)=>({...safe,call_id:'missed-'+i,answered:false})),relationship);
   assert.equal(result.message,`Hey, I tried calling your ${label} today but couldn't reach ${object}. You might want to give ${object} a call to check in.`);
   assert.equal(inputs.length,0);assert.doesNotMatch(result.message,/dinner|medication|lovely|nice evening|emergency|danger|fine|safe/);
  }
 }
 const mixed=await writer([{body:'She told me about dinner.'},{approved:true}]).writeDailyDigest([{...safe,call_id:'missed',answered:false},safe],'grandmother');
 assert.doesNotMatch(mixed.message,/couldn't reach|check in/);assert.match(mixed.message,/chatted with your grandma/);
 assert.equal(await writer([]).writeDailyDigest([]),null);
});
