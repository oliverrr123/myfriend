import {
  parseCheckinPreferences,
  type CheckinPreferences,
} from "./checkinPolicy";

export type FamilyDecision = {
  intent: "reply" | "checkins" | "senior_phone" | "billing" | "discard";
  reply: string;
  enabled: boolean | null;
  call_hour: number | null;
  timezone: string | null;
  reports: boolean | null;
  senior_phone: string | null;
};
export type PendingAction =
  | {
      kind: "checkins";
      preferences: Pick<
        CheckinPreferences,
        "enabled" | "call_hour" | "timezone" | "report_channel"
      >;
      senior_phone: string | null;
    }
  | { kind: "senior_phone"; phone: string; previous_phone: string | null };

export function buildCheckinProposal(
  d: FamilyDecision,
  p: CheckinPreferences | null,
  seniorPhone: string | null,
): PendingAction | null {
  const preferences = parseCheckinPreferences({
    enabled: d.enabled ?? p?.enabled ?? false,
    call_hour: d.call_hour ?? p?.call_hour,
    timezone: d.timezone ?? p?.timezone,
    report_channel:
      d.reports === null
        ? (p?.report_channel ?? "none")
        : d.reports
          ? "messages"
          : "none",
  });
  return preferences
    ? { kind: "checkins", preferences, senior_phone: seniorPhone }
    : null;
}
export function confirmationCode(text: string) {
  return (
    /^confirm\s+([a-f0-9]{6})$/i.exec(text.trim())?.[1].toUpperCase() ?? null
  );
}
export function sharingContext(
  p: CheckinPreferences | null,
  seniorPhone: string | null,
) {
  return JSON.stringify([
    seniorPhone,
    p?.enabled,
    p?.consent_senior_phone,
    p?.calls_consent_at,
    p?.reports_consent_at,
  ]);
}
export function sharedReportText(completed: boolean, summary: string | null) {
  if (!completed)
	return "MyFriend: today's friendly call wasn't confirmed. That doesn't tell us how they're doing. You can ask me about the call or suggest another time.";
  return "MyFriend friendly call completed. Private call details are not included.";
}

export function normalizeFamilyPhone(value: string | null) {
  const phone = value?.replace(/[\s().-]/g, "") ?? "";
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
