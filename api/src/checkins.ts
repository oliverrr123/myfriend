import { parseCallChoice } from "./lib/quietDayDigest";
import { app } from "./app";
import { authenticateApiKey } from "./middleware/auth";
import { supabase } from "./lib/supabase";
import { findSubscriptionByPhone, getAccountForBuyer } from "./lib/subscriptions";
import { resolveCallParticipantsFromBody } from "./lib/callParticipants";
import { canCheckIn, canShareReport, parseCheckinPreferences, type CheckinPreferences } from "./lib/checkinPolicy";
import { messageReportsConfigured } from "./lib/reportDelivery";
import { processDailyDigests } from "./lib/dailyDigestWorker";
import { isValidTimezone } from "./lib/timezone";

const defaults: CheckinPreferences = { enabled: false, timezone: "America/New_York", call_hour: 10, report_channel: "none" };

type FriendlySchedule = {
	enabled: boolean;
	frequency: "daily" | "multiple" | "weekly";
	weekdays: number[];
	windows: Array<{ start: number; end: number }>;
	timezone: string;
};

function validFriendlySchedule(value: unknown): FriendlySchedule | null {
	if (!value || typeof value !== "object") return null;
	const p = value as FriendlySchedule;
	if (typeof p.enabled !== "boolean" || !["daily", "multiple", "weekly"].includes(p.frequency)) return null;
	if (!Array.isArray(p.weekdays) || !p.weekdays.length || p.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) return null;
	if (!Array.isArray(p.windows) || !p.windows.length || p.windows.length > 4) return null;
	if (p.windows.some(window => !Number.isInteger(window?.start) || !Number.isInteger(window?.end) || window.start < 0 || window.end > 1440 || window.start % 30 || window.end % 30 || window.end <= window.start)) return null;
	if (typeof p.timezone !== "string") return null;
	try { new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format(); } catch { return null; }
	return { ...p, weekdays: [...new Set(p.weekdays)].sort((a,b)=>a-b), windows: [...p.windows].sort((a,b)=>a.start-b.start) };
}

app.get("/api/account/friendly-calls", authenticateApiKey, async (req, res) => {
	try {
		const account = await getAccountForBuyer(String(req.query.buyer_phone ?? ""));
		if (!account) return res.status(404).json({ error: "Account not found." });
		const { data: preferences, error } = await supabase.from("daily_checkin_preferences").select("proposed_schedule, calls_consent_at, consent_senior_phone, schedule_confirmed_at").eq("subscription_id", account.subscription.id).maybeSingle();
		if (error) throw error;
		const { data: senior, error: seniorError } = account.subscription.senior_user_id
			? await supabase.from("users").select("timezone").eq("id", account.subscription.senior_user_id).maybeSingle()
			: { data: null, error: null };
		if (seniorError) throw seniorError;
		const { data: rows, error: callingError } = account.subscription.senior_user_id
			? await supabase.from("calling_preferences").select("weekdays,hour_range_from,hour_range_to").eq("user_id", account.subscription.senior_user_id)
			: { data: [], error: null };
		if (callingError) throw callingError;
		return res.json({
			proposed_schedule: preferences?.proposed_schedule ?? null,
			confirmed: Boolean(preferences?.schedule_confirmed_at && preferences?.calls_consent_at && preferences.consent_senior_phone === account.subscription.senior_phone_number && rows?.length),
			timezone: senior?.timezone ?? null,
			confirmed_at: preferences?.schedule_confirmed_at ?? null,
			calling_preferences: rows ?? [],
		});
	} catch { return res.status(503).json({ error: "Could not load friendly-call preferences." }); }
});

