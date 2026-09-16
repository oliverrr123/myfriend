// Reproducible narrow overlay: retain the running voice implementation.
// Usage: node scripts/prepare-family-digest-overlay.mjs LIVE_SNAPSHOT OUTPUT_DIR BASE_IMAGE
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const api=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [snapshot,output,baseImage]=process.argv.slice(2);
assert(snapshot && output && /^registry\.fly\.io\/[\w-]+@sha256:[a-f0-9]{64}$/.test(baseImage),'Supply snapshot, fresh output directory, immutable base image');
assert(!fs.existsSync(output),'Output must be a new directory');
const files=['checkins.js','familyMessaging.js','lib/checkinPolicy.js','lib/familyAssistant.js','lib/familyAssistantPolicy.js','lib/familyTestScope.js','lib/familyTransport.js','lib/reportDelivery.js','lib/dailyDigestEvents.js','lib/dailyDigestPolicy.js','lib/dailyDigestPrivacy.js','lib/dailyDigestWorker.js','lib/dailyDigestWriter.js','lib/digestContentGuard.js','lib/digestModel.js','lib/digestVoice.js'];
const installed=JSON.parse(fs.readFileSync(path.join(snapshot,'package.json'),'utf8'));
const expected=JSON.parse(fs.readFileSync(path.join(api,'package.json'),'utf8'));
assert.deepEqual(installed.dependencies,expected.dependencies,'Overlay must not assume new dependencies');
const original=fs.readFileSync(path.join(snapshot,'dist/index.js'),'utf8');
let index=original;
const importMarker='const checkins_1 = require("./checkins");';
const eventMarker='        const { data: user, error: userError } = await supabase_1.supabase\n            .from("users")';
assert.equal(index.split(importMarker).length,2);
assert.equal(index.split(eventMarker).length,2);
const importPatch='\nconst dailyDigestEvents_1 = require("./lib/dailyDigestEvents");';
const eventPatch='        try { await (0, dailyDigestEvents_1.recordDailyDigestEvent)(event.data); }\n        catch { return res.status(503).json({error:"Could not record daily digest event."}); }\n';
const additions=[];
if (!index.includes('dailyDigestEvents_1')) {
  index=index.replace(importMarker,importMarker+importPatch).replace(eventMarker,eventPatch+eventMarker);
  additions.push(importPatch,eventPatch);
} else {
  assert(index.includes(importPatch.trim()) && index.includes(eventPatch),'Unexpected existing digest integration; inspect before patching');
}
const failureMarker="    if (event.type === 'post_call_transcription') {";
const failurePatch="    if (event.type === 'call_initiation_failure') {\n        try { await (0, dailyDigestEvents_1.recordUnansweredDigestEvent)(event); }\n        catch { return res.status(503).json({error:\"Could not record unanswered call.\"}); }\n        return res.status(200).json({received:true});\n    }\n";
assert.equal(index.split(failureMarker).length,2);
if (!index.includes('recordUnansweredDigestEvent')) {
  index=index.replace(failureMarker,failurePatch+failureMarker);
  additions.push(failurePatch);
} else assert(index.includes(failurePatch),'Unexpected existing unanswered-call integration');
assert.equal(additions.reduce((text,addition)=>text.replace(addition,''),index),original,'Only digest webhook integration may change the live entrypoint');
fs.mkdirSync(path.join(output,'dist/lib'),{recursive:true});
for(const file of files)fs.copyFileSync(path.join(api,'dist',file),path.join(output,'dist',file));
fs.writeFileSync(path.join(output,'dist/index.js'),index);
files.push('index.js');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const preserved=['lib/conversationContext.js','lib/callModes.js','lib/subscriptions.js','calling.js','billing.js','reminder.js','topics.js'];
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({base_image:baseImage,replaced_files:Object.fromEntries(files.map(f=>[f,sha(path.join(output,'dist',f))])),preserved_files:Object.fromEntries(preserved.map(f=>[f,sha(path.join(snapshot,'dist',f))])),original_index_sha256:sha(path.join(snapshot,'dist/index.js')),note:'Live index patched only to record digest events. Sending flags and cron unchanged.'},null,2));
fs.writeFileSync(path.join(output,'Dockerfile'),`FROM ${baseImage}\n`+files.map(f=>`COPY --chown=expressjs:nodejs dist/${f} /app/dist/${f}`).join('\n')+'\n');
fs.writeFileSync(path.join(output,'.dockerignore'),'*\n!Dockerfile\n!dist\n!dist/**\n');
fs.copyFileSync(path.join(api,'fly.toml'),path.join(output,'fly.toml'));
console.log(`Prepared ${files.length} files; preserved voice/calling modules and all existing dependencies.`);
