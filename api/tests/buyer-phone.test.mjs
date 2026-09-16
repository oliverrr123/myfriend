import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function setup({ ownNumber = false, conflict = false, lookupFails = false } = {}) {
 const subscription = { id:'plan', buyer_phone_number:'+12025550111', senior_phone_number:ownNumber?'+12025550111':'+12025550112', buyer_user_id:'old', senior_user_id:'senior', email:'owner@example.com', stripe_subscription_id:'stripe', status:'active' };
 const preferences = { calls_consent_at:'before', reports_consent_at:'before', consent_senior_phone:subscription.senior_phone_number };
 const users = [{ id:'new', phone_number:'+12025550113' }];
 const client = { from(table) {
  let patch, combined, one = false; const filters=[];
  const q = {
   select(){return q;}, eq(k,v){filters.push(r=>r[k]===v);return q;}, neq(k,v){filters.push(r=>r[k]!==v);return q;},
   or(v){combined=v;return q;}, limit(){return q;}, update(v){patch=v;return q;},
   maybeSingle(){one=true;return q;},single(){one=true;return q;},
   then(resolve,reject){
    if (combined && lookupFails) return Promise.resolve({error:new Error('Database unavailable')}).then(resolve,reject);
    let rows = table==='subscriptions'?[subscription]:table==='users'?users:[{subscription_id:'plan',...preferences}];
    rows=rows.filter(r=>filters.every(f=>f(r)));
    if(combined) rows=conflict?[{id:'other'}]:[];
    if(patch && rows.length) Object.assign(table==='daily_checkin_preferences'?preferences:rows[0],patch);
    return Promise.resolve({data:one?(rows[0]??null):rows,error:null}).then(resolve,reject);
   }
  };return q;
 }};
 const exports={};
 const deps={'./supabase':{supabase:client},'./callParticipants':{normalizePhoneNumber:x=>/^\+\d{11,15}$/.test(x)?x:null},'./paidAccess':{},'./phoneLanguagePrefix':{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/subscriptions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],Date});
 return {subscription,preferences,change:()=>exports.setBuyerPhone({buyerPhone:'+12025550111',newPhone:'+12025550113'})};
}
test('editing payer number preserves loved one and Stripe account, and clears report consent',async()=>{
 const s=setup();await s.change();assert.equal(s.subscription.buyer_phone_number,'+12025550113');assert.equal(s.subscription.buyer_user_id,'new');assert.equal(s.subscription.senior_phone_number,'+12025550112');assert.equal(s.subscription.stripe_subscription_id,'stripe');assert.equal(s.preferences.reports_consent_at,null);assert.equal(s.preferences.calls_consent_at,'before');
});
test('self plans move the calling number and require fresh consent',async()=>{
 const s=setup({ownNumber:true});await s.change();assert.equal(s.subscription.senior_phone_number,'+12025550113');assert.equal(s.subscription.senior_user_id,'new');assert.equal(s.preferences.calls_consent_at,null);assert.equal(s.preferences.consent_senior_phone,null);
});
test('a number belonging to another plan cannot be taken',async()=>{
 const s=setup({conflict:true});await assert.rejects(s.change,e=>e.status===409);assert.equal(s.subscription.buyer_phone_number,'+12025550111');assert.equal(s.preferences.reports_consent_at,'before');
});
test('failed conflict lookup blocks edits',async()=>{
 const s=setup({lookupFails:true});await assert.rejects(s.change,/Database unavailable/);assert.equal(s.subscription.buyer_phone_number,'+12025550111');
});
