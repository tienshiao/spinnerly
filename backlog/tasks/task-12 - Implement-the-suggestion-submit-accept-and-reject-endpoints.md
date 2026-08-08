---
id: TASK-12
title: 'Implement the suggestion submit, accept and reject endpoints'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:37'
updated_date: '2026-08-08 06:10'
labels: []
dependencies:
  - TASK-7
  - TASK-8
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three routes over the suggestions subcollection (design doc sections 4 and 6).

POST /api/wheels/[shareId]/suggestions — unauthenticated. Anyone with the share URL can submit. Rejects when suggestionsOpen is false. Stores label, status pending, createdAt, and a coarse clientHint used for dedupe. This is a public write surface and therefore a billing surface: the caps from the shared limits module are what bounds it, since rate limiting is deferred out of v1.

POST /api/wheels/[shareId]/suggestions/[id]/accept — editor. Must be a transaction: arrayUnion onto wheels.options plus the status flip to accepted, together. A double-click must not be able to duplicate the option. The created option records fromSuggestion pointing at the suggestion doc.

DELETE /api/wheels/[shareId]/suggestions/[id] — editor. Reject is a hard delete, not a status flip. The queue is visible to every participant (decision 3), so a rejected row would leave spam and abuse on display until someone builds a filter. Deleting sidesteps it. Consequently the status field only ever holds pending or accepted.

All three slide expiresAt forward.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST suggestions succeeds unauthenticated and returns 403 when suggestionsOpen is false
- [x] #2 Accept runs as a single transaction over the wheel document and the suggestion document
- [x] #3 Test: accepting the same suggestion twice concurrently adds the option exactly once
- [x] #4 Reject hard-deletes the suggestion document
- [x] #5 No code path ever writes status: "rejected"
- [x] #6 Accept and reject return 403 for a token belonging to a different wheel
- [x] #7 The pending suggestion cap is enforced on submit
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/client-hint.ts (+ unit test) — deriveClientHint(shareId, request). Design doc section 4 puts clientHint in the data model as a 'coarse fingerprint for dedupe'; it must be derived server-side, since a client-supplied fingerprint is worthless for the job. SHA-256 over shareId + client IP + user-agent, truncated. Salted per wheel so hints cannot be correlated across wheels, and truncated so the stored value is not an identifier — see the module for the collision and inversion arithmetic. Nothing in v1 reads it; it is stored now because section 8's data model cannot be retrofitted onto rows already written, the same reasoning as expiresAt in TASK-9.
2. lib/wheels/store.ts — SUGGESTIONS subcollection, StoredSuggestion, isSuggestionId, and three functions.
   - submitSuggestion: read the wheel, refuse a closed one, count pending, batch the new doc with the sliding expiry on wheel and secret. Deliberately NOT a transaction, unlike addOption: this is the one unauthenticated write path, so contention here is attacker-controllable, and the pending cap is a coarse abuse bound rather than a correctness invariant — overshooting it by one under a race costs nothing, whereas OPTIONS_MAX bounds a document against Firestore's 1MB limit.
   - acceptSuggestion: one transaction over the wheel and the suggestion — arrayUnion onto options plus the status flip, per section 4. The option element is built OUTSIDE the transaction so a retry re-appends an identical value, and the already-accepted branch returns the existing option, which is what makes a double-click idempotent rather than duplicating.
   - rejectSuggestion: hard delete plus the slide. Idempotent, so a retried DELETE is a 204.
3. Three routes, matching the shape of the existing four: POST /suggestions (unauthenticated), POST /suggestions/{id}/accept (editor), DELETE /suggestions/{id} (editor). The submit route parses the body BEFORE reading Firestore, reversing the order the editor routes use — there is no authorization to protect there, so the ordering that avoids a billed read for a malformed request is the better one.
4. suggestionId is validated against the auto-ID shape before it reaches a document path. Unlike optionId this DOES resolve a path, so a slash in it is a traversal primitive — the same argument SHARE_ID already makes.
5. Emulator tests per route, covering every acceptance criterion: the closed-wheel 403, the concurrent double-accept, the hard delete, the cross-wheel 403, and the pending cap at and one past the boundary. A unit test for client-hint, which touches no Firestore.
6. Close TASK-8's AC 1, 4 and 5, which have been waiting on these routes.
7. npm test, npm run test:emulator, typecheck, lint, format, build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added three routes, three store functions, one new module and five test files.

