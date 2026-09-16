import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={},env={}) {
 const exports={}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n],process:{env},console,setTimeout,clearTimeout});return exports;
}
test('owner scope excludes other recipients and malformed targets',()=>{
 const policy=load('src/lib/familyTestScope.ts',{}, {FAMILY_MESSAGING_TEST_PHONE:'+12025550101'});
 assert.equal(policy.familyRecipientAllowed('+12025550101'),true);
 assert.equal(policy.familyRecipientAllowed('+12025550102'),false);
 assert.equal(load('src/lib/familyTestScope.ts',{}, {FAMILY_MESSAGING_TEST_PHONE:'invalid'}).familyRecipientAllowed('invalid'),false);
});
test('outbound provider is never invoked for a number outside owner scope',async()=>{
 let sent=0;
 const transport=load('src/lib/familyTransport.ts',{
  './familyTestScope':{familyRecipientAllowed:()=>false},
  './twilioSmsPolicy':{},'twilio':{default:()=>{sent++;throw new Error('Should not construct provider');}}
 },{FAMILY_MESSAGING_ENABLED:'true'});
 await assert.rejects(()=>transport.sendFamilyText('twilio','+12025550123','No send',{}),/outside the owner test/);
 assert.equal(sent,0);
});
