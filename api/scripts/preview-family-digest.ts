// Read-only preview: local input + privacy model only. Never imports delivery or a worker.
import 'dotenv/config';
import fs from 'node:fs';
import { sanitizeDigestEvent } from '../src/lib/dailyDigestPrivacy';
import { writeDailyDigest } from '../src/lib/dailyDigestWriter';
async function main() {
    const input = process.argv[2];
    if (!input)
        throw new Error('Pass a local ElevenLabs preview JSON file.');
    const calls = JSON.parse(fs.readFileSync(input, 'utf8'));
    const previews = [];
    for (const call of calls) {
        const variables = call.variables ?? call.conversation_initiation_client_data?.dynamic_variables ?? {};
        const isReminder = variables.reminder_call === true || variables.reminder_call === 'true';
        const user = (call.transcript ?? []).filter((t: {
            role: string;
            message?: string;
        }) => t.role === 'user' && t.message?.trim());
        const answered = user.length > 0 && !user.some((t: {
            message: string;
        }) => /voicemail|message for\s+\+?\d[\d ()-]{6,}\d|you have reached|leave (a |your )?message|after the (tone|beep)|hlasov[áé] schrán|zanechte.*vzkaz/i.test(t.message));
        const ended = new Date((call.metadata.start_time_unix_secs + call.metadata.call_duration_secs) * 1000).toISOString();
        const safe = await sanitizeDigestEvent({ call_id: call.id, kind: isReminder ? 'reminder' : 'conversation', answered, summary: call.summary, ended_at: ended, available_at: ended });
        previews.push({ callId: call.id, phone: call.metadata.phone_call.external_number, title: call.title, topics: safe.topics, message: (await writeDailyDigest([safe]))?.message });
    }
    const output = process.argv[3] || '/tmp/myfriend-private-daily-digest-preview.json';
    fs.writeFileSync(output, JSON.stringify({ note: 'Real ElevenLabs calls, preview only. No messages sent, no queue or database writes.', previews }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(previews, null, 2));
}
main().catch(() => { console.error('Preview failed. Nothing was queued or sent.'); process.exit(1); });
