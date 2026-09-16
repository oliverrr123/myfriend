import twilio from "twilio";

export function smsStatusCallbackUrl() {
  const inbound = process.env.FAMILY_TWILIO_WEBHOOK_URL;
  return inbound ? `${inbound.replace(/\/$/, "")}/status` : null;
}

export function validTwilioWebhook(
  url: string | undefined,
  signature: string,
  body: Record<string, string>,
) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  return (
    !!url &&
    !!token &&
    !!signature &&
    !!body &&
    body.AccountSid === process.env.TWILIO_ACCOUNT_SID &&
    twilio.validateRequest(token, signature, url, body)
  );
}

export const smsDeliveryStatuses = [
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "canceled",
  "read",
] as const;
export function parseSmsReceipt(body: Record<string, string>) {
  if (
    !/^SM[0-9a-f]{32}$/i.test(body.MessageSid ?? "") ||
    !smsDeliveryStatuses.includes(
      body.MessageStatus as (typeof smsDeliveryStatuses)[number],
    )
  )
    return null;
  return {
    message_sid: body.MessageSid,
    status: body.MessageStatus,
    error_code: /^\d{1,8}$/.test(body.ErrorCode ?? "") ? body.ErrorCode : null,
  };
}

// Receipt arrival order does not represent delivery order.
export function summarizeSmsDelivery(statuses: readonly string[]) {
  for (const state of [
    "read",
    "delivered",
    "undelivered",
    "failed",
    "canceled",
    "sent",
    "sending",
    "queued",
    "scheduled",
    "accepted",
  ]) {
    if (statuses.includes(state)) return state;
  }
  return "unknown";
}
