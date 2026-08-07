---
id: TASK-6
title: Author and deploy the Firestore security rules
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
labels: []
dependencies:
  - TASK-5
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship the read-policy rules from design doc section 5. The rules deny every client write, permit get on wheels and get plus list on the suggestions and spins subcollections, and deny all access to wheelSecrets.

The load-bearing line is allow list: if false on /wheels/{shareId}. Rules are not filters. With list permitted, anyone can call getDocs(collection(db, "wheels")) and enumerate every share ID in existence, which makes the unguessable ID worthless. This deserves a test, not just a review.

Collection group queries need the same scrutiny: verify collectionGroup("suggestions") and collectionGroup("spins") cannot reach subcollection data from outside a known parent path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 firestore.rules matches the policy in design doc section 5 and is deployed via a documented command
- [ ] #2 A rules unit test suite runs against the Firestore emulator in CI
- [ ] #3 Test: a client get on wheels/{knownId} succeeds
- [ ] #4 Test: a client list on the wheels collection is denied
- [ ] #5 Test: every client write to wheels, suggestions, spins and wheelSecrets is denied
- [ ] #6 Test: a client read of wheelSecrets/{anyId} is denied
- [ ] #7 Test: collectionGroup("suggestions") from outside a known parent path returns no data
<!-- AC:END -->
