---
id: TASK-14
title: Implement sliding expiry and the Firestore TTL policy
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
updated_date: '2026-08-07 22:59'
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
- [ ] #1 Every mutating route slides expiresAt forward by 30 days
- [ ] #2 A Firestore TTL policy on the expiresAt field of the wheels collection is configured and documented
- [ ] #3 Orphaned suggestion and spin subcollection documents after a parent TTL delete are either cleaned up or explicitly accepted with a written rationale
- [ ] #4 A request against an expired-but-not-yet-reaped wheel behaves predictably and is documented
- [ ] #5 Tests confirm expiresAt moves forward on option add, option remove, suggestion submit and suggestion accept
<!-- AC:END -->

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
<!-- COMMENTS:END -->
