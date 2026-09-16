import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
function setup({verified=true,accounts=[{buyer_phone_number:'+12025550123'}],limit=true,ready=true,expired=false}={}) {
 const routes={},calls=[],exports={};
 const user={email:'owner@example.com',email_confirmed_at:verified?'now':null};
 const session={access_token:'access',refresh_token:'refresh',expires_in:3600};
 const auth={admin:{generateLink:async()=>({data:{properties:{email_otp:'123456'}}}),signOut:async()=>{calls.push('signout');}},verifyOtp:async()=>({data:{user,session}}),getUser:async token=>token==='expired'?{error:new Error('expired')}:{data:{user}},refreshSession:async()=>{calls.push('refresh');return{data:{session}};}};
 const supabase={rpc:async()=>({data:limit}),from:()=>({select:()=>({ilike:(_field,pattern)=>{calls.push(['pattern',pattern]);return{limit:async()=>({data:accounts})};}})})};
 const deps={'node:crypto':crypto,'@supabase/supabase-js':{createClient:()=>({auth})},'./app':{app:{post:(path,...handlers)=>routes[path]=handlers.at(-1)}},'./middleware/auth':{authenticateApiKey(){}},'./lib/supabase':{supabase},'./lib/subscriptions':{getAccountForBuyer:async phone=>({subscription:{buyer_phone_number:phone,email:'owner@example.com'},seniorFirstName:null})},'./billing':{accountPayload:x=>x},'./lib/emailDelivery':{emailDeliveryReady:()=>ready,sendEmail:async(...args)=>calls.push(['email',...args])}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/emailLogin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],process:{env:{}},console});
 return {calls,exports,run:async(path,body)=>{let status=200,payload;const res={status(n){status=n;return this;},json(x){payload=x;return this;}};await routes['/api/email-login/'+path]({body},res);return{status,payload};}};
}
test('only a confirmed email can open an account',async()=>{
 const s=setup({verified:false});assert.equal((await s.run('check',{email:'owner@example.com',code:'123456'})).status,401);
 assert.equal((await s.run('session',{access_token:'access'})).status,401);
});
test('email lookups escape wildcard characters; duplicate matches cannot sign in',async()=>{
 const s=setup({accounts:[]});await s.run('send',{email:' My_%@Example.com '});assert.ok(s.calls.some(c=>Array.isArray(c)&&c[0]==='pattern'&&c[1]==='my\\_\\%@example.com'));
 const duplicate=setup({accounts:[{},{}]});assert.equal((await duplicate.run('check',{email:'owner@example.com',code:'123456'})).status,403);
});
test('unknown email gets generic success without sending a code',async()=>{
 const s=setup({accounts:[]});assert.equal((await s.run('send',{email:'nobody@example.com'})).status,200);assert.equal(s.calls.filter(c=>c[0]==='email').length,0);
});
test('login throttling blocks both sending and verification',async()=>{
 const s=setup({limit:false});for(const path of ['send','check'])assert.equal((await s.run(path,{email:'owner@example.com',code:'123456'})).status,429);assert.equal(s.calls.length,0);
});
test('verified identity controls ownership, ignoring supplied account identifiers',async()=>{
 const s=setup();const r=await s.run('session',{access_token:'access',email:'victim@example.com',buyer_phone:'+12025550999'});assert.equal(r.payload.account.email,'owner@example.com');assert.equal(r.payload.account.buyer_phone_number,'+12025550123');assert.ok(s.calls.some(c=>c[1]==='owner@example.com'));
});
test('expired sessions refresh before account lookup; logout revokes refresh access',async()=>{
 const s=setup();const r=await s.run('session',{access_token:'expired',refresh_token:'refresh'});assert.equal(r.status,200);assert.equal(r.payload.session.access_token,'access');assert.ok(s.calls.includes('refresh'));await s.run('logout',{access_token:'access'});assert.ok(s.calls.includes('signout'));
});
test('missing email configuration fails clearly before attempting auth',async()=>{
 const s=setup({ready:false});assert.equal((await s.run('send',{email:'owner@example.com'})).status,503);assert.equal(s.calls.length,0);
});
