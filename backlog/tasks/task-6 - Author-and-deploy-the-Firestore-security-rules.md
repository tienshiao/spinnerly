---
id: TASK-6
title: Author and deploy the Firestore security rules
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
updated_date: '2026-08-07 17:54'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 17:54
---
From TASK-5: local dev will run on the Firebase Emulator Suite, which changes what this task can commit to.

Rules become unit-testable. @firebase/rules-unit-testing runs against the emulator, so every clause in design doc section 5 can have a test that asserts both the allow and the deny — including the one the doc calls the whole security model, "allow list: if false". Against a live project these could only be checked by hand, once, and would silently rot.

Worth writing the tests as the deny-first kind: assert that a client write is refused, that a list query is refused, and that a get on a known shareId succeeds. The failure mode this guards against is a rules edit that accidentally opens writes, which is invisible in review and catastrophic in production.

This needs Java in CI, same as the emulator locally. Java 17 is present on the dev machine already.
---
<!-- COMMENTS:END -->
