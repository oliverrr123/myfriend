// Content preview only: local ElevenLabs export + privacy model. No database or delivery imports.
import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { sanitizeDigestEvent } from '../src/lib/dailyDigestPrivacy';
import { type SafeDigestEvent } from '../src/lib/dailyDigestPolicy';

import { writeDailyDigest } from '../src/lib/dailyDigestWriter';

type Call = {
  id: string;
  summary: string | null;
  metadata: {start_time_unix_secs:number;call_duration_secs:number;phone_call:{external_number:string}};
  variables: Record<string, unknown>;
  transcript: Array<{role:string;message?:string|null}>;
};

async function main() {
  const [input, output, ...excludedPhones] = process.argv.slice(2);
  assert(input && output, 'Pass a source JSON file, output JSON file, and optional excluded caller numbers.');
  const source = JSON.parse(fs.readFileSync(input, 'utf8')) as {window:{start:string;end:string};calls:Call[];relationships?:Record<string,string|null>};
  const start = Date.parse(source.window.start), end = Date.parse(source.window.end);
  assert(Number.isFinite(start) && end > start);
  const groups = new Map<string, Call[]>();
  const seen = new Set<string>();
  for (const call of source.calls.sort((a,b)=>b.metadata.start_time_unix_secs-a.metadata.start_time_unix_secs)) {
    const phone = call.metadata.phone_call.external_number;
    const ended = (call.metadata.start_time_unix_secs + call.metadata.call_duration_secs) * 1000;
    if (excludedPhones.includes(phone) || seen.has(call.id) || ended < start || ended >= end) continue;
    seen.add(call.id);
    groups.set(phone, [...(groups.get(phone) ?? []), call]);
  }
  const selected = [...groups.entries()].slice(0,10);
  assert.equal(selected.length,10,'Need 10 distinct callers within the source window.');
  const previews = [];
  for (const [phone,calls] of selected) {
    const events:SafeDigestEvent[] = [];
    for (const call of calls.sort((a,b)=>a.metadata.start_time_unix_secs-b.metadata.start_time_unix_secs)) {
      const reminder = call.variables.reminder_call === true || call.variables.reminder_call === 'true';
      const turns = call.transcript.filter(t=>t.role === 'user' && t.message?.trim());
      const answered = turns.length > 0 && !turns.some(t=>/voicemail|message for\s+\+?\d[\d ()-]{6,}\d|you have reached|leave (a |your )?message|after the (tone|beep)|hlasov[áé] schrán|zanechte.*vzkaz/i.test(t.message ?? ''));
      const ended = new Date((call.metadata.start_time_unix_secs+call.metadata.call_duration_secs)*1000).toISOString();
      events.push(await sanitizeDigestEvent({call_id:call.id,kind:reminder?'reminder':'conversation',answered,summary:call.summary,ended_at:ended,available_at:ended}));
    }
    const relationship = source.relationships?.[phone] ?? null;
    const written = await writeDailyDigest(events, relationship);
    assert(written);
    const {message, generated, fallbackReason} = written;
    previews.push({phone,relationship,generated,fallbackReason,call_count:calls.length,call_ids:calls.map(c=>c.id),events,message});
    console.log(`Preview ${previews.length}/10 complete (${calls.length} calls).`);
  }
  const result = {
    note:'Real ElevenLabs calls; content previews only. No messages sent or queued, no database writes. Family consent, delivery eligibility and recipient-local 20:00 scheduling are not simulated here. The common 24-hour window uses call end times; original webhook receipt times are unavailable in this export.',
    window:source.window,previews,
  };
  fs.writeFileSync(output,JSON.stringify(result,null,2),{mode:0o600});
  const lines = ['# Family daily update — 10 real caller previews','',result.note,'',`Window: ${source.window.start} to ${source.window.end}.`,''];
  for(const p of previews) lines.push(`## ${p.phone} — ${p.call_count} calls`,'',p.message,'',`Source conversations: ${p.call_ids.map(id=>'`'+id+'`').join(', ')}`,'');
  fs.writeFileSync(output.replace(/\.json$/,'.md'),lines.join('\n'),{mode:0o600});
}

main().catch(error=>{console.error(error instanceof Error ? error.message : 'Preview failed');process.exit(1)});
