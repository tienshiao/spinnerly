---
id: TASK-14
title: Implement sliding expiry and the Firestore TTL policy
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-07 08:37'
updated_date: '2026-08-08 09:27'
labels: []
dependencies:
  - TASK-9
  - TASK-10
  - TASK-11
priority: high
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
expiresAt is set 30 days out at creation and pushed forward 30 days on any activity — edit, suggestion, or spin (design doc section 8, decision 4). Active wheels are effectively permanent; only genuinely dead ones get reaped.

Why expiry exists at all, in priority order: it bounds a leaked share URL, which otherwise stays a permanently open write endpoint attached to a link nobody is tracking; it is data minimisation, since we accept arbitrary user text with no accounts and no moderation queue; and it is the only cleanup mechanism, because with no accounts nobody can ever delete a wheel. Storage cost is not a reason.

Decide and configure this before launch. The TTL policy is trivial at creation time and impossible to retrofit onto data users have already been told we would keep.

Firestore TTL deletes the wheel document. Subcollections are not cascaded — confirm what happens to orphaned suggestions and spins and handle it, whether by a cleanup job or by accepting the orphans.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every mutating route slides expiresAt forward by 30 days
- [ ] #2 A Firestore TTL policy on the expiresAt field of the wheels collection is configured and documented
- [x] #3 Orphaned suggestion and spin subcollection documents after a parent TTL delete are either cleaned up or explicitly accepted with a written rationale
- [x] #4 A request against an expired-but-not-yet-reaped wheel behaves predictably and is documented
- [x] #5 Tests confirm expiresAt moves forward on option add, option remove, suggestion submit and suggestion accept
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Sliding is already built and tested — createWheel sets expiresAt, and updateWheel, addOption, removeOption, submitSuggestion, acceptSuggestion and rejectSuggestion all slide the wheel and its secret through one slidingExpiry() helper, each with its own emulator assertion. AC 1 and AC 5 are therefore largely standing already; this task is the policy, the three decisions nobody has written down, and the two invariants no test states.

