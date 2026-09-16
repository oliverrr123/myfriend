import twilio from "twilio";
import { familyRecipientAllowed } from "./familyTestScope";
import { smsStatusCallbackUrl } from "./twilioSmsPolicy";

export type FamilyProvider = "photon" | "twilio";
export type FamilyRoute = Record<string, string>;
export type IncomingFamilyMessage = {
  provider: FamilyProvider;
  id: string;
  phone: string;
  body: string;
  route: FamilyRoute;
};
type Sender = (
  phone: string,
  body: string,
  route: FamilyRoute,
) => Promise<{ id: string; route: FamilyRoute }>;
let photonSender: Sender | null = null;

export function familyMessagingReady(
  provider = process.env.FAMILY_MESSAGING_PROVIDER,
) {
  if (process.env.FAMILY_MESSAGING_ENABLED !== "true") return false;
  return provider === "photon"
    ? !!photonSender
    : provider === "twilio" &&
        !!(
          process.env.TWILIO_ACCOUNT_SID &&
          process.env.TWILIO_AUTH_TOKEN &&
          process.env.TWILIO_FAMILY_NUMBER &&
          process.env.TWILIO_REPORT_MESSAGING_SERVICE_SID &&
          process.env.FAMILY_TWILIO_WEBHOOK_URL
        );
}
async function deliverFamilyText(
  provider: FamilyProvider,
  phone: string,
  body: string,
  route: FamilyRoute,
) {
  if (!familyRecipientAllowed(phone)) throw new Error("Recipient is outside the owner test.");
  if (!familyMessagingReady(provider))
    throw new Error("Messaging provider is not ready");
  if (provider === "photon") return photonSender!(phone, body, route);
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  const message = await client.messages.create({
    to: phone,
    from: process.env.TWILIO_FAMILY_NUMBER,
    messagingServiceSid: process.env.TWILIO_REPORT_MESSAGING_SERVICE_SID,
    body,
    statusCallback: smsStatusCallbackUrl() ?? undefined,
  });
  return { id: message.sid, route: { to: process.env.TWILIO_FAMILY_NUMBER! } };
}
export async function startPhoton(
  receive: (message: IncomingFamilyMessage) => Promise<void>,
) {
  if (
    process.env.FAMILY_MESSAGING_ENABLED !== "true" ||
    process.env.FAMILY_MESSAGING_PROVIDER !== "photon"
  )
    return;
  if (!process.env.SPECTRUM_PROJECT_ID || !process.env.SPECTRUM_PROJECT_SECRET)
    throw new Error("Photon credentials missing");
  const [{ Spectrum }, { imessage }] = await Promise.all([
    import("@spectrum-ts/core"),
    import("@spectrum-ts/imessage"),
  ]);
  const app = await Spectrum({
    projectId: process.env.SPECTRUM_PROJECT_ID,
    projectSecret: process.env.SPECTRUM_PROJECT_SECRET,
    providers: [imessage.config()],
  });
  const im = imessage(app);
  photonSender = async (phone, body, route) => {
    const space = route.space_id
      ? await im.space.get(
          route.space_id,
          route.line && route.line !== "shared"
            ? { phone: route.line }
            : undefined,
        )
      : await im.space.create(await im.user(phone));
    if (space.type !== "dm")
      throw new Error("Family messages require a private conversation");
    const sent = await space.send(body);
    if (!sent) throw new Error("Message delivery outcome unknown");
    return { id: sent.id, route: { space_id: space.id, line: space.phone } };
  };
  void (async () => {
    try {
      for await (const [space, message] of app.messages) {
        if (
          message.platform !== "imessage" ||
          message.direction !== "inbound" ||
          message.content.type !== "text"
        )
          continue;
        const dm = imessage(space);
        if (dm.type !== "dm" || !message.sender?.id) continue;
        try {
          await receive({
            provider: "photon",
            id: message.id,
            phone: message.sender.id,
            body: message.content.text,
            route: { space_id: space.id, line: dm.phone },
          });
        } catch {
          console.error("Could not enqueue family iMessage");
        }
      }
    } catch {
      console.error("Photon message stream failed");
    } finally {
      photonSender = null;
      console.error("Photon message stream stopped; waiting to reconnect");
    }
  })();
}

// Once an external send starts, timeout means unknown, never safe to retry.
export async function sendFamilyText(
  provider: FamilyProvider,
  phone: string,
  body: string,
  route: FamilyRoute,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      deliverFamilyText(provider, phone, body, route),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Message delivery outcome unknown")),
          30000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