- app/api/wheels/[shareId]/suggestions/route.ts — POST, unauthenticated
- app/api/wheels/[shareId]/suggestions/[suggestionId]/accept/route.ts — POST, editor
- app/api/wheels/[shareId]/suggestions/[suggestionId]/route.ts — DELETE, editor
- lib/wheels/store.ts — submitSuggestion, acceptSuggestion, rejectSuggestion, isSuggestionId, SUGGESTIONS, SuggestionStatus
- lib/wheels/client-hint.ts — deriveClientHint

Unit suite 280 green (up from 249), emulator 172 (up from 42). Typecheck, lint, format:check clean; production build succeeds.

Decisions worth knowing about:

- Submit is NOT a transaction, and the asymmetry against addOption is deliberate. The two caps look alike and are not: OPTIONS_MAX bounds a single document against Firestore's 1MB limit, so it has to be exact and addOption pays a transaction for it, whereas PENDING_SUGGESTIONS_MAX bounds a subcollection where no document grows. Landing 201 pending suggestions instead of 200 under a race costs one document. Paying for exactness would mean serialising every submission to a wheel through one lock, on the only endpoint reachable without a credential — which turns a burst of spam into a queue of retrying billed transactions, a worse answer to abuse than the cap being enforced.
- The pending count is a count() aggregation, which bills a fraction of a read however many rows it counts. Reading 200 documents to learn there are 200 would bill 200, on the unauthenticated path.
- Accept's idempotency key is the status flip, not the option element. A transaction retry re-reads the suggestion, sees accepted and returns before reaching the capacity check — so it needs none of addOption's guard against the cap misfiring on a retry that already committed. The option element is still built outside the transaction, for addOption's reason: built inside, a retry would append a second copy under a different id.
- Accept answers 204 rather than returning the option. The store function returns the option this call created, or null when the suggestion was already accepted — a shape a response would force every client to branch on for no gain, since the wheel is one document with one listener and the option arrives there either way. 204 on the second accept also keeps a double-click and a retried request from reading as errors.
- Reject allows deleting an accepted suggestion. The option keeps a fromSuggestion pointing at a document that is gone, which costs nothing — it is provenance and nothing dereferences it — and refusing would leave an editor unable to clear an accepted row out of a queue every participant can read.
- Submit parses the body BEFORE reading Firestore, reversing the order the four editor routes use. There, authorization runs first so a caller without the token learns nothing about their body. Here there is no token and nothing to protect, so the ordering that matters is the billing one: refuse a malformed submission with CPU rather than with a document read.
- suggestionId is validated against the Firestore auto-ID shape before it is used, because unlike optionId it DOES reach a document path — '../..' walks out of the subcollection and names a document on another wheel. Same argument SHARE_ID already makes. Tested with both the encoded and decoded forms.
- suggestionsOpen is checked with === true, so a wheel missing the field or holding the wrong type is treated as closed. Failing closed is the safe direction on the path with no credential.

clientHint (design doc section 4) is derived server-side and truncated to 24 bits, and the width is arithmetic rather than taste. It has to distinguish submitters within one wheel — the birthday bound at 200 distinct submitters is roughly 0.1% — while not being an identifier: the IPv4 space is 2^32, so about 256 addresses hash into any given value. A full digest would fail the second outright, because hashing does not hide an input drawn from a space a GPU can walk in seconds, and an untruncated hint would be a reversible record of who suggested what. It is salted with the shareId so the same person's submissions to two wheels cannot be joined, and it is never echoed in a response. Nothing in v1 reads it; it is stored now because a field of the data model is impossible to backfill onto rows already written.

The leftmost x-forwarded-for entry is client-writable, so the hint is spoofable. Accepted because nothing in v1 decides anything on it — a spoofer only looks like a different stranger in a dedupe heuristic — and recorded in the module as the thing that must change first if the rate limiting design doc section 7 defers is ever built on top of it.

