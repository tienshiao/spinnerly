---
id: TASK-11
title: Implement the option add and remove endpoints
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:37'
updated_date: '2026-08-08 03:55'
labels: []
dependencies:
  - TASK-7
  - TASK-8
priority: high
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Editor-authenticated. POST /api/wheels/[shareId]/options adds one option; DELETE /api/wheels/[shareId]/options/[optionId] removes one.

Granular by design. Two editors on two devices is a normal case because the edit URL is transferable (design doc section 2), so options must never be written as a whole array — the second write would erase the first.

Every mutation here commutes: simultaneous adds both land, and an add and a remove on different options do not interact. Option order is not meaningful (decision 6) so there is no reorder operation, no rev counter, no 409 conflict path and no conflict UI. arrayUnion appends and Firestore preserves array order, so insertion order is the display order for free.

Each option carries a client-stable id used for animation keying, a label, addedAt, and fromSuggestion (null unless it came from an accepted suggestion).

If TASK-1 resolves in favour of in-place label editing, the PATCH endpoint it decides on belongs in this task.

Both routes slide expiresAt forward.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST adds one option with a generated stable id and returns it
- [x] #2 DELETE removes exactly the named option and is idempotent when the option is already gone
- [x] #3 Neither route ever writes the options array wholesale
- [x] #4 Test: two concurrent adds both land and neither is lost
- [x] #5 The option cap from the shared limits module is enforced on add
- [x] #6 expiresAt slides forward on both routes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/store.ts — extract two helpers the option writes share with the existing ones: `optionElement()` (the stored element shape, incl. the real-Date addedAt note) and `slidingExpiry()` (the updatedAt/expiresAt pair for wheel + secret, reused by updateWheel).
2. lib/wheels/store.ts — `addOption(shareId, {label}, db)`: runTransaction, read the wheel, assertOptionCapacity(options.length) on the in-transaction count, write with arrayUnion (never the whole array), slide both docs, return the created option.
3. lib/wheels/store.ts — `removeOption(shareId, optionId, db)`: read the wheel, find the element with that id, arrayRemove that exact element in a batch alongside the secret slide. No transaction needed — option elements are immutable (decision 10), so arrayRemove commutes with concurrent adds and removes. Idempotent when the option is already gone.
4. app/api/wheels/[shareId]/options/route.ts — POST. runtime='nodejs', assertEditor before the body, Zod `.strict()` body of { label } through domainCheck(validateOptionLabel), an explicit refusal for a client-supplied `id`, 201 with the created option.
5. app/api/wheels/[shareId]/options/[optionId]/route.ts — DELETE. runtime='nodejs', assertEditor, removeOption, 204.
6. Emulator tests for both routes: auth matrix incl. the confused-deputy case, cap enforcement at OPTIONS_MAX, two concurrent adds both landing, remove-exactly-one, idempotent re-delete, expiry sliding on both routes.
7. npm run lint, typecheck, build, test, test:emulator.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Store layer (lib/wheels/store.ts):
- `optionElement()` is now the single place an option element is built, used by createWheel and addOption. That matters beyond tidiness: `arrayRemove` matches elements by deep equality, so an element written with a different field set would be one the delete endpoint could not address — a silent no-op rather than an error.
- `slidingExpiry()` computes the wheel/secret expiry pair once; updateWheel, addOption and removeOption all use it, so no caller can decide the secret's margin independently.
- `commit()` wraps the NOT_FOUND translation that updateWheel had inline, since three writers now need it.
- `addOption` runs a transaction: read, `assertOptionCapacity` on the in-transaction count, then `arrayUnion` of the one new element. The transaction exists for the cap, not for the append — `arrayUnion` would have been safe on its own — and it is what makes 'two editors both see 49' impossible.
- `removeOption` reads OUTSIDE a transaction on purpose. `arrayRemove` needs the exact stored element, and decision 10 makes option labels immutable, so a stored element never changes after it is written: the value read is still the value stored at commit time or it is not there at all, and in the second case arrayRemove removes nothing. Same answer a transaction would give, without a lock for concurrent adds to contend on.

Decisions worth recording:
- Option IDs are server-generated (randomUUID) and a client-supplied `id` is refused with 400 `id_not_settable`. Design doc section 4's 'client-stable' describes the value, not who mints it; accepting one would let a client write two options with the same id and have one DELETE remove both.
- DELETE slides expiry even when nothing matched. A retried delete is ordinary editor activity, and a wheel's lifetime should not depend on whether the client's first attempt got its response back.
- Transaction retries are left at the SDK default of 5 attempts. Raising them trades a 500 under extreme contention for a request that retries past the platform's function timeout, which is worse. The concurrency this has to survive is a few humans clicking at once.

