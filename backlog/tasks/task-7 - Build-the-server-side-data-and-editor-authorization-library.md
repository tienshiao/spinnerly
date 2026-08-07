---
id: TASK-7
title: Build the server-side data and editor-authorization library
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
labels: []
dependencies:
  - TASK-5
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The shared server module every write route handler sits on. This is the single most security-sensitive piece of the codebase, per design doc section 6.

Responsibilities:
- A Firestore handle from the Admin SDK.
- Minting a share ID (Firestore auto-ID, roughly 120 bits) and an edit token as an independent CSPRNG value. The token must not be derived from the shareId. A derived token means one leaked pepper mints edit rights for every wheel that exists, and rotating the pepper locks out every live wheel at once.
- SHA-256 hashing of the edit token. Only the hash is ever stored, in wheelSecrets/{shareId}.
- An assertEditor(shareId, request) guard that reads the bearer token from the Authorization header, looks up wheelSecrets keyed by the shareId taken from the request path, and compares hashes in constant time.

The guard answers is this THIS wheel token, never is this A valid token. The anti-pattern in design doc section 6 is a query across the wheelSecrets collection filtering on editTokenHash; that validates the token globally and hands an editor of wheel A write access to wheel B. It is a confused-deputy bug and it is easy to reintroduce when refactoring auth into shared middleware.

The shareId must come from the request path only. Never from the body, and a caller must never be able to name which secret document is checked.

The edit token must never appear in a path, a query string, or a log line. Scrub it from logging config regardless.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Share IDs and edit tokens are generated independently, with the token from a CSPRNG and not derived from the shareId
- [ ] #2 Only the SHA-256 hash of the edit token is persisted; the raw token is returned exactly once, at creation
- [ ] #3 assertEditor looks up wheelSecrets by the shareId from the request path and compares hashes with a timing-safe comparison
- [ ] #4 Test: a request with the correct token for wheel A succeeds on wheel A
- [ ] #5 Test: an editor of wheel A receives 403 on wheel B
- [ ] #6 Test: a missing or malformed Authorization header receives 401, and an unknown shareId receives 404
- [ ] #7 No code path queries wheelSecrets by editTokenHash
<!-- AC:END -->
