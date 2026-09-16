import { supabase } from "./supabase";
import {
  familyMessagingReady,
  sendFamilyText,
  type FamilyProvider,
} from "./familyTransport";
import type { ApprovedDigestMessage } from "./dailyDigestWriter";

export function messageReportsConfigured() {
  return familyMessagingReady();
}

export async function sendDailyDigest(
  to: string,
  message: ApprovedDigestMessage,
) {
  if (!message) return {ok:false as const,code:"empty_digest"};
  if (!messageReportsConfigured())
    throw new Error("Message reports are not configured");
  const { data: connection, error } = await supabase
    .from("family_message_connections")
    .select("*")
    .eq("sender_phone", to)
    .maybeSingle();
  if (error) throw error;
  if (!connection || connection.opted_out)
    return { ok: false as const, code: "recipient_not_connected" };
  try {
    const sent = await sendFamilyText(
      connection.provider as FamilyProvider,
      to,
      message,
      connection.route,
    );
    return { ok: true as const, sid: sent.id };
  } catch (error) {
    if ((error as { code?: number }).code === 21610)
      return { ok: false as const, code: "21610" };
    throw error;
  }
}
