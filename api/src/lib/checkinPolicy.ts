export type CheckinPreferences = {
  call_status?: "not_set" | "accepted" | "declined" | "paused";
  call_pause_until?: string | null;
  call_status_changed_at?: string | null;
  call_preference_version?: string;
	enabled: boolean;
	timezone: string;
	call_hour: number;
	report_channel: "none" | "messages";
	recipient_consent_at?: string | null;
	consent_senior_phone?: string | null;
	calls_consent_at?: string | null;
	reports_consent_at?: string | null;
	schedule_confirmed_at?: string | null;
};

export function parseCheckinPreferences(value: unknown): Pick<CheckinPreferences, "enabled" | "timezone" | "call_hour" | "report_channel"> | null {
	if (!value || typeof value !== "object") return null;
	const p = value as CheckinPreferences;
	if (typeof p.enabled !== "boolean" || !["none", "messages"].includes(p.report_channel) ||
		!Number.isInteger(p.call_hour) || p.call_hour < 8 || p.call_hour > 20 || typeof p.timezone !== "string") return null;
	try { new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format(); } catch { return null; }
	return { enabled: p.enabled, timezone: p.timezone, call_hour: p.call_hour, report_channel: p.report_channel };
}

export function canCheckIn(p: CheckinPreferences, subscription: { status: string; senior_phone_number: string | null }, now = new Date()) {
  const statusAllows = !p.call_status || p.call_status === "accepted" ||
    (p.call_status === "paused" && !!p.call_pause_until && Date.parse(p.call_pause_until) <= now.getTime());
	return statusAllows && p.enabled && subscription.status === "active" && !!subscription.senior_phone_number &&
		p.consent_senior_phone === subscription.senior_phone_number && !!p.calls_consent_at;
}

export function canShareReport(p: CheckinPreferences, subscription: { status: string; senior_phone_number: string | null }) {
	return p.enabled && subscription.status === "active" && !!subscription.senior_phone_number &&
    p.consent_senior_phone === subscription.senior_phone_number && !!p.reports_consent_at;
}

export function canPlaceFamilyCall(p: CheckinPreferences | null, subscription: { status: string; senior_phone_number: string | null }, rolloutEnabled: boolean) {
	return rolloutEnabled && !!p && !!p.schedule_confirmed_at && canCheckIn(p, subscription);
}