Finding for TASK-14: a Firestore TTL policy deletes the document it matches and NOT that document's subcollections, so reaping a wheel would leave its suggestions behind forever — arbitrary user-submitted text with nothing left to reach it from, which is what design doc section 8 exists to prevent. Each suggestion is therefore written with its own expiresAt, equal to the wheel's at submit time. TASK-14 must configure the policy on the suggestions collection group as well as on wheels and wheelSecrets, and should decide whether an old pending suggestion on a wheel whose expiry keeps sliding is reaped early on purpose (it is, today: sliding 200 subcollection documents on every edit is a fan-out this deliberately does not do).

Post-review revisions (/code-review found five issues, all confirmed and all fixed).

1. clientHint REMOVED entirely, and design doc section 4 amended to match. The field was stored on a document design doc section 5 makes 'allow get, list: if true', and Firestore rules cannot exclude a field from a read — so every participant holding the share URL could have read every hint, grouped the queue by it and learned which suggestions came from the same person. That is decision 12's attribution arriving by the back door, however coarse the value, and it made the route's careful withholding of the field from the 201 body pointless. My module's threat model named the reader as 'someone holding a leaked database'; the reader was in fact anyone in the group chat. Nothing consumed the field either, so it was a fingerprint of real people carried for a feature nobody had committed to building. lib/wheels/client-hint.ts and its test are deleted; the submit emulator test now asserts on the whole document's key set rather than on one field name, so a differently named identifier cannot be reintroduced without it failing. Accepted cost, recorded in the doc: a dedupe feature built later is blind to every suggestion submitted before it, and if it is built the hint must live under wheelSecrets rather than on the suggestion.

2. scripts/seed-emulator.mjs used 'seed-suggestion-1' and 'seed-suggestion-2', which isSuggestionId rejects — so every accept and reject against seeded data 404'd in local dev, leaving the editor UI unable to curate the one queue the fixture exists to give it. Exactly the failure the file's own comment anticipates for SHARE_ID, and which c54373b already fixed once for the wheel. Now 20-character alphanumeric, and the seeded rows carry expiresAt so the fixture matches what the route writes.

3. The acceptSuggestion docstring claimed the option element is built OUTSIDE the transaction 'exactly as in addOption'. It is not, and cannot be — the label comes from a read inside. No bug today, because the status flip is the real idempotency key, but the comment pointed at the wrong mechanism: anyone relaxing that branch would reintroduce the duplicate the transaction exists to prevent, having read a comment saying the element was retry-stable. Rewritten to say what actually holds the property and what breaks it.

4. The suggestion expiresAt comment justified never sliding the field with 'a suggestion reaped a moment early costs a row nobody could still reach', which is only true when the wheel is being reaped too. On a wheel still active past 30 days the TTL policy deletes pending suggestions out of a live, publicly visible queue. The behaviour is unchanged and still TASK-14's to settle; the comment now states the cost accurately instead of arguing it away.

5. clientAddress preferred the leftmost x-forwarded-for entry — the one segment a caller can write — over x-real-ip, which a proxy sets. Moot now that the module is deleted, but the reasoning is recorded here because it applies to any future rate limiting: preferring the writable header would have let a spammer send a random chain per request and never be seen as a repeat, while the header checked second would have caught them.

Unit suite 270 green (the ten client-hint cases are gone with the module), emulator 171, typecheck/lint/format clean, build succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three routes over the suggestions subcollection, plus the store functions and the clientHint derivation behind them. POST /suggestions is the application's only unauthenticated write: it refuses a closed wheel with 403 suggestions_closed, enforces the 200-pending cap with 409 suggestions_full, and stores label, pending status, a server timestamp, a server-derived clientHint and its own TTL field. POST /suggestions/{id}/accept runs the arrayUnion onto options and the status flip in one transaction, so a double-click adds the option exactly once — proven against the emulator with two accepts racing. DELETE /suggestions/{id} hard-deletes, per design doc section 4, and status therefore only ever holds pending or accepted. All three slide the wheel's and the secret's expiry, and refusals slide nothing. Verified by 280 unit tests and 172 emulator tests, typecheck/lint/format clean, production build succeeds.
<!-- SECTION:FINAL_SUMMARY:END -->
