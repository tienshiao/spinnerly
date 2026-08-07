---
id: TASK-14
title: Implement sliding expiry and the Firestore TTL policy
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
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
