---
id: TASK-9
title: Implement POST /api/wheels — create a wheel
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
labels: []
dependencies:
  - TASK-7
  - TASK-8
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Unauthenticated. Creates a wheel document, mints the share ID and edit token, and writes the token hash to wheelSecrets/{shareId}. This is the only time the raw edit token is ever emitted.

Writes wheels/{shareId} with title, empty options array, suggestionsOpen true, createdAt, updatedAt and expiresAt set 30 days out (design doc section 8).

The wheel document and its secret document must be created atomically. A wheel with no secret is an unowned, uneditable, publicly writable suggestion endpoint that nobody can shut off.

Runtime must be nodejs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/wheels returns 201 with shareId and the raw editToken
- [ ] #2 wheels/{shareId} and wheelSecrets/{shareId} are created atomically in a batch or transaction
- [ ] #3 The stored secret contains only the SHA-256 hash, never the raw token
- [ ] #4 expiresAt is set 30 days from creation
- [ ] #5 The raw editToken appears in the response body only, and in no log line
- [ ] #6 An optional title in the request body is validated against the shared caps and defaults sensibly when absent
<!-- AC:END -->
