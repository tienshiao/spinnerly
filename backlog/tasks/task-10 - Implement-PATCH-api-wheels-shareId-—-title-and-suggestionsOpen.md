---
id: TASK-10
title: 'Implement PATCH /api/wheels/[shareId] — title and suggestionsOpen'
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
updated_date: '2026-08-07 08:52'
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
- [ ] #1 PATCH with a valid editor token updates title and suggestionsOpen
- [ ] #2 An options key in the request body is rejected, not silently ignored
- [ ] #3 A request without a valid token for this specific wheel returns 401 or 403
- [ ] #4 updatedAt and expiresAt are refreshed on a successful patch
- [ ] #5 A patch containing only one of title or suggestionsOpen leaves the other field untouched
<!-- AC:END -->

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
