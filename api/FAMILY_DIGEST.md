# Daily family messages

The authenticated finalized-call webhook records consented activity without storing raw summaries in digest events. At 20:00 in the recipient's timezone, one digest combines the preceding local day's chats and reminders. DST, late transcripts, per-date uniqueness, leases and uncertain deliveries are handled explicitly. Recipients without a known timezone are skipped.

Two model stages extract source-backed details and review privacy. Numbered source passages avoid losing facts when a model paraphrases its evidence. General learning and ordinary activities are shareable; personal disclosures and euphemisms for sensitive subjects are rejected. A separate writer speaks as MyFriend, uses the saved onboarding relationship, and adds a varied evening closing. Medication completion is always attributed to the caller's explicit self-report. A bounded writing retry and approved-fact fallback preserve useful details without exposing a failed draft or raw source.

Consent, current linked numbers, active billing, opt-out and delivery ownership are checked again before sending. Exact approved text is persisted and sent unchanged; an ambiguous send is never automatically repeated. Family replies can access only submitted sanitized digests.

## Validation

```sh
npm run build
npx tsx --test src/lib/checkinPolicy.test.ts src/lib/familyAssistantPolicy.test.ts tests/*.test.mjs
```

The release passes 76 focused backend tests. `scripts/evaluate-family-digest.ts` runs eight separately labelled synthetic live-model checks. The preview scripts take a local ElevenLabs export and never import database/delivery code. Real exports and previews must stay outside Git.

## Deployment

Database migrations through `20260916070039_family_call_choices_and_quiet_days.sql` are already applied to the existing project. Verify migration history before any schema operation; do not replay these blindly. Digest tables are service-role-only with RLS enabled.

The existing production image contains voice changes not fully represented by this checkout. For this release, build TypeScript, snapshot `/app/dist` and `/app/package.json` from the running image, then run:

```sh
node scripts/prepare-family-digest-overlay.mjs LIVE_SNAPSHOT NEW_OUTPUT_DIR IMMUTABLE_BASE_IMAGE
flyctl deploy NEW_OUTPUT_DIR --app api-nameless-water-1932 --remote-only
```

The script verifies dependency parity, copies only family/digest modules, and patches only the digest event hook in the live entrypoint. Its manifest records changed and preserved hashes. The release does not enable `FAMILY_MESSAGING_ENABLED`, `CHECKIN_REPORTS_ENABLED`, `DAILY_CHECKINS_ENABLED`, or the report cron. Automatic delivery still requires a separately verified activation with current consent and an authorized recipient.

## Unanswered-only days

If a digest has attempts but no answered calls, it uses a deterministic, relationship-aware check-in nudge: “Hey, I tried calling your grandma today but couldn't reach her. You might want to give her a call to check in.” It omits the normal evening closing and never infers illness or missed medication. One answered call keeps the ordinary digest. No activity sends nothing unless a confirmed calling preference explains the quiet day, as described below. This remains one daily message at the usual cutoff, not an immediate alert.

The signed ElevenLabs `call_initiation_failure` event records confirmed outbound `no-answer` and `busy` attempts. Unknown/provider errors are ignored. Silent inbound calls are not outbound attempts; ordinary mentions of voicemail are still answered conversations. Existing consent/linkage checks and conversation-ID deduplication also apply to failed attempts. The failure timestamp is the provider's event time, since failure payloads do not provide a conversation start time.

After deploying the handler, `API_URL=https://your-api node scripts/enable-unanswered-call-events.mjs` adds failure events to the existing agent webhook subscriptions, verifies the HMAC destination, and checks that voice and other platform settings remain unchanged. It does not initiate calls, send messages, or enable report delivery. Event format: https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks


## Saved call choices and quiet days

The linked caller can accept, decline, pause indefinitely, or pause until an explicit date. `set_family_call_choices` saves that choice separately from permission to share family updates. Omitted choices are preserved. A confirmed new schedule resumes calls; a dated pause resumes the existing confirmed schedule when it expires. Declining or pausing never erases the saved calling windows or silently revokes sharing.

The existing `confirmDailyCheckins` ElevenLabs tool accepts these choices. Its production schema was updated without changing its ID, endpoint, authentication, or agent settings. `scripts/update-call-choice-tool.mjs` applies and verifies that narrowly scoped update.

At the usual 20:00 cutoff, a day with no call events can produce an explanation only from confirmed structured preferences:

- A confirmed schedule with no calling window in the digest period explains the selected calling days.
- An explicit decline or pause produces one notice per preference change, not a daily repeated notice. If there were calls too, the notice joins the ordinary digest.
- Missing consent, an unknown preference, or a scheduled call that never happened produces no invented explanation.

Quiet-day claims record the preference version. Changes during generation invalidate stale explanations. Sharing consent, linked numbers, recipient consent and billing are checked again before delivery. Pause/decline notice ownership also prevents duplicate notices and retries after an uncertain send. No private free-text explanation is stored or forwarded.

`tests/quiet-day-database.sql` contains database assertions intended to run inside `BEGIN`/`ROLLBACK`, covering independent consent, no repeat notices, schedule overlap, DST, expiration, wrong callers and private RPC permissions. These passed against the applied migration using temporary fixtures that were rolled back. Security advisor results were unchanged. Production verification matched all 18 overlay files and seven preserved live modules; all three automatic-sending flags remain false.
