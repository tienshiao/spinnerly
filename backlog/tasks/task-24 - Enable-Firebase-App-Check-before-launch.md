---
id: TASK-24
title: Enable Firebase App Check before launch
status: To Do
assignee: []
created_date: '2026-08-07 08:40'
labels: []
dependencies:
  - TASK-5
  - TASK-9
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The highest-leverage item in design doc section 7 and the primary abuse defense, not a secondary one.

Public write is a billing surface as much as a correctness one: a scraped share URL lets someone loop writes against the Firestore quota. Rate limiting was considered as a second layer and deferred out of v1 because it needs an external state store (Redis) the project is not standing up. That deferral makes App Check load-bearing.

Enable it before launch. It is trivial configuration on day one and a migration later, because every existing client has to be updated in lockstep.

Cover both halves of the split: attest the browser reads that go direct to Firestore, and verify App Check tokens on the write route handlers before touching Firestore.

The residual exposure after this is someone who defeats App Check and spreads writes across many wheels. The per-wheel caps bound the single-wheel case; nothing bounds the spread case in v1, which is why TASK-25 sets a budget alert.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App Check is enabled on the Firebase project with a documented attestation provider
- [ ] #2 Client Firestore reads carry an App Check token
- [ ] #3 Write route handlers verify the App Check token and reject requests without one
- [ ] #4 A debug token path exists for local development and is documented
- [ ] #5 Rejection behaviour is verified by calling a write endpoint without a valid App Check token
<!-- AC:END -->
