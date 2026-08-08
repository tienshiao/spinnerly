---
id: TASK-10
title: 'Implement PATCH /api/wheels/[shareId] — title and suggestionsOpen'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-07 08:37'
updated_date: '2026-08-08 02:52'
labels: []
dependencies:
  - TASK-7
  - TASK-8
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Editor-authenticated. Updates the wheel title and the suggestionsOpen flag.

suggestionsOpen is the owner kill switch for a brigaded wheel (design doc section 7). When it is false, POST /api/wheels/{shareId}/suggestions must reject.

This endpoint must never accept the options array. Options are only mutated through the granular add and remove endpoints; a whole-array write is the lost-update bug that the granular endpoints exist to avoid, and the edit URL being transferable makes concurrent editors a supported case rather than an edge case (design doc section 6).

Touching this endpoint slides expiresAt forward.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 PATCH with a valid editor token updates title and suggestionsOpen
- [x] #2 An options key in the request body is rejected, not silently ignored
- [x] #3 A request without a valid token for this specific wheel returns 401 or 403
- [x] #4 updatedAt and expiresAt are refreshed on a successful patch
- [x] #5 A patch containing only one of title or suggestionsOpen leaves the other field untouched
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/store.ts — add updateWheel(shareId, patch, db). Batches the wheel update with updatedAt + a slid expiresAt, AND slides wheelSecrets/{shareId}.expiresAt in the same batch. Sliding only the wheel would let the secret be reaped at day 30 while the wheel lives on, leaving an active wheel permanently uneditable — store.ts's own createWheel comment already flags that the two must move together. Maps Firestore NOT_FOUND to the existing 404 no_such_wheel.
2. app/api/wheels/[shareId]/route.ts — PATCH. assertEditor FIRST, before the body is read: a caller without this wheel's token learns nothing about whether their body was well formed, and no work is done for them.
3. Schema uses .transform().optional() rather than .optional().transform(). Verified in Zod 4.4.3: that ordering skips the transform for an absent key and leaves the key off the output, so 'title' in body is what distinguishes leave-unchanged from set. The other ordering runs the transform on undefined and would make every title-less patch a 400.
4. options is declared in the shape with a transform that always rejects, so it gets a specific message pointing at the add/remove endpoints rather than the generic unknown-key error. The object is .strict() so anything else unexpected is refused too.
5. An empty patch is refused rather than silently sliding expiry for no change.
6. Tests live in the emulator project. Auth precedes validation, so there is no rejection path this route can reach without Firestore — unlike POST /api/wheels, where that split was worth having.
7. npm test, npm run test:emulator, typecheck, lint, format, build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added app/api/wheels/[shareId]/route.ts (PATCH) and its emulator tests, plus updateWheel/WheelPatch in lib/wheels/store.ts. Unit 249 green, emulator 70 (up from 42), typecheck/lint/format clean, build succeeds.

Decisions:

- assertEditor runs BEFORE the body is read. A caller without this wheel's token learns nothing about whether their body was well formed, and no parsing is done on their behalf. Consequence: every test for this route lives in the emulator project, because there is no rejection path that does not first read a secret document. That is the opposite of POST /api/wheels, where the unit-project rejection tests exist precisely to prove the database is not touched.
- Schema uses .transform(...).optional(), NOT .optional().transform(...). Verified against Zod 4.4.3: that ordering skips the transform for an absent key and omits the key from the output, which is what makes 'title' in body mean 'the caller sent one'. The other ordering runs the transform on undefined, so validateTitle throws and every suggestionsOpen-only patch would 400. The two routes use opposite orderings and are each correct for opposite reasons — POST wants the transform to run on undefined so DEFAULT_TITLE applies.
- validateTitle, not validateNewWheelTitle: absent means leave alone, present must be real, and DEFAULT_TITLE is neither.
- options is declared in the shape with a transform that always rejects, so it gets a message pointing at the granular endpoints rather than the generic unrecognised-key error. The object is .strict() so a misspelled suggestionsOpen is refused rather than silently ignored.
- An empty patch is refused rather than treated as a no-op that still slides expiry.

Post-review (/code-review found no correctness defects, three low-severity notes, all three acted on):

1. The secret now expires LATER than its wheel rather than at the same instant, via SECRET_EXPIRY_MARGIN_DAYS. The pair is reaped by two independent per-collection TTL jobs; Firestore promises only 'typically within 24 hours' and gives no cross-collection ordering. With identical timestamps either can go first, and the two orders are not equally harmless: wheel-first is inert, but secret-first leaves a live, publicly readable wheel still accepting unauthenticated suggestions whose owner has permanently and silently lost the kill switch, with no way to reissue the token. The margin makes that order impossible rather than unlikely. Three tests now assert it and all three fail when the margin is set to 0.
2. createWheel's comments still claimed sliding was unimplemented and TASK-14's job, forty lines above the function that now does it — a TASK-14 implementer would have added a second mechanism. Updated to point at updateWheel.
3. The commit-time NOT_FOUND now logs. Reaching it means the wheel is gone while its secret is not (assertEditor just succeeded), which is our data being inconsistent rather than a client mistake; without the log it reached the client as a routine 404 and the logs not at all. The other two 404s, from isShareId and assertEditor, stay unlogged as ordinary client errors.

Also fixed a vacuous test of my own before review: 'checks authorization before it reads the body' used an absent body, which parses cleanly, so both orderings returned 401 and it proved nothing. It now uses three bodies that are each independently a 400, and all three fail when parseBody is moved ahead of assertEditor.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:52
---
Decision 16: this endpoint now backs two distinct UI controls in two different places.

- title: the inline click-to-edit control in the page header (TASK-17).
- suggestionsOpen: the toggle in the Suggestions panel header (TASK-19).

Both are partial updates through the same route, so the handler must treat an absent key as leave unchanged rather than clear. A title-only patch must not reset suggestionsOpen and vice versa.
---
<!-- COMMENTS:END -->
