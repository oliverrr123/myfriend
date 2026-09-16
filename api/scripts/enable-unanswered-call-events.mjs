// Enable only failure-event delivery to the existing HMAC endpoint. No calls/messages.
import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const apiUrl=process.env.API_URL;
assert(apiUrl?.startsWith('https://') && process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID,'Configure API_URL and ElevenLabs credentials.');
const headers={'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'};
async function api(path,options={}){const response=await fetch('https://api.elevenlabs.io/v1'+path,{...options,headers});if(!response.ok)throw Error(`ElevenLabs ${response.status}`);return response.json();}
const registered=(await api('/workspace/webhooks')).webhooks;
const phones=await api('/convai/phone-numbers');
const numbers=Array.isArray(phones)?phones:phones.phone_numbers??[];
const targets=[{agent_id:process.env.ELEVENLABS_AGENT_ID,branch_id:null},...numbers.map(n=>n.assigned_agent).filter(Boolean)];
const visited=new Set();
for(const target of targets){
 const path='/convai/agents/'+target.agent_id+(target.branch_id?'?branch_id='+encodeURIComponent(target.branch_id):'');
 if(visited.has(path))continue;visited.add(path);
 const before=await api(path),webhooks=before.platform_settings?.workspace_overrides?.webhooks;
 const registeredHook=registered.find(h=>h.webhook_id===webhooks?.post_call_webhook_id);
 assert(registeredHook?.webhook_url===apiUrl+'/api/endCall' && registeredHook.auth_type==='hmac' && !registeredHook.is_disabled,'Expected an active, existing MyFriend HMAC webhook; no routing changes are performed.');
 const events=webhooks.events??[];
 if(events.includes('call_initiation_failure')){console.log(`${target.agent_id}: failure events already enabled`);continue;}
 const backup=`/tmp/myfriend-noanswer-webhooks-${target.agent_id}-${Date.now()}.json`;
 fs.writeFileSync(backup,JSON.stringify({path,webhooks}),{mode:0o600});
 await api(path,{method:'PATCH',body:JSON.stringify({platform_settings:{workspace_overrides:{webhooks:{...webhooks,events:[...events,'call_initiation_failure']}}}})});
 const after=await api(path);
 assert.deepEqual(after.platform_settings.workspace_overrides.webhooks.events,[...events,'call_initiation_failure']);
 const unchanged=structuredClone(after.platform_settings);unchanged.workspace_overrides.webhooks=webhooks;
 assert.deepEqual(unchanged,before.platform_settings,'An unrelated platform setting changed; inspect the saved backup.');
 assert.deepEqual(after.conversation_config,before.conversation_config,'Conversation configuration unexpectedly changed.');
 console.log(`${target.agent_id}: failure events enabled; all other settings verified unchanged`);
}
