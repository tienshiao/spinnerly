---
id: TASK-12
title: 'Implement the suggestion submit, accept and reject endpoints'
status: To Do
assignee: []
created_date: '2026-08-07 08:37'
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
- [ ] #1 POST suggestions succeeds unauthenticated and returns 403 when suggestionsOpen is false
- [ ] #2 Accept runs as a single transaction over the wheel document and the suggestion document
- [ ] #3 Test: accepting the same suggestion twice concurrently adds the option exactly once
- [ ] #4 Reject hard-deletes the suggestion document
- [ ] #5 No code path ever writes status: "rejected"
- [ ] #6 Accept and reject return 403 for a token belonging to a different wheel
- [ ] #7 The pending suggestion cap is enforced on submit
<!-- AC:END -->
