---
id: TASK-29
title: Fix the clock-skew stall in optimistic entry retirement
status: To Do
assignee: []
created_date: '2026-08-09 03:55'
labels: []
dependencies:
  - TASK-15
documentation:
  - docs/spin-the-wheel-design.md
priority: medium
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An optimistic entry can stall forever, not merely be delayed, when two editors write the same field and the wall clocks behind them disagree.

versionCaughtUp in lib/wheels/optimistic.ts compares the updatedAt a route reported against the one a snapshot carries:

    live.wheel.updatedAt.getTime() >= settled.wheelUpdatedAt.getTime()

That value is the ROUTE's wall clock, not Firestore's — writeVersion in store.ts computes a Date rather than using FieldValue.serverTimestamp(), because a sentinel resolves during the commit and leaves the route nothing to report (TASK-15, decision 22). So two writes from two serverless instances are ordered by two clocks.

The stall, concretely. Editor A patches the title on an instance whose clock reads T and is handed T in the x-wheel-updated-at header. Editor B patches THE SAME field a moment later, commits after A, but sits on an instance whose clock is a few hundred milliseconds behind and therefore stores T-300. The document now holds B's title at version T-300.

A's entry has neither kind of evidence. Identity is false, because B's value won and A's is not what is stored. Version is false, because the stored updatedAt is behind the value A was handed and no snapshot will ever carry T. Nothing else retires an entry — the slow flag only sets a UI hint — so A's row stays pending, project() keeps folding the stale optimistic value over the live one, and the editor watches their own overwritten title sit in a saving state. It clears the instant anyone writes to the wheel again, which means an idle wheel never clears at all.

Why it matters more than the frequency suggests: CLAUDE.md names 'rows that never clear' as the specific failure this mechanism exists to prevent, and design doc section 2 makes concurrent editors a supported case rather than an edge one, since the edit URL is transferable. The same effect follows from a single instance whose clock steps backwards under an NTP correction, with no second instance involved.

The trigger is narrow and worth stating precisely so nobody over-fixes it: it needs two writes to the same field with conflicting values, the later one carrying the earlier timestamp, and then silence. Different fields are fine — A's identity evidence still holds, because B did not touch A's field. Non-conflicting values are fine for the same reason.

The module docstring (lines 121-126) currently says the comparison is 'exact to within that skew, on writes that would have to land within it of each other'. That is the claim to correct whatever else changes: skew in the forgiving direction is a delay, skew in the other direction is a stall, and the docstring reads as though both were the former.

Options, none of them mandated:

1. A monotonic version on the wheel document — FieldValue.increment() on a counter — which removes wall clocks from the comparison entirely. Exact, and the biggest change: a schema field, all six mutating routes, and the header contract in model.ts.
2. A skew tolerance on the comparison. Cheapest, and it cuts the wrong way: loosening the >= is what lets an entry retire before its write has arrived, concluding 'removed again' about something still in flight, which is the flicker decision 22 exists to prevent.
3. Bound the stall rather than remove it — retire after a deadline and tell the user the write could not be confirmed. Does not fix the ordering, but converts an indefinite stall into a bounded one with an honest message.
4. Accept it and write it down, as decisions 20 and 21 did for the TTL residuals.

Whoever picks this up should decide between them and record the reasoning; the acceptance criteria below are about the outcome, not the route taken.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A test reproduces the stall: two patch-wheel mutations on the same field where the write that commits second reports an earlier updatedAt, and the first entry is shown never to retire under the current comparison
- [ ] #2 An optimistic entry cannot stay pending indefinitely because two writes were ordered by disagreeing wall clocks — either the comparison no longer depends on them, or the stall is bounded and ends in a defined state
- [ ] #3 The behaviour when an editor's write is overwritten by a concurrent editor is defined and tested: the entry retires and the live value is what renders, rather than the stale optimistic value persisting
- [ ] #4 The claim in optimistic.ts that the comparison is 'exact to within that skew' is corrected or removed, so the docstring no longer describes a stall as a delay
- [ ] #5 A clock stepping backwards on a single instance is covered by the same reasoning, or excluded with a written argument
- [ ] #6 If the residual is accepted rather than fixed, it is recorded in the design doc decisions table with its rationale and its user-visible symptom, in the style of decisions 20 and 21
<!-- AC:END -->
