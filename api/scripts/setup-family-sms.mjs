import "dotenv/config";
import fs from "node:fs";
import twilio from "twilio";
const mode = process.argv[2] || "--status";
if (!["--status", "--prepare", "--activate"].includes(mode))
  throw Error("Use --status, --prepare or --activate");
for (const key of [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FAMILY_NUMBER",
  "FAMILY_TWILIO_WEBHOOK_URL",
])
  if (!process.env[key]) throw Error(`Missing ${key}`);
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);
const number = (
  await client.incomingPhoneNumbers.list({
    phoneNumber: process.env.TWILIO_FAMILY_NUMBER,
    limit: 2,
  })
)[0];
if (!number?.capabilities.sms || !number.capabilities.voice)
  throw Error("The configured number must support voice and SMS");
const services = await client.messaging.v1.services.list({ limit: 100 });
const matches = services.filter((s) =>
  process.env.TWILIO_REPORT_MESSAGING_SERVICE_SID
    ? s.sid === process.env.TWILIO_REPORT_MESSAGING_SERVICE_SID
    : s.friendlyName === "MyFriend family SMS",
);
if (matches.length > 1)
  throw Error(
    "Multiple matching services; set TWILIO_REPORT_MESSAGING_SERVICE_SID",
  );
let service = matches[0];
if (!service && mode === "--prepare")
  service = await client.messaging.v1.services.create({
    friendlyName: "MyFriend family SMS",
    usecase: "discussion",
    useInboundWebhookOnNumber: true,
    smartEncoding: true,
    stickySender: true,
    validityPeriod: 1800,
  });
if (!service) {
  console.log(
    "No MyFriend Messaging Service. Run --prepare to create one without changing phone routing.",
  );
  process.exit(0);
}
if (mode === "--prepare") {
  const key = "TWILIO_REPORT_MESSAGING_SERVICE_SID";
  let env = fs.readFileSync(".env", "utf8");
  env = env.replace(new RegExp("^" + key + "=.*\\n?", "mg"), "");
  fs.writeFileSync(".env", env + "\n" + key + "=" + service.sid + "\n", {
    mode: 0o600,
  });
  console.log(
    "Messaging Service prepared:",
    service.sid,
    "; phone routing unchanged.",
  );
}
const campaigns = await client.messaging.v1
  .services(service.sid)
  .usAppToPerson.list({ limit: 20 });
const senders = await client.messaging.v1
  .services(service.sid)
  .phoneNumbers.list({ limit: 100 });
console.log(
  JSON.stringify({
    service: service.sid,
    number: number.phoneNumber,
    senderAttached: senders.some((s) => s.sid === number.sid),
    campaigns: campaigns.map((c) => ({ status: c.campaignStatus })),
    voiceUrl: number.voiceUrl,
    smsUrl: number.smsUrl,
    useNumberWebhook: service.useInboundWebhookOnNumber,
  }),
);
if (mode === "--activate") {
  if (!campaigns.some((c) => c.campaignStatus === "VERIFIED"))
    throw Error("US SMS campaign must be VERIFIED before activation");
  const inbound = new URL(process.env.FAMILY_TWILIO_WEBHOOK_URL);
  inbound.pathname = inbound.pathname.replace(/\/$/, "");
  if (inbound.protocol !== "https:")
    throw Error("Activation needs a public HTTPS webhook");
  const r = await fetch(inbound.origin + "/api/family/status", {
    headers: { Authorization: `Bearer ${process.env.API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const status = await r.json();
  if (
    !r.ok ||
    !status.available ||
    status.provider !== "twilio" ||
    status.phone !== number.phoneNumber ||
    !status.smsDeliveryTracking
  )
    throw Error(
      "Deploy and enable the matching SMS backend before changing routing",
    );
  const callback = await fetch(inbound.href + "/status", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
  });
  if (callback.status !== 403)
    throw Error("Status callback signature check is not deployed");
  fs.writeFileSync(
    ".env.sms-routing-backup.json",
    JSON.stringify(
      {
        numberSid: number.sid,
        voiceUrl: number.voiceUrl,
        voiceMethod: number.voiceMethod,
        smsUrl: number.smsUrl,
        smsMethod: number.smsMethod,
        serviceSid: service.sid,
        useInboundWebhookOnNumber: service.useInboundWebhookOnNumber,
        inboundRequestUrl: service.inboundRequestUrl,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  if (!senders.some((s) => s.sid === number.sid))
    await client.messaging.v1
      .services(service.sid)
      .phoneNumbers.create({ phoneNumberSid: number.sid });
  await client.messaging.v1
    .services(service.sid)
    .update({
      inboundRequestUrl: inbound.href,
      inboundMethod: "POST",
      statusCallback: inbound.href + "/status",
      useInboundWebhookOnNumber: false,
      smartEncoding: true,
    });
  const after = await client.incomingPhoneNumbers(number.sid).fetch();
  if (
    after.voiceUrl !== number.voiceUrl ||
    after.voiceMethod !== number.voiceMethod
  )
    throw Error(
      "Voice configuration changed unexpectedly; inspect before proceeding",
    );
  console.log(
    "SMS routing activated. Voice webhook verified unchanged. Confirm sender registration and a real two-way test before enabling daily reports.",
  );
}
