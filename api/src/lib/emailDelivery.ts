export function emailDeliveryReady() {
  return !!(process.env.RESEND_API_KEY && process.env.MYFRIEND_EMAIL_FROM);
}

export async function sendEmail(to: string, subject: string, text: string, idempotencyKey: string) {
  if (!emailDeliveryReady()) throw new Error("Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: process.env.MYFRIEND_EMAIL_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { id?: string };
  if (!response.ok || !result.id) throw new Error("Email delivery failed");
  return result.id;
}
