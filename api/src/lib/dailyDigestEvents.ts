import { supabase } from "./supabase";
import { findSubscriptionByPhone } from "./subscriptions";
import { canShareReport } from "./checkinPolicy";
import type { DigestKind } from "./dailyDigestPolicy";
type CompletedCall = {
    conversation_id: string;
    metadata: {
        start_time_unix_secs: number;
        call_duration_secs: number;
        phone_call?: {
            external_number?: string;
            direction?: string;
        };
    };
    transcript?: Array<{
        role: string;
        message?: string | null;
    }>;
    conversation_initiation_client_data?: {
        dynamic_variables?: Record<string, unknown>;
    };
};
export function digestCallFacts(call: CompletedCall) {
    const variables = call.conversation_initiation_client_data?.dynamic_variables ?? {};
    const isReminder = variables.reminder_call === true || variables.reminder_call === "true";
    const reason = typeof variables.reason === "string" ? variables.reason.toLowerCase() : "";
    const kind: DigestKind = !isReminder ? "conversation" : /medication|medicine|pills|léky|lék|prášky/.test(reason) ? "medication" : /water|hydration|vodu|vody|napít/.test(reason) ? "water" : "reminder";
    const userMessages = (call.transcript ?? []).filter(t => t.role === "user" && t.message?.trim());
    // A person mentioning their voicemail is still an answered conversation.
    // Only an automated greeting followed by no distinct human response is voicemail.
    const greeting = /^(?:(?:hello|hi|sorry)[,.!\s]*)?(?:message for\s+\+?\d[\d ()-]{6,}\d|you(?: have|'ve) reached\b|(?:please )?leave (?:a |your )?message\b|after the (?:tone|beep)\b|(?:toto je )?hlasov[áé] schrán|zanechte.*vzkaz)/i;
    const voicemail = userMessages.length > 0 && userMessages.every(t => greeting.test(t.message!.trim()));
    return { kind, answered: userMessages.length > 0 && !voicemail };
}
export async function recordDailyDigestEvent(call: CompletedCall) {
    const facts = digestCallFacts(call);
    // A silent inbound call is not evidence that we tried to reach the loved one.
    if (!facts.answered && call.metadata.phone_call?.direction !== 'outbound') return;
    const phone = call.metadata.phone_call?.external_number;
    if (!phone)
        return;
    const sub = await findSubscriptionByPhone(phone);
    if (!sub || sub.senior_phone_number !== phone)
        return;
    const { data: p, error } = await supabase.from("daily_checkin_preferences").select("*").eq("subscription_id", sub.id).maybeSingle();
    if (error)
        throw error;
    if (!p || !canShareReport(p, sub) || p.report_channel !== "messages" || !p.recipient_consent_at)
        return;
    const start = call.metadata.start_time_unix_secs * 1000;
    if (start < Math.max(Date.parse(p.reports_consent_at), Date.parse(p.recipient_consent_at)))
        return;
    const ended = new Date(start + Math.max(0, call.metadata.call_duration_secs) * 1000);
    const { error: saveError } = await supabase.from("family_digest_events").upsert({
        call_id: call.conversation_id, subscription_id: sub.id, senior_phone: phone, ...facts,
        ended_at: ended.toISOString(), available_at: new Date(Math.max(Date.now(), ended.getTime())).toISOString()
    }, { onConflict: "call_id", ignoreDuplicates: true });
    if (saveError)
        throw saveError;
}

// Initiation failures have no transcription event. Count confirmed no-answer/busy
// outcomes only; provider/configuration failures must never trigger a family alert.
export function unansweredFailureCall(event: unknown): CompletedCall | null {
    if (!event || typeof event !== 'object') return null;
    const e = event as Record<string, any>;
    const d = e.data;
    if (e.type !== 'call_initiation_failure' || !d || typeof d.conversation_id !== 'string' || !d.conversation_id.trim()) return null;
    if (!['no-answer', 'busy'].includes(d.failure_reason)) return null;
    const timestamp = e.event_timestamp;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() / 1000 + 300) return null;
    const body = d.metadata?.body;
    if (!body || typeof body !== 'object') return null;
    let phone: unknown;
    if (d.metadata.type === 'twilio') {
        if (!['outbound-api', 'outbound-dial', 'outbound'].includes(body.Direction) || body.CallStatus !== d.failure_reason) return null;
        phone = body.To;
    } else if (d.metadata.type === 'sip') {
        phone = body.to_number;
    } else return null;
    if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) return null;
    return { conversation_id:d.conversation_id, metadata:{start_time_unix_secs:timestamp,call_duration_secs:0,phone_call:{external_number:phone,direction:'outbound'}}, transcript:[] };
}

export async function recordUnansweredDigestEvent(event: unknown) {
    const call = unansweredFailureCall(event);
    if (call) await recordDailyDigestEvent(call);
}
