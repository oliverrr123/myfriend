import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup() {
 const routes = {}, writes = [];
 const supabase = {from: table => ({upsert: async value => {writes.push({table,value}); return {error:null};}})};
 const deps = {
  './app':{app:{get(){},post:(path,...handlers)=>routes[path]=handlers.at(-1)}},
  './middleware/auth':{authenticateApiKey(){}},
  './lib/supabase':{supabase},
  './lib/subscriptions':{getAccountForBuyer:async()=>({subscription:{id:'owner',senior_phone_number:'+12025550124'}})},
  './lib/familyTestScope':{familyRecipientAllowed:()=>true},'./lib/callParticipants':{},'./lib/checkinPolicy':{},'./lib/reportDelivery':{},'./lib/familyAssistantPolicy':{},'./lib/timezone':{}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/checkins.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:{},require:n=>deps[n],console,process:{env:{}}});
 return {writes, async save(enabled,message_updates) {
  let status=200;
  await routes['/api/account/friendly-calls']({body:{buyer_phone:'+12025550123',message_updates,schedule:{enabled,frequency:'daily',weekdays:[0,1,2,3,4,5,6],windows:[{start:1080,end:1260}],timezone:'America/Los_Angeles'}}},{status(n){status=n;return this;},json(value){return value;}});
  assert.equal(status,200);
  return writes.at(-1).value;
 }};
}
test('enabling dashboard calls saves Message default without granting loved-one consent',async()=>{
 const s=setup(), p=await s.save(true,true);
 assert.equal(p.report_channel,'messages');assert.ok(p.recipient_consent_at);
 assert.equal(p.calls_consent_at,null);assert.equal(p.schedule_confirmed_at,null);
 assert.equal(Object.hasOwn(p,'reports_consent_at'),false);
});
test('turning off clears message opt-in, even if stale client sends true',async()=>{
 const p=await setup().save(false,true);
 assert.equal(p.report_channel,'none');assert.equal(p.recipient_consent_at,null);
});
test('older clients preserve message preferences when only updating schedule',async()=>{
 const p=await setup().save(true,undefined);
 assert.equal(Object.hasOwn(p,'report_channel'),false);assert.equal(Object.hasOwn(p,'recipient_consent_at'),false);
});
