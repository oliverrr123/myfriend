import dotenv from 'dotenv';
import fs from 'node:fs';
dotenv.config();
const apiUrl=process.env.API_URL;
if(!apiUrl?.startsWith('https://')||!process.env.API_KEY||!process.env.CRONJOB_API_KEY||!process.env.ELEVENLABS_API_KEY||!process.env.ELEVENLABS_AGENT_ID)throw new Error('Configure API_URL, API_KEY, CRONJOB_API_KEY and ElevenLabs credentials first.');
const readiness=await fetch(apiUrl+'/api/webhook/daily-checkins',{headers:{Authorization:'Bearer '+process.env.API_KEY}});
if(!readiness.ok||(await readiness.json()).enabled!==false)throw new Error('Deploy the API with DAILY_CHECKINS_ENABLED=false before configuring the scheduler.');
const headers={'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'};
async function eleven(path,options={}){const r=await fetch('https://api.elevenlabs.io/v1/convai'+path,{...options,headers});if(!r.ok)throw new Error(`ElevenLabs ${r.status}`);return r.json();}
const list=await eleven('/tools');const tools=list.tools??[];
const reference=tools.find(t=>t.tool_config?.api_schema?.request_headers?.Authorization?.secret_id);
if(!reference)throw new Error('No existing workspace API authorization secret found.');
const tool=JSON.parse(fs.readFileSync(new URL('../elevenlabs-tools/confirmDailyCheckins.json',import.meta.url)));
tool.api_schema.url=apiUrl+'/api/confirmDailyCheckins';
tool.api_schema.request_headers.Authorization.secret_id=reference.tool_config.api_schema.request_headers.Authorization.secret_id;
const old=tools.find(t=>t.tool_config?.name===tool.name);
const saved=await eleven(old?'/tools/'+old.id:'/tools',{method:old?'PATCH':'POST',body:JSON.stringify({tool_config:tool})});
const phoneResponse=await eleven('/phone-numbers');
const phoneNumbers=Array.isArray(phoneResponse)?phoneResponse:phoneResponse.phone_numbers??[];
const familyLine=phoneNumbers.find(number=>number.phone_number===(process.env.DAILY_CHECKIN_AGENT_PHONE||'+19496767670'));
if(!familyLine?.assigned_agent?.agent_id)throw new Error('The family calling line needs an assigned agent before registering consent tooling.');
const targets=[{agent_id:process.env.ELEVENLABS_AGENT_ID,branch_id:null},familyLine.assigned_agent];
const visited=new Set();
for(const target of targets){
 const path='/agents/'+target.agent_id+(target.branch_id?'?branch_id='+encodeURIComponent(target.branch_id):'');
 if(visited.has(path))continue;visited.add(path);
 const agent=await eleven(path);
 const ids=agent.conversation_config?.agent?.prompt?.tool_ids??[];
 if(!ids.includes(saved.id))await eleven(path,{method:'PATCH',body:JSON.stringify({conversation_config:{agent:{prompt:{tool_ids:[...ids,saved.id]}}}})});
 const after=await eleven(path);
 if(!after.conversation_config?.agent?.prompt?.tool_ids?.includes(saved.id))throw new Error('Consent tool was not attached to the calling agent.');
 const beforeConfig=structuredClone(agent.conversation_config),afterConfig=structuredClone(after.conversation_config);
 delete beforeConfig.agent.prompt.tool_ids;delete afterConfig.agent.prompt.tool_ids;
 // ElevenLabs also returns the resolved tool definition alongside tool_ids.
 for(const config of [beforeConfig,afterConfig])if(config.agent.prompt.tools)config.agent.prompt.tools=config.agent.prompt.tools.filter(t=>t.name!==tool.name);
 if(JSON.stringify(beforeConfig)!==JSON.stringify(afterConfig))throw new Error('Agent settings changed unexpectedly; inspect before proceeding.');
 console.log('Verified consent tool on agent',target.agent_id,target.branch_id||'(default branch)');
}
const cronHeaders={Authorization:'Bearer '+process.env.CRONJOB_API_KEY,'Content-Type':'application/json'};
const listResponse=await fetch('https://api.cron-job.org/jobs',{headers:cronHeaders});if(!listResponse.ok)throw new Error('Could not list scheduler jobs');
const jobs=(await listResponse.json()).jobs??[];
const url=apiUrl+'/api/webhook/daily-checkins';
const job={url,title:'MyFriend friendly-call reports',enabled:false,saveResponses:true,requestMethod:0,extendedData:{headers:{Authorization:'Bearer '+process.env.API_KEY}},schedule:{timezone:'UTC',hours:[-1],minutes:Array.from({length:12},(_,i)=>i*5),mdays:[-1],months:[-1],wdays:[-1]}};
const existing=jobs.find(j=>j.url===url);
const r=await fetch('https://api.cron-job.org/jobs'+(existing?'/'+existing.jobId:''),{method:existing?'PATCH':'PUT',headers:cronHeaders,body:JSON.stringify({job})});
if(!r.ok)throw new Error('Could not configure check-in scheduler');
console.log('Consent tool configured; report worker cron is disabled. Enable delivery and scheduling only after the authorized end-to-end test.');
