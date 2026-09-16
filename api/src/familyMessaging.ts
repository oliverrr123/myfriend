import express from "express";
import { familyTestPhone, familyRecipientAllowed } from "./lib/familyTestScope";
import {
  parseSmsReceipt,
  smsStatusCallbackUrl,
  validTwilioWebhook,
} from "./lib/twilioSmsPolicy";
import { app } from "./app";
import { authenticateApiKey } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { getAccountForBuyer } from "./lib/subscriptions";
import { normalizePhoneNumber } from "./lib/phoneNormalize";
import { answerFamilyMessage, type FamilyJob } from "./lib/familyAssistant";
import { sharingContext } from "./lib/familyAssistantPolicy";
import { canShareReport } from "./lib/checkinPolicy";
import {
  familyMessagingReady,
  sendFamilyText,
  startPhoton,
  type IncomingFamilyMessage,
} from "./lib/familyTransport";

export async function enqueueFamilyMessage(input: IncomingFamilyMessage) {
  const phone = normalizePhoneNumber(input.phone);
  if (
    !phone ||
    !familyRecipientAllowed(phone) ||
    !/^\+[1-9]\d{7,14}$/.test(input.phone) ||
    input.body.length > 4000 ||
    !input.body.trim()
  )
    return;
  const account = await getAccountForBuyer(phone);
  if (!account || account.subscription.senior_phone_number === phone) return;
  const sub = account.subscription;
  const { data: existing, error: eError } = await supabase
    .from("family_messages")
    .select("id")
    .eq("provider", input.provider)
    .eq("provider_message_id", input.id)
    .maybeSingle();
  if (eError) throw eError;
  if (existing) return;
  const stop = /^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(
    input.body.trim(),
  );
  const start = /^(start|unstop)$/i.test(input.body.trim());
  const { data: connection, error: cError } = await supabase
    .from("family_message_connections")
    .select("*")
    .eq("subscription_id", sub.id)
    .maybeSingle();
  if (cError) throw cError;
  if (stop) {
    const { error } = await supabase.from("family_message_connections").upsert({
      subscription_id: sub.id,
      provider: input.provider,
      sender_phone: phone,
      route: input.route,
      opted_out: true,
      pending_action: null,
      pending_code: null,
      pending_expires_at: null,
    });
    if (error) throw error;
    const { error: pError } = await supabase
      .from("daily_checkin_preferences")
      .update({ report_channel: "none", recipient_consent_at: null })
      .eq("subscription_id", sub.id);
    if (pError) throw pError;
  } else {
    if (connection?.opted_out && !start) return;
    const { error } = await supabase.from("family_message_connections").upsert({
      subscription_id: sub.id,
      provider: input.provider,
      sender_phone: phone,
      route: input.route,
      opted_out: false,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  if (!stop && !start) {
    const { count, error: rateError } = await supabase
      .from("family_messages")
      .select("id", { count: "exact", head: true })
      .eq("subscription_id", sub.id)
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (rateError) throw rateError;
    if ((count ?? 0) >= 60) return;
  }
  const { error } = await supabase.from("family_messages").insert({
    provider: input.provider,
    provider_message_id: input.id,
    subscription_id: sub.id,
    sender_phone: phone,
    route: input.route,
    body: input.body,
    // Retain opt-out event IDs even when Twilio sends the acknowledgement.
    ...(input.provider === "twilio" && (stop || start)
      ? { status: "skipped" }
      : {}),
    ...(input.body.trim().toUpperCase() === "HELP"
      ? {
          reply:
            "MyFriend helps with shared check-in updates and your family plan. Reply STOP to stop messages or START to resume. For support: https://trymyfriend.com",
        }
      : {}),
    ...(stop
      ? {
          reply:
            "Messages are stopped. Reply START to resume. Your loved one’s call schedule is unchanged.",
        }
      : {}),
  });
  if (error && error.code !== "23505") throw error;
}

app.post(
  "/api/family/twilio",
  express.urlencoded({ extended: false, limit: "32kb" }),
  async (req, res) => {
    const url = process.env.FAMILY_TWILIO_WEBHOOK_URL;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!url || !token || !familyMessagingReady("twilio"))
      return res.sendStatus(503);
    if (
      !validTwilioWebhook(
        url,
        String(req.headers["x-twilio-signature"] ?? ""),
        req.body,
      ) ||
      req.body.AccountSid !== process.env.TWILIO_ACCOUNT_SID ||
      req.body.To !== process.env.TWILIO_FAMILY_NUMBER
    )
      return res.sendStatus(403);
    if (!req.body.MessageSid || typeof req.body.Body !== "string")
      return res.sendStatus(400);
    try {
      // Advanced Opt-Out already sends HELP/START acknowledgements.
      if (req.body.OptOutType === "HELP")
        return res.type("text/xml").send("<Response/>");
      await enqueueFamilyMessage({
        provider: "twilio",
        id: req.body.MessageSid,
        phone: req.body.From,
        body:
          req.body.OptOutType === "STOP"
            ? "STOP"
            : req.body.OptOutType === "START"
              ? "START"
              : req.body.Body,
        route: { to: req.body.To },
      });
      return res.type("text/xml").send("<Response/>");
    } catch {
      return res.sendStatus(503);
    }
  },
);

app.post(
  "/api/family/twilio/status",
  express.urlencoded({ extended: false, limit: "32kb" }),
  async (req, res) => {
    if (
      !validTwilioWebhook(
        smsStatusCallbackUrl() ?? undefined,
        String(req.headers["x-twilio-signature"] ?? ""),
        req.body,
      )
    )
      return res.sendStatus(403);
    if (req.body.From && req.body.From !== process.env.TWILIO_FAMILY_NUMBER)
      return res.sendStatus(403);
    const receipt = parseSmsReceipt(req.body);
    if (!receipt) return res.sendStatus(400);
    const { error } = await supabase
      .from("family_sms_delivery_events")
      .upsert(receipt, {
        onConflict: "message_sid,status",
        ignoreDuplicates: true,
      });
    return res.sendStatus(error ? 503 : 204);
  },
);

app.get("/api/family/status", authenticateApiKey, (_req, res) =>
  res.json({
    available: familyMessagingReady(),
    smsDeliveryTracking: process.env.FAMILY_MESSAGING_PROVIDER === "twilio",
    provider: process.env.FAMILY_MESSAGING_PROVIDER ?? null,
    phone: process.env.FAMILY_MESSAGING_PROVIDER === "twilio" && familyMessagingReady("twilio")
      ? process.env.TWILIO_FAMILY_NUMBER
      : null,
  }),
);
app.post("/api/family/connect", authenticateApiKey, async (req, res) => {
  try {
    if (!familyMessagingReady())
      return res.status(503).json({ error: "Messaging is not available yet." });
    const phone = normalizePhoneNumber(req.body.buyer_phone);
    if (phone && !familyRecipientAllowed(phone)) return res.status(503).json({error:"Messaging is currently being tested."});
    const account = phone ? await getAccountForBuyer(phone) : null;
    if (!phone || !account)
      return res.status(404).json({ error: "Account not found." });
    if (account.subscription.status !== "active")
      return res
        .status(409)
        .json({ error: "An active plan is required to start the assistant." });
    if (account.subscription.senior_phone_number === phone)
      return res.status(409).json({
        error: "The messaging assistant is currently for family members.",
      });
    const { data: connection, error: connectionError } = await supabase
      .from("family_message_connections")
      .select("opted_out")
      .eq("subscription_id", account.subscription.id)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (connection?.opted_out)
      return res.status(409).json({
        error:
          "Reply START in your existing MyFriend conversation to resume messages.",
      });
    // One welcome per account/provider; repeated button presses do not send again.
    await enqueueFamilyMessage({
      provider: process.env.FAMILY_MESSAGING_PROVIDER as "photon" | "twilio",
      id: `welcome:${account.subscription.id}`,
      phone,
      body: "Hello MyFriend. I just finished setting up the family account. Help me get started.",
      route: {},
    });
    return res.json({ ok: true });
  } catch {
    return res
      .status(503)
      .json({ error: "Could not start your conversation. Please try again." });
  }
});

async function claimNextFamilyMessage() {
  const phone = familyTestPhone();
  if (phone) {
    // Owner mode runs in one local worker. Keep all queue maintenance scoped too.
    for (const [status, next] of [["processing", "queued"], ["sending", "unknown"]]) {
      const {error} = await supabase.from("family_messages").update({status:next,locked_at:null})
        .eq("sender_phone",phone).eq("status",status).lt("locked_at",new Date(Date.now()-120000).toISOString());
      if (error) throw error;
    }
    const {data:busy,error:busyError} = await supabase.from("family_messages").select("id")
      .eq("sender_phone",phone).in("status",["processing","sending"]).limit(1).maybeSingle();
    if (busyError) throw busyError;
    if (busy) return null;
    const {data:candidate,error} = await supabase.from("family_messages").select("*")
      .eq("sender_phone",phone).eq("status","queued").lt("attempts",3).order("created_at").limit(1).maybeSingle();
    if (error) throw error;
    if (!candidate) return null;
    const {data:claimed,error:claimError} = await supabase.from("family_messages")
      .update({status:"processing",locked_at:new Date().toISOString(),attempts:candidate.attempts+1})
      .eq("id",candidate.id).eq("status","queued").eq("attempts",candidate.attempts).select("*").maybeSingle();
    if (claimError) throw claimError;
    return claimed as FamilyJob | null;
  }
  const { error: exhaustedError } = await supabase.from("family_messages")
    .update({status:"failed"}).eq("status","queued").gte("attempts",3);
  if (exhaustedError) throw exhaustedError;
  const {error:staleError} = await supabase.from("family_messages").update({status:"unknown"})
    .eq("status","sending").lt("locked_at",new Date(Date.now()-120000).toISOString());
  if (staleError) throw staleError;
  const {data:jobs,error} = await supabase.rpc("claim_family_message");
  if (error) throw error;
  return jobs?.[0] as FamilyJob | undefined;
}

export async function processFamilyQueue() {
  const job = await claimNextFamilyMessage();
  if (!job) return;
  try {
    const { data: connection, error: cError } = await supabase
      .from("family_message_connections")
      .select("*")
      .eq("subscription_id", job.subscription_id)
      .single();
    if (cError) throw cError;
    const stopReply =
      job.reply ===
      "Messages are stopped. Reply START to resume. Your loved one’s call schedule is unchanged.";
    if (
      (connection.opted_out && !stopReply) ||
      connection.provider !== job.provider
    ) {
      await supabase
        .from("family_messages")
        .update({ status: "skipped" })
        .eq("id", job.id);
      return;
    }
    const result = job.reply && !job.sharing_context
      ? { reply: job.reply, sharing_context: job.sharing_context }
      : await answerFamilyMessage(job);
    const { error: sError } = await supabase
      .from("family_messages")
      .update(result)
      .eq("id", job.id);
    if (sError) throw sError;
    // Consent may change while the model is thinking. Recheck before sending.
    const account = await getAccountForBuyer(job.sender_phone);
    const { data: latestConnection, error: lError } = await supabase
      .from("family_message_connections")
      .select("*")
      .eq("subscription_id", job.subscription_id)
      .single();
    if (lError) throw lError;
    if (
      !account ||
      account.subscription.id !== job.subscription_id ||
      (latestConnection.opted_out && !stopReply) ||
      latestConnection.provider !== job.provider
    ) {
      await supabase
        .from("family_messages")
        .update({ status: "skipped" })
        .eq("id", job.id);
      return;
    }
    if (result.sharing_context) {
      const { data: p, error: pError } = await supabase
        .from("daily_checkin_preferences")
        .select("*")
        .eq("subscription_id", job.subscription_id)
        .single();
      if (pError) throw pError;
      if (
        !canShareReport(p, account.subscription) ||
        sharingContext(p, account.subscription.senior_phone_number) !==
          result.sharing_context
      )
        result.reply =
          "Sharing settings changed while I was checking. I can only discuss updates your loved one currently agrees to share.";
    }
    const { error: claimError } = await supabase
      .from("family_messages")
      .update({ status: "sending", reply: result.reply })
      .eq("id", job.id);
    if (claimError) throw claimError;
    try {
      const sent = await sendFamilyText(
        job.provider,
        job.sender_phone,
        result.reply,
        latestConnection.route,
      );
      const { error: routeError } = await supabase
        .from("family_message_connections")
        .update({ route: sent.route })
        .eq("subscription_id", job.subscription_id)
        .eq("provider", job.provider);
      if (routeError) throw routeError;
      const { error: sentError } = await supabase
        .from("family_messages")
        .update({ status: "sent", outbound_message_id: sent.id })
        .eq("id", job.id);
      if (sentError) throw sentError;
    } catch (error) {
      await supabase
        .from("family_messages")
        .update({ status: "unknown" })
        .eq("id", job.id);
      if ((error as { code?: number }).code === 21610)
        await supabase
          .from("family_message_connections")
          .update({ opted_out: true })
          .eq("subscription_id", job.subscription_id);
    }
  } catch {
    // Retries occur before sending only; never redeliver an ambiguous external send.
    const { data: current } = await supabase
      .from("family_messages")
      .select("attempts")
      .eq("id", job.id)
      .single();
    await supabase
      .from("family_messages")
      .update({
        status: current?.attempts >= 3 ? "failed" : "queued",
        locked_at: null,
      })
      .eq("id", job.id)
      .eq("status", "processing");
  }
}
export async function startFamilyMessaging() {
  if (process.env.FAMILY_MESSAGING_ENABLED !== "true") return;
  let busy = false;
  let connecting = false;
  let reconnectAfter = 0;
  async function connect() {
    if (
      process.env.FAMILY_MESSAGING_PROVIDER !== "photon" ||
      familyMessagingReady() ||
      connecting ||
      Date.now() < reconnectAfter
    )
      return;
    connecting = true;
    try {
      await startPhoton(enqueueFamilyMessage);
    } catch {
      console.error("Photon connection failed; retrying in 30 seconds");
    } finally {
      connecting = false;
      reconnectAfter = Date.now() + 30000;
    }
  }
  await connect();
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await connect();
      if (familyMessagingReady()) await processFamilyQueue();
    } catch (error) {
      console.error("Family message queue failed", error instanceof Error ? error.message : (error as {code?:string})?.code ?? "unknown");
    } finally {
      busy = false;
    }
  }, 2000).unref();
}
