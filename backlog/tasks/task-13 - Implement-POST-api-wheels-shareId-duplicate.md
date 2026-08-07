---
id: TASK-13
title: 'Implement POST /api/wheels/[shareId]/duplicate'
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
updated_date: '2026-08-07 08:54'
labels: []
dependencies:
  - TASK-9
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Unauthenticated, and deliberately so. Available to anyone holding the share URL, not just editors (design doc section 8). It is the escape hatch when a wheel expires, when the edit token is lost, or when someone wants to fork the list for their own group. Nothing is disclosed that the share URL did not already expose.

Mints a fresh shareId and editToken, copies title and options, and drops suggestions and spins. Fresh createdAt, updatedAt and expiresAt.

Design doc section 11 question 2 asks whether the title is copied verbatim or marked to distinguish the fork; two identically titled wheels in one group chat is a confusing failure mode. TASK-1 should have settled this — follow whatever it decided.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST duplicate succeeds with no Authorization header and returns a new shareId and editToken
- [ ] #2 The new wheel copies title and options and has no suggestions and no spins
- [ ] #3 The new wheel gets its own independently generated edit token, unrelated to the source wheel token
- [ ] #4 The source wheel is left unmodified
- [ ] #5 Title handling matches the decision from TASK-1
- [ ] #6 The duplicated wheel title is byte-identical to the source title with no suffix or marker
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:52
---
Decision 16: the duplicate action surfaces in the header overflow menu on the wheel page (TASK-17), available to both roles. The endpoint itself stays unauthenticated per design doc section 8 — a participant who has lost track of the editor, or who wants to fork the list for their own group, is exactly who this is for.
---

created: 2026-08-07 08:54
---
Decision 17 (design doc section 10): duplicate copies the title VERBATIM. No "(copy)" suffix, no rename prompt, no disambiguation of any kind. The fork is indistinguishable from the original by title alone; the URL is the identifier.

Renaming is a one-field edit away via PATCH (TASK-10) if the forker wants it, and guessing on their behalf gets it wrong for the most common case: a wheel that expired and is simply being resurrected under the same name.
---
<!-- COMMENTS:END -->
