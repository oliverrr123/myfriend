import { supabase } from "./supabase";
import { canShareReport } from "./checkinPolicy";
import { sharingContext } from "./familyAssistantPolicy";
import { familyRecipientAllowed } from "./familyTestScope";
import { sanitizeDigestEvent } from "./dailyDigestPrivacy";
import { type DigestEvent, type SafeDigestEvent } from "./dailyDigestPolicy";
import { messageReportsConfigured, sendDailyDigest } from "./reportDelivery";
import { writeDailyDigest } from "./dailyDigestWriter";
export async function processDailyDigests(deps = { db: supabase, write: writeDailyDigest, sanitize: sanitizeDigestEvent, send: sendDailyDigest, ready: messageReportsConfigured, allowed: familyRecipientAllowed, now: () => new Date() }) {
    const { db } = deps;
    let submitted = 0;
    if (!deps.ready())
        return { submitted };
    const { data: rows, error } = await db.from("daily_checkin_preferences").select("*, subscriptions(*)").eq("enabled", true);
    if (error)
        throw error;
    for (const p of rows ?? []) {
        const sub = p.subscriptions;
        if (!sub || !deps.allowed(sub.buyer_phone_number) || !canShareReport(p, sub) || p.report_channel !== "messages" || !p.recipient_consent_at)
            continue;
        let timezone = p.digest_timezone;
        if (!timezone && sub.buyer_user_id) {
            const { data: buyer, error } = await db.from("users").select("timezone").eq("id", sub.buyer_user_id).maybeSingle();
            if (error)
                throw error;
            timezone = buyer?.timezone;
        }
        // Do not guess the recipient's zone from the loved one's schedule.
        if (!timezone)
            continue;
        const { data: connection, error: cError } = await db.from("family_message_connections").select("opted_out,sender_phone").eq("subscription_id", sub.id).maybeSingle();
        if (cError)
            throw cError;
        if (!connection || connection.opted_out || connection.sender_phone !== sub.buyer_phone_number)
            continue;
        const stamp = JSON.stringify([sharingContext(p, sub.senior_phone_number), p.recipient_consent_at, sub.buyer_phone_number]);
        const { data: claimed, error: claimError } = await db.rpc("claim_family_daily_digest", { p_subscription_id: sub.id, p_timezone: timezone, p_consent_context: stamp, p_now: deps.now().toISOString() });
        if (claimError)
            throw claimError;
        const digest = claimed?.[0];
        if (!digest)
            continue;
        const { data: events, error: eError } = await db.from("family_digest_events").select("call_id,kind,answered,ended_at,available_at").eq("digest_id", digest.id);
        if (eError)
            throw eError;
        const safe: SafeDigestEvent[] = [];
        for (const e of events ?? []) {
            const { data: conversation, error } = await db.from("conversation_storage").select("summary").eq("call_id", e.call_id).eq("phone_number", sub.senior_phone_number).order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (error)
                throw error;
            safe.push(await deps.sanitize({ ...e, summary: conversation?.summary ?? null } as DigestEvent));
        }
        const { data: onboarding, error: oError } = await db.from("onboarding_submissions").select("answers").eq("subscription_id", sub.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (oError) throw oError;
        const written = await deps.write(safe, onboarding?.answers?.relationship);
        const message = written?.message;
        const { data: latest, error: lError } = await db.from("daily_checkin_preferences").select("*, subscriptions(*)").eq("subscription_id", sub.id).single();
        if (lError)
            throw lError;
        const current = latest?.subscriptions;
        const currentStamp = current && JSON.stringify([sharingContext(latest, current.senior_phone_number), latest.recipient_consent_at, current.buyer_phone_number]);
        const allowed = current && current.buyer_phone_number === digest.recipient_phone && current.senior_phone_number === digest.senior_phone && canShareReport(latest, current) && latest.report_channel === "messages" && latest.recipient_consent_at && currentStamp === digest.consent_context;
        if (!allowed || !message) {
            const { error } = await db.from("family_daily_digests").update({ status: "skipped" }).eq("id", digest.id).eq("status", "building").eq("claim_token", digest.claim_token);
            if (error)
                throw error;
            continue;
        }
        // Claim delivery once. Any error after this point is ambiguous and never resent.
        const { data: sending, error: sError } = await db.from("family_daily_digests").update({ status: "sending", message, safe_events: safe, locked_at: deps.now().toISOString() }).eq("id", digest.id).eq("status", "building").eq("claim_token", digest.claim_token).select("id").maybeSingle();
        if (sError)
            throw sError;
        if (!sending)
            continue;
        try {
            const sent = await deps.send(digest.recipient_phone, message);
            const { error } = await db.from("family_daily_digests").update(sent.ok ? { status: "submitted", message_sid: sent.sid } : { status: "skipped" }).eq("id", digest.id).eq("status", "sending");
            if (error)
                throw error;
            if (sent.ok)
                submitted++;
        }
        catch {
            const { error } = await db.from("family_daily_digests").update({ status: "unknown" }).eq("id", digest.id).eq("status", "sending");
            if (error)
                throw error;
        }
    }
    return { submitted };
}