Validation: npm run lint, typecheck, build, format:check all clean. npm test 249 passed. npm run test:emulator 121 passed, run three times to confirm the concurrency cases are not flaky.

One thing found by testing: with the cap read inside the transaction, N simultaneous adds to one wheel serialise with ~1s backoff each, so a 10-way stress test exceeded Vitest's 5s default timeout. The concurrency test is sized at five with an explicit timeout and a comment, so a future failure there reads as what it is rather than as a lost write.

Code review pass — seven findings, all addressed:

1. `commit()` blamed the wheel by name in its log line, but addOption and removeOption both verify the wheel exists before writing, so for those the only document that can raise gRPC 5 at commit is the secret. An operator would have been sent hunting for a healthy document. The message now names neither half, and says why it cannot.
2. The wheel-gone-secret-alive inconsistency that `commit()` exists to log was being returned unlogged by both new functions, since their own `!snapshot.exists` checks caught it first — the exact regression updateWheel's inline handler was written to prevent. Both now go through `pairSplit()`, which logs and returns the 404.
3. A transaction is retried on UNAVAILABLE/UNKNOWN/DEADLINE_EXCEEDED, every one of which can arrive after the backend committed. The append was already idempotent (the element is built once outside the transaction, so arrayUnion re-adds a value the array holds) but the capacity check was not: at the cap boundary the retry counted our own option and answered 409 for an add that landed. The check is now skipped when the element is already present.
4. `createWheel` required a caller-supplied option id, contradicting `optionElement`'s documented invariant and shaping the signature that TASK-13's unauthenticated duplicate endpoint will use. `id` is now optional, so a caller with no meaningful id gets a minted one.
5. The `id` field's `.transform().optional()` ordering is the reverse of the create route's and of CLAUDE.md's, and is load-bearing — written the conventional way round, every well-formed add is refused with id_not_settable. Now commented as deliberate.
6. OPTION_ID_MAX claimed to refuse a bad id 'before a read rather than after one', which is false: assertEditor has already read the secret. Reworded to what the bound actually does.
7. Two test labels held raw invisible characters — U+200B and U+0007 — which is the practice lib/wheels/validation.ts argues against at ZERO_WIDTH_SPACE. The zero-width case failed open: strip the characters and the label is '', still empty_label, so the test would keep passing while testing nothing. Both are now \u escapes.

Re-verified after the fixes: lint, typecheck, build, format:check clean; npm test 249 passed; npm run test:emulator 121 passed.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:48
---
Decision 10 (design doc section 10): option labels are immutable. There is NO PATCH /wheels/{shareId}/options/{optionId} endpoint. Fixing a typo is remove-then-add.

Rationale worth keeping in mind while implementing: an in-place label edit is the one mutation in this design that would not commute. Two editors relabelling the same option concurrently is a real last-write-wins conflict, and it is the only case in the whole system that would need a rev counter, a 409 and a conflict UI. Dropping it is what keeps this task free of all of that.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the granular option endpoints: POST /api/wheels/[shareId]/options and DELETE /api/wheels/[shareId]/options/[optionId], both editor-authenticated and both sliding the wheel's and the secret's expiry forward.

Neither writes the options array as a whole — adds use arrayUnion and removes use arrayRemove on the exact stored element — so two editors working at once cannot erase each other, which is the property the granularity exists for (design doc section 6). The option cap is checked against the count read inside the same transaction as the write, so it cannot be walked past under concurrency. DELETE is idempotent: an option already gone is a 204, so a client can retry a request whose response it never saw. No PATCH counterpart, per decision 10.

Supporting work in lib/wheels/store.ts: a single optionElement() factory (arrayRemove matches by deep equality, so element shape has to be decided in one place), a shared slidingExpiry() so the wheel and secret expiries cannot drift, and addOption/removeOption alongside the existing updateWheel.

Verified with npm run lint, typecheck, build and format:check (clean), npm test (249 passed) and npm run test:emulator (121 passed, three consecutive runs). The new emulator suites cover the auth matrix including the confused-deputy case, cap enforcement at OPTIONS_MAX including a race for the last slot, concurrent adds all landing, removing exactly one of two options sharing a label, idempotent re-deletes, and expiry sliding on both routes.
<!-- SECTION:FINAL_SUMMARY:END -->
