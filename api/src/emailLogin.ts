import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { app } from "./app";
import { authenticateApiKey } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { getAccountForBuyer } from "./lib/subscriptions";
import { accountPayload } from "./billing";
import { emailDeliveryReady, sendEmail } from "./lib/emailDelivery";

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
function authClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function accountForEmail(email: string) {
  // Escape LIKE metacharacters: an email must never select a different account.
  const { data, error } = await supabase.from("subscriptions").select("buyer_phone_number")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&")).limit(2);
  if (error) throw error;
  if (data?.length !== 1) return null;
  return getAccountForBuyer(data[0].buyer_phone_number);
}
async function rateLimit(key: string, maximum: number) {
  const { data, error } = await supabase.rpc("claim_email_login_attempt", { bucket_key: createHash("sha256").update(key).digest("hex"), maximum });
  if (error) throw error;
  return data === true;
}
app.post("/api/email-login/send", authenticateApiKey, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ error: "Enter a valid email address." });
  if (!emailDeliveryReady()) return res.status(503).json({ error: "Email sign-in isn't ready yet. Please try again shortly." });
  try {
    if (!await rateLimit(`send:${email}`, 5) || !await rateLimit(`ip:${String(req.body.client_ip ?? "unknown")}`, 20))
      return res.status(429).json({ error: "Too many requests. Please try again in an hour." });
    const account = await accountForEmail(email);
    if (account) {
      const { data, error } = await authClient().auth.admin.generateLink({ type: "magiclink", email });
      if (error || !data.properties?.email_otp) throw error ?? new Error("Missing code");
      await sendEmail(email, "Your MyFriend sign-in code", `Your MyFriend sign-in code is ${data.properties.email_otp}.\n\nEnter it on the MyFriend login page. If you didn't request this, you can ignore this email.`, `login-${randomUUID()}`);
    }
    return res.json({ ok: true, email, message: "If this email is linked to a MyFriend plan, your sign-in code is on its way." });
  } catch { return res.status(503).json({ error: "Couldn't send a sign-in email. Please try again." }); }
});
app.post("/api/email-login/check", authenticateApiKey, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email || typeof req.body.code !== "string" || !/^\d{6,10}$/.test(req.body.code))
    return res.status(400).json({ error: "Enter the code from your email." });
  try {
    if (!await rateLimit(`check:${email}`, 10)) return res.status(429).json({ error: "Too many attempts. Please try again in an hour." });
    const { data, error } = await authClient().auth.verifyOtp({ email, token: req.body.code, type: "email" });
    if (error || !data.session || !data.user?.email_confirmed_at || normalizeEmail(data.user.email) !== email)
      return res.status(401).json({ error: "That code is incorrect or expired. Request a new one." });
    const account = await accountForEmail(email);
    if (!account) return res.status(403).json({ error: "No MyFriend plan is linked to this email." });
    return res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in });
  } catch { return res.status(503).json({ error: "Couldn't sign in. Please try again." }); }
});
app.post("/api/email-login/session", authenticateApiKey, async (req, res) => {
  try {
    const auth = authClient();
    let token = typeof req.body.access_token === "string" ? req.body.access_token : "";
    let result = token ? await auth.auth.getUser(token) : null;
    let refreshed = null;
    if (!result || result.error) {
      if (typeof req.body.refresh_token !== "string") return res.status(401).json({ error: "Please log in again." });
      const refresh = await auth.auth.refreshSession({ refresh_token: req.body.refresh_token });
      if (refresh.error || !refresh.data.session) return res.status(401).json({ error: "Please log in again." });
      refreshed = refresh.data.session;
      token = refreshed.access_token;
      result = await auth.auth.getUser(token);
    }
    const user = result.data.user;
    const email = normalizeEmail(user?.email);
    if (result.error || !user?.email_confirmed_at || !email) return res.status(401).json({ error: "Please log in again." });
    const account = await accountForEmail(email);
    if (!account) return res.status(403).json({ error: "No MyFriend plan is linked to this email." });
    return res.json({ account: accountPayload(account.subscription, account.seniorFirstName, account.relationship), ...(refreshed ? { session: { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_in: refreshed.expires_in } } : {}) });
  } catch { return res.status(503).json({ error: "Couldn't load your account." }); }
});
app.post("/api/email-login/logout", authenticateApiKey, async (req, res) => {
  if (typeof req.body.access_token === "string") await authClient().auth.admin.signOut(req.body.access_token, "local");
  return res.json({ ok: true });
});