1. scripts/configure-ttl.mjs — applies and verifies the policy. firebase-tools has no TTL command (checked: only firestore:databases, backups, indexes, delete), so this goes through the Firestore Admin REST API: PATCH .../collectionGroups/{cg}/fields/expiresAt?updateMask=ttlConfig with body {ttlConfig:{}}, which returns a long-running Operation, and GET on the same resource to read ttlConfig.state back. Authenticated with the service-account credential lib/firebase/admin.ts already resolves, so it needs no new dependency and no gcloud.
   - Covers THREE collection groups, not one: wheels, wheelSecrets and suggestions. A policy is per collection group and covers every instance of that name in the hierarchy, so one suggestions policy reaps wheels/*/suggestions under every parent.
   - Idempotent, and has a --check mode that only reads. NEEDS_REPAIR is treated as a failure, not a pass — it means the policy took for new documents and failed for existing ones, which is exactly the state a check that only looked for 'ttlConfig exists' would call green.
   - Refuses to run against a demo- project or with FIRESTORE_EMULATOR_HOST set: the inverse of the seed script's guard, and for the same reason.
2. Decision, AC 3 — orphaned subcollections are handled by the field TASK-12 already writes, and the premature-reap consequence is accepted rather than fixed. A suggestion carries its own expiresAt equal to the wheel's at submit time and it is never slid, so a suggestion can never outlive its wheel (the unrecoverable direction) but can die under a live one after 30 days. Accepted because the fix is a fan-out of up to 200 subcollection writes on every edit, on a wheel whose submit path is unauthenticated, and because a suggestion nobody actioned in 30 days is the stale text section 8 wants gone. spins is phase 2 and unwritten; the policy covers the field name now so the collection group is already reaped when it arrives.
3. Decision, AC 4 — an expired-but-not-yet-reaped wheel behaves as a live wheel: readable, editable, forkable, and any write slides it back out of danger. Deletion is 'typically within 24 hours' and expired documents keep serving reads until the reaper runs, so the alternative is a second expiry check on every route that would disagree with what Firestore itself does. TASK-13 already relies on this window being usable. Documented, including that the anonymous keep-alive it implies — submitSuggestion is unauthenticated and slides — is bounded by the suggestionsOpen kill switch, since a refused submission writes nothing.
4. docs/spin-the-wheel-design.md — section 8 gains the policy, the three collection groups, the runbook and both decisions above. Section 4 gains the expiresAt field on wheelSecrets, which createWheel has written since TASK-7 and the data model never listed.
5. app/api/wheels/expiry.emulator.test.ts — the two invariants that hold the whole design up and that no per-route test states: a suggestion's expiresAt is never later than its wheel's, before and after the wheel slides; and the secret always outlives the wheel by its margin, table-driven across every mutating route rather than asserted route by route.
6. README — the before-launch TTL entry points at the script and the runbook.
7. npm test, npm run test:emulator, typecheck, lint, format, build.

Not in scope, and stated so the reviewer does not look for it: nothing here is applied to a cloud project. .firebaserc is demo-spinnerly and TASK-27 has not run, so AC 2 is delivered as configuration-as-code plus a verification command, and the apply belongs to whoever provisions the projects.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered: scripts/configure-ttl.mjs, the two lifecycle invariants as tests, and the decisions written into design doc section 8 and the decisions table as 20 and 21.

- scripts/configure-ttl.mjs — applies and verifies the policy on three collection groups. Firestore Admin REST API, because firebase-tools has no TTL command (verified against the installed 14.18.0: the CLI covers databases, backups, indexes and deletes and nothing else). PATCH .../collectionGroups/{cg}/fields/expiresAt?updateMask=ttlConfig with body {ttlConfig:{}}, GET on the same resource to read the state back.
- app/api/wheels/expiry.emulator.test.ts — 20 cases across the two invariants.
- docs/spin-the-wheel-design.md — section 8 gains the policy, the runbook and both decisions; section 4 gains expiresAt on wheelSecrets, which createWheel has written since TASK-7 and the data model never listed.
- README — TTL commands, and the before-launch entry now names the verification rather than the intention.

Emulator 228 (up from 208), unit 270; typecheck, lint, format:check clean, production build succeeds.

Decisions worth knowing about:

- Three collection groups, not one. wheels is obvious; the other two are the ones a runbook loses. Without a policy on wheelSecrets the secret outlives its wheel forever, assertEditor keeps authorising for a wheel that has been reaped, and the collection grows without bound. Without one on suggestions a reaped wheel leaves its whole queue behind, because a TTL delete does not cascade to the deleted document's subcollections. spins is deliberately absent: it is phase 2 and nothing writes one, so it joins the list in the change that first writes a spin.
- A script rather than a gcloud runbook, and the argument is the arithmetic: three collection groups times two projects is six chances to miss one, and missing one is silent. Nothing in the application depends on a policy existing, so the failure mode is that wheels keep working and simply never go away. The script has a --check mode that exits non-zero, which is the verification step the runbook version would have left as prose.
- NEEDS_REPAIR is treated as a failure rather than a pass. It means the policy took for newly written documents and failed for the ones already stored, so the obvious check — 'is there a ttlConfig?' — reports green while the entire stored backlog quietly never expires. CREATING is reported as pending, since enabling is a long-running operation.
- Authentication is Application Default Credentials, not the three FIREBASE_* variables the app uses. Those exist for Vercel's environment UI; this runs at an operator's terminal, where the natural artifact is the service-account JSON TASK-27 step 4 downloads, and where a private key pasted through a shell is the one input that fails as an unreadable PEM error. It also avoids importing lib/firebase/admin.ts, which a .mjs script cannot do — it is TypeScript and it imports server-only, which throws by design.
- Three guards, all verified to fire: no --project is a usage error (the project is never inferred, because spinnerly-prod and spinnerly-preview are close enough that a silent default is how the wrong one gets configured), a demo- prefix is refused, and FIRESTORE_EMULATOR_HOST being set is refused. That last is the inverse of the seed script's guard and for the same reason: TTL is cloud-only, so there is nothing local to configure and nothing local that could verify it.
- AC 3, decision 20 — the premature reap is accepted, not fixed. A suggestion's expiresAt is set equal to its wheel's at submit time and never slid, so it can never outlive its wheel (the unrecoverable direction) but can die under a live one 30 days after submission. Fixing that means sliding up to PENDING_SUGGESTIONS_MAX subcollection documents on every edit, on a wheel whose submit path is unauthenticated and therefore attacker-drivable. What is lost instead is a suggestion nobody actioned in a month, which is the stale text section 8 wants gone anyway.
- AC 4, decision 21 — an expired-but-unreaped wheel behaves as a live one. No route checks expiresAt. Firestore reaps typically within 24 hours and expired documents keep serving reads until it does, so the alternative is every route disagreeing with what the database is doing, and a wheel that 404s on write while still serving reads is stranger to explain than one that still works. TASK-13's escape hatch already depends on that window being usable.
- One consequence named in the doc because it reads like a hole: POST /suggestions is unauthenticated and it slides, so a leaked share URL can be kept alive indefinitely by submitting to it. The bound is the editor's kill switch — a submission refused because suggestionsOpen is false writes nothing and therefore slides nothing.

The tests were verified by mutation rather than only by passing. Removing SECRET_EXPIRY_MARGIN_DAYS failed all seven rows of the pairing table; making submitSuggestion write an expiry a day past its wheel's failed both ordering assertions; making acceptSuggestion slide its suggestion failed exactly the 'never slid by accept a suggestion' row. Each mutation was caught by the assertion meant to catch it and by nothing else.

Adjacent fix: the README command table described 'npm run test' as 'Node test runner — the local ESLint rules', which has been wrong since the move to Vitest. Corrected, and test:emulator and test:all added, since the table was being edited anyway.

Post-review fixes (/code-review, six findings, all confirmed and fixed):

- MEDIUM, the fixture violated the invariant it was used to test. seed() wrote the suggestion's expiresAt as a fresh Date.now() + 30 days, computed an emulator round trip AFTER createWheel had computed the wheel's — so the seeded suggestion expired a few milliseconds LATER than its wheel, which is exactly the state 'a suggestion never outlives its wheel' forbids. Every case passed only because each mutation slid the wheel back out in front; the invariant was never checked at rest. The fixture now reads the wheel's stored expiry back, which is what submitSuggestion writes, and a new case asserts the invariant with no write in between. Confirmed by restoring the bug: the new at-rest case fails and nothing else does.
- MEDIUM, the script's collection names were an unchecked hand-copy of store.ts's constants. Renaming WHEEL_SECRETS would have left ttl:check reporting ACTIVE for a collection group nobody writes while the real secrets never expired — the silent miss the script exists to prevent, reintroduced one layer up. The script cannot import store.ts (TypeScript, and it imports server-only, which throws), so instead TTL_FIELD, COLLECTION_GROUPS, fieldResource and classify are now exports, the executable body runs only when the file is the entry point, and scripts/configure-ttl.test.ts holds the list against the store's constants. Confirmed by renaming WHEEL_SECRETS: two cases fail.
- LOW, --check treated CREATING as a failure. The CHECK_ONLY branch was evaluated before the CREATING branch, so the documented happy path — ttl:configure then ttl:check — reported 'At least one collection group is not covered ... Fix it' for a policy whose only remedy is waiting. States are now classified as covered, pending or broken, and the exit codes are 0, 2 and 1, so a provisioning script can retry on 2 and stop on 1.
- LOW, pairSplit's alarm becomes routine once the policies are applied. SECRET_EXPIRY_MARGIN_DAYS deliberately reaps the wheel about two days before its secret, so for that whole window assertEditor succeeds and the write finds no wheel — logging 'one was deleted without the other' at error severity on the ordinary end of a wheel's life, which teaches whoever reads production logs to skip the line. Split into reapedWheel (wheel gone, secret present: warn, and the message names the reaping window as the expected cause) and pairSplit (which half went is unknowable, so still error). The doc comment claiming the two are 'reaped together' was also simply false, since the margin exists to make sure they are not. No control flow or status code changed.
- LOW, the in-code IOUs this task settles were left standing. createWheel and submitSuggestion still said 'TASK-14 has to finish' and 'TASK-14 owns the policy itself'; in a codebase where comments are the spec, a reader would land on an unmade decision that was in fact made here. They now name decision 20, the script and the test file.
- LOW, the script's header runbook said ttl:configure means 'apply, then verify' when it only applies. Corrected, with the exit codes stated.

Unit 283 (up from 270), emulator 229 (up from 228); typecheck, lint, format:check clean, production build succeeds. All three script guards re-verified to fire.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 22:59
---
From TASK-7: the TTL policy needs to cover TWO collections, not one.

createWheel writes expiresAt on both wheels/{shareId} and wheelSecrets/{shareId}, and the sliding logic has to push both forward together. If the policy is only configured on wheels, the secret outlives the wheel forever: assertEditor authorizes purely on the existence of wheelSecrets/{shareId}, so it would keep succeeding for a wheel that has already been reaped, and a set(..., {merge: true}) from any write route would then resurrect the wheel with no expiresAt at all — permanently un-reapable. wheelSecrets would also grow without bound.

Note the two TTL deletions are not atomic with each other, so there is a window where one document is gone and the other is not. Both orderings are safe as things stand — a wheel with no secret is uneditable, a secret with no wheel authorizes nothing that can be read — but any route that writes with merge semantics turns the second case into the resurrection bug above. Worth checking that whatever TASK-10 through TASK-12 end up doing, none of them can create a wheel document as a side effect of updating one.

Suggestion, not a requirement: gating assertEditor on the wheel document's existence would close this structurally, at the cost of a second read on every authenticated write. I did not do it in TASK-7 because mirroring the field is cheaper and keeps the guard at one read, but if TASK-14 finds the two-collection TTL awkward to keep in sync, that is the alternative.
---

author: @claude
created: 2026-08-08 09:07
---
AC 2 is deliberately left unchecked. The configuration and its verification command exist and are documented, but nothing has been applied to a real database: .firebaserc is demo-spinnerly and TASK-27 has not run, so there is no project to apply a policy to and no way to observe one working. Checking it would claim a policy is live somewhere when none is.

What remains is one command per environment, and it is recorded on TASK-27 as a step. Everything else in this task is complete and verified.
---
<!-- COMMENTS:END -->