app.post("/api/account/friendly-calls", authenticateApiKey, async (req, res) => {
	const schedule = validFriendlySchedule(req.body.schedule);
	if (!schedule) return res.status(400).json({ error: "Choose valid suggested calling times." });
  if (req.body.digest_timezone !== undefined && (typeof req.body.digest_timezone !== "string" || !isValidTimezone(req.body.digest_timezone))) return res.status(400).json({error:"Choose a valid timezone for daily updates."});
	try {
		const account = await getAccountForBuyer(req.body.buyer_phone);
		if (!account || !account.subscription.senior_phone_number) return res.status(409).json({ error: "Add your loved one's number first." });
		const { error } = await supabase.from("daily_checkin_preferences").upsert({
			subscription_id: account.subscription.id,
			enabled: schedule.enabled,
			timezone: schedule.timezone,
			call_hour: Math.min(20, Math.max(8, Math.floor(schedule.windows[0].start / 60))),
			proposed_schedule: schedule,
      ...(req.body.digest_timezone ? {digest_timezone:req.body.digest_timezone} : {}),
			// Dashboard opt-in is saved with the toggle; callers still control sharing consent.
			...(typeof req.body.message_updates === "boolean" ? {
				report_channel: req.body.message_updates && schedule.enabled ? "messages" : "none",
				recipient_consent_at: req.body.message_updates && schedule.enabled ? new Date().toISOString() : null,
			} : {}),
			consent_senior_phone: null,
			calls_consent_at: null,
			schedule_confirmed_at: null,
			updated_at: new Date().toISOString(),
		}, { onConflict: "subscription_id" });
		if (error) throw error;
		return res.json({ ok: true, schedule, confirmed: false });
	} catch { return res.status(503).json({ error: "Could not save the suggested calling times." }); }
});

app.get("/api/account/checkins", authenticateApiKey, async (req, res) => {
	try {
		const account = await getAccountForBuyer(String(req.query.buyer_phone ?? ""));
		if (!account) return res.status(404).json({ error: "Account not found." });
		const { data: prefs, error } = await supabase.from("daily_checkin_preferences").select("*").eq("subscription_id", account.subscription.id).maybeSingle();
		if (error) throw error;
		const preferences = prefs ?? defaults;
		const reportsAllowed = canShareReport(preferences, account.subscription);
		return res.json({ preferences, calls_active: canCheckIn(preferences, account.subscription), reports_active: reportsAllowed, message_available: messageReportsConfigured(), delivery_available: process.env.CHECKIN_REPORTS_ENABLED === "true" });
	} catch { return res.status(503).json({ error: "Could not load check-ins." }); }
});

app.post("/api/account/checkins", authenticateApiKey, async (req, res) => {
	const prefs = parseCheckinPreferences(req.body);
	if (!prefs) return res.status(400).json({ error: "Choose a valid time, timezone, and report option." });
	if (prefs.report_channel !== "none" && req.body.recipient_consent !== true) return res.status(400).json({ error: "Confirm you want message updates." });
	if (prefs.enabled && prefs.report_channel === "messages" && !messageReportsConfigured()) return res.status(503).json({ error: "Text-message delivery is not available yet. You can still suggest friendly-call times." });
	try {
		const account = await getAccountForBuyer(req.body.buyer_phone);
		if (!account) return res.status(404).json({ error: "Account not found." });
		if (prefs.enabled && (account.subscription.status !== "active" || !account.subscription.senior_phone_number)) return res.status(409).json({ error: "Add their number to an active plan first." });
		const { error } = await supabase.from("daily_checkin_preferences").upsert({
			subscription_id: account.subscription.id, ...prefs,
			recipient_consent_at: prefs.report_channel !== "none" ? new Date().toISOString() : null,
			updated_at: new Date().toISOString(),
		});
		if (error) throw error;
		return res.json({ ok: true });
	} catch { return res.status(503).json({ error: "Could not save check-in preferences." }); }
});

// Voice-agent tool: only the linked grandparent's call can grant consent.
app.post("/api/confirmDailyCheckins", authenticateApiKey, async (req, res) => {
	const phone = resolveCallParticipantsFromBody(req.body).userPhoneNumber;
  const choice = parseCallChoice(req.body);
  if (!phone || !choice) return res.status(400).json({ error: "Provide an explicit call choice or sharing choice. Pauses need a valid future date or no end date." });
  try {
    const subscription = await findSubscriptionByPhone(phone);
    if (!subscription || subscription.senior_phone_number !== phone || subscription.status !== "active") return res.status(403).json({ error: "Only the linked loved one can confirm." });
    const { data, error } = await supabase.rpc("set_family_call_choices", {
      p_subscription_id: subscription.id, p_phone: phone,
      p_call_status: choice.status, p_allow_reports: choice.reports, p_pause_until: choice.pauseUntil,
    });
    if (error) throw error;
    return res.json({ ok: true, choices: data, message: "Saved their explicit choices. Unspecified choices were preserved." });
  } catch { return res.status(503).json({ error: "Could not save their choices." }); }
});

