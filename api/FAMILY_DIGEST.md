# Daily family messages

The authenticated finalized-call webhook records consented activity without storing raw summaries in digest events. At 20:00 in the recipient's timezone, one digest combines the preceding local day's chats and reminders. DST, late transcripts, per-date uniqueness, leases and uncertain deliveries are handled explicitly. Recipients without a known timezone are skipped.

Two model stages extract source-backed details and review privacy. Numbered source passages avoid losing facts when a model paraphrases its evidence. General learning and ordinary activities are shareable; personal disclosures and euphemisms for sensitive subjects are rejected. A separate writer speaks as MyFriend, uses the saved onboarding relationship, and adds a varied evening closing. Medication completion is always attributed to the caller's explicit self-report. A bounded writing retry and approved-fact fallback preserve useful details without exposing a failed draft or raw source.

Consent, current linked numbers, active billing, opt-out and delivery ownership are checked again before sending. Exact approved text is persisted and sent unchanged; an ambiguous send is never automatically repeated. Family replies can access only submitted sanitized digests.

## Validation

```sh
npm run build
npx tsx --test src/lib/checkinPolicy.test.ts src/lib/familyAssistantPolicy.test.ts tests/*.test.mjs
```

The release passes 62 focused backend tests. `scripts/evaluate-family-digest.ts` runs eight separately labelled synthetic live-model checks. The preview scripts take a local ElevenLabs export and never import database/delivery code. Real exports and previews must stay outside Git.

## Deployment

Database migrations through `20260915063101_family_daily_digest.sql` are already applied to the existing project. Verify migration history before any schema operation; do not replay these blindly. Digest tables are service-role-only with RLS enabled.

The existing production image contains voice changes not fully represented by this checkout. For this release, build TypeScript, snapshot `/app/dist` and `/app/package.json` from the running image, then run:

```sh
node scripts/prepare-family-digest-overlay.mjs LIVE_SNAPSHOT NEW_OUTPUT_DIR IMMUTABLE_BASE_IMAGE
flyctl deploy NEW_OUTPUT_DIR --app api-nameless-water-1932 --remote-only
```

The script verifies dependency parity, copies only family/digest modules, and patches only the digest event hook in the live entrypoint. Its manifest records changed and preserved hashes. The release does not enable `FAMILY_MESSAGING_ENABLED`, `CHECKIN_REPORTS_ENABLED`, `DAILY_CHECKINS_ENABLED`, or the report cron. Automatic delivery still requires a separately verified activation with current consent and an authorized recipient.
