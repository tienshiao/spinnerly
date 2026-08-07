---
id: TASK-11
title: Implement the option add and remove endpoints
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
updated_date: '2026-08-07 08:48'
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
- [ ] #1 POST adds one option with a generated stable id and returns it
- [ ] #2 DELETE removes exactly the named option and is idempotent when the option is already gone
- [ ] #3 Neither route ever writes the options array wholesale
- [ ] #4 Test: two concurrent adds both land and neither is lost
- [ ] #5 The option cap from the shared limits module is enforced on add
- [ ] #6 expiresAt slides forward on both routes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:48
---
Decision 10 (design doc section 10): option labels are immutable. There is NO PATCH /wheels/{shareId}/options/{optionId} endpoint. Fixing a typo is remove-then-add.

Rationale worth keeping in mind while implementing: an in-place label edit is the one mutation in this design that would not commute. Two editors relabelling the same option concurrently is a real last-write-wins conflict, and it is the only case in the whole system that would need a rev counter, a 409 and a conflict UI. Dropping it is what keeps this task free of all of that.
---
<!-- COMMENTS:END -->
