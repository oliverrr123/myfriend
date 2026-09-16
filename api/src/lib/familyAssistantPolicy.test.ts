import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCheckinProposal,
  confirmationCode,
  normalizeFamilyPhone,
  sharedReportText,
  sharingContext,
  type FamilyDecision,
} from "./familyAssistantPolicy";
const decision: FamilyDecision = {
  intent: "checkins",
  reply: "",
  enabled: true,
  call_hour: null,
  timezone: null,
  reports: null,
  senior_phone: null,
};
const prefs = {
  enabled: true,
  call_hour: 10,
  timezone: "Europe/Prague",
  report_channel: "none" as const,
  consent_senior_phone: "+12025550190",
  calls_consent_at: "2026-09-08",
  reports_consent_at: "2026-09-08",
};
test("settings cannot invent a timezone or hour; report opt-in must be explicit", () => {
  assert.equal(buildCheckinProposal(decision, null, "+12025550190"), null);
  const action = buildCheckinProposal(
    { ...decision, call_hour: 11 },
    prefs,
    "+12025550190",
  );
  assert.equal(action?.kind, "checkins");
  if (action?.kind === "checkins") {
    assert.equal(action.preferences.report_channel, "none");
    assert.equal(action.preferences.timezone, "Europe/Prague");
    assert.equal(action.preferences.call_hour, 11);
  }
  const reports = buildCheckinProposal(
    { ...decision, reports: true },
    prefs,
    "+12025550190",
  );
  if (reports?.kind === "checkins")
    assert.equal(reports.preferences.report_channel, "messages");
});
test("only an exact confirmation approves a proposal", () => {
  for (const text of [
    "yes",
    "confirm",
    "please CONFIRM ABC123",
    "CONFIRM ABC123 and change phone",
    "ABC123",
  ])
    assert.equal(confirmationCode(text), null);
  assert.equal(confirmationCode(" confirm abc123 "), "ABC123");
});
test("linked numbers require international phone syntax", () => {
  assert.equal(normalizeFamilyPhone("+1 (202) 555-0190"), "+12025550190");
  for (const text of [
    null,
    "grandma",
    "2025550190",
    "+0 12345678",
    "+12025550190 garbage",
    "+123",
  ])
    assert.equal(normalizeFamilyPhone(text), null);
});
test("revoking consent or replacing the loved one invalidates report context", () => {
  const original = sharingContext(prefs, "+12025550190");
  assert.notEqual(
    sharingContext({ ...prefs, reports_consent_at: null }, "+12025550190"),
    original,
  );
  assert.notEqual(sharingContext(prefs, "+12025550191"), original);
});
test("reports are readable in chat and do not infer wellbeing from a missed call", () => {
  assert.match(
    sharedReportText(false, null),
    /doesn't tell us how they're doing/,
  );
  assert.doesNotMatch(
    sharedReportText(true, "Enjoyed gardening."),
    /Enjoyed gardening/,
  );
  assert.doesNotMatch(sharedReportText(true, null), /dashboard|https:/);
  assert.match(sharedReportText(true, null), /Private call details are not included/);
});
