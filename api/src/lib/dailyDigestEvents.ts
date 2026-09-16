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
    const voicemail = userMessages.some(t => /voicemail|message for\s+\+?\d[\d ()-]{6,}\d|you have reached|leave (a |your )?message|after the (tone|beep)|hlasov[áé] schrán|zanechte.*vzkaz/i.test(t.message ?? ""));
    return { kind, answered: userMessages.length > 0 && !voicemail };
}
export async function recordDailyDigestEvent(call: CompletedCall) {
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
        call_id: call.conversation_id, subscription_id: sub.id, senior_phone: phone, ...digestCallFacts(call),
        ended_at: ended.toISOString(), available_at: new Date(Math.max(Date.now(), ended.getTime())).toISOString()
    }, { onConflict: "call_id", ignoreDuplicates: true });
    if (saveError)
        throw saveError;
}
