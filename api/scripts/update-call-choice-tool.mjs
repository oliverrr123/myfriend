// Updates only the existing consent tool. Does not start calls, send messages, or change agents/cron.
import 'dotenv/config';import fs from 'node:fs';import assert from 'node:assert/strict';
const headers={'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'};
assert(process.env.ELEVENLABS_API_KEY,'Missing ElevenLabs key');
async function api(path,options={}){const r=await fetch('https://api.elevenlabs.io/v1/convai'+path,{...options,headers});if(!r.ok)throw Error(`ElevenLabs ${r.status}`);return r.json();}
const matches=(await api('/tools')).tools.filter(t=>t.tool_config?.name==='confirmDailyCheckins');assert.equal(matches.length,1,'Expected one existing tool');
const before=await api('/tools/'+matches[0].id),current=before.tool_config;
assert.equal(current.api_schema.url,'https://api-nameless-water-1932.fly.dev/api/confirmDailyCheckins');
const template=JSON.parse(fs.readFileSync(new URL('../elevenlabs-tools/confirmDailyCheckins.json',import.meta.url)));
const config={...current,description:template.description,api_schema:{...current.api_schema,request_body_schema:template.api_schema.request_body_schema}};
fs.writeFileSync('/tmp/myfriend-call-choice-tool-backup.json',JSON.stringify(before),{mode:0o600});
await api('/tools/'+before.id,{method:'PATCH',body:JSON.stringify({tool_config:config})});
const after=await api('/tools/'+before.id);
assert.deepEqual(after.tool_config.api_schema.request_headers,current.api_schema.request_headers);
assert.equal(after.tool_config.api_schema.url,current.api_schema.url);
assert.equal(after.tool_config.description,config.description);
assert(after.tool_config.api_schema.request_body_schema.properties.call_status);
assert.deepEqual(after.tool_config.api_schema.request_body_schema.required,['caller_id','agent_phone_number']);
console.log('Updated existing call-choice tool; endpoint and authentication unchanged.');