export async function checkinPrompt(phone: string) {
	try {
		const sub = await findSubscriptionByPhone(phone);
		if (!sub || sub.senior_phone_number !== phone || sub.status !== "active") return "";
		const { data: p } = await supabase.from("daily_checkin_preferences").select("*").eq("subscription_id", sub.id).maybeSingle();
		if (!p?.enabled) return "";
		const { data: buyer } = sub.buyer_user_id ? await supabase.from("users").select("first_name,nickname").eq("id", sub.buyer_user_id).maybeSingle() : { data: null };
		const { data: onboarding } = await supabase.from("onboarding_submissions").select("answers").eq("subscription_id", sub.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
		const relationship = typeof onboarding?.answers?.relationship === "string" ? ({ mom:"child", dad:"child", grandmother:"grandchild", grandfather:"grandchild", partner:"partner" } as Record<string,string>)[onboarding.answers.relationship] : null;
		const buyerName = buyer?.nickname || buyer?.first_name;
		const familyName = buyerName ? `${buyerName}${relationship ? `, your ${relationship}` : ""}` : relationship ? `your ${relationship}` : "the family member who set up your plan";
		const suggestion = p.proposed_schedule ? JSON.stringify(p.proposed_schedule) : `around ${p.call_hour}:00 in ${p.timezone}`;
		return `\nFAMILY FRIENDLY-CALL SETUP: ${familyName} set up this plan and suggested these possible calling times: ${suggestion}. This is only their suggestion; the caller decides whether and when you may call. Explain naturally that ${familyName} set you up for friendly conversations. Ask when THEY would like calls, then use saveCallingPreference with their answer so it becomes authoritative. Never silently accept the family's proposed time. Separately ask whether they agree to share a short, privacy-conscious note with ${familyName} in one daily message at 20:00 in the family recipient’s timezone, covering ordinary chats and reminder-call activity without private details${p.report_channel !== "none" ? "; they requested updates" : ""}. Existing call consent: ${!!p.calls_consent_at && p.consent_senior_phone === phone}; existing sharing consent: ${!!p.reports_consent_at && p.consent_senior_phone === phone}. Use confirmDailyCheckins after clear choices. Calls and family sharing are independent: declining or pausing calls does not revoke sharing. Only send the choice they actually made; omit other fields to preserve them. For a temporary pause pass call_status=paused and pause_until as an ISO timestamp with timezone (omit it for an indefinite pause). Never infer a refusal from silence. Use call_status=accepted to resume their existing confirmed schedule, or saveCallingPreference for new times. Never save a private explanation or invent a pause end date. Current saved call status: ${p.call_status ?? "not_set"}; pause until: ${p.call_pause_until ?? "none"}. Respect a no and allow either choice to be revoked. Occasionally and gently encourage them to call ${familyName}, when it fits the conversation; never make this a scripted ending. Friendly calls are ordinary conversations, not medical checks or monitoring.\n`;
	} catch { return ""; }
}

export async function recordCheckinReport(callId: string, phone: string, summary: unknown, duration: number) {
	const { data: run, error } = await supabase.from("daily_checkin_runs").select("id, subscription_id").eq("call_id", callId).eq("senior_phone", phone).maybeSingle();
	if (error) throw error;
	if (!run) return;
	const { data: prefs, error: prefsError } = await supabase.from("daily_checkin_preferences").select("*").eq("subscription_id", run.subscription_id).single();
	if (prefsError) throw prefsError;
	const subscription = await findSubscriptionByPhone(phone);
	const mayShare = prefs && subscription && subscription.id === run.subscription_id && canShareReport(prefs, subscription);
	const { error: updateError } = await supabase.from("daily_checkin_runs").update({ status: "completed", duration_seconds: Math.max(0, Math.round(duration)), summary: mayShare && typeof summary === "string" ? summary.slice(0,6000) : null }).eq("id",run.id);
	if (updateError) throw updateError;
}

// The scheduler can tick every five minutes; each recipient gets at most one 20:00 digest.
app.get("/api/webhook/daily-checkins", authenticateApiKey, async (_req, res) => {
  if (process.env.CHECKIN_REPORTS_ENABLED !== "true") return res.json({enabled:false});
  try { return res.json({initiated:0,...await processDailyDigests()}); }
  catch { return res.status(503).json({error:"Daily digest processing failed."}); }
});
