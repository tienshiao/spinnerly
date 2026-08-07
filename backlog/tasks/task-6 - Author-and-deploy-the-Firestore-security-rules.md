---
id: TASK-6
title: Author and deploy the Firestore security rules
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
updated_date: '2026-08-07 19:03'
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

author: @claude
created: 2026-08-07 19:03
---
Heads-up from TASK-5, worth knowing before you write the first assertion.

TASK-5 added spinnerly/no-client-firestore-writes, enabled globally with no file exceptions. Your rules tests will trip it: proving 'allow write: if false' means importing setDoc/addDoc/deleteDoc from firebase/firestore and calling them inside assertFails(...). That is the rule working as designed — the test suite is the one legitimate place in this repo where a client write is the point.

I did not pre-add an override, because a config block matching a path that does not exist yet is dead config that rots. Add one when you create the test directory. An override block scoped to the rules-test files is better than eslint-disable on every assertion, since there will be one per rule per role and the disables will outnumber the assertions.

Also: the emulator currently starts with no rules file. firebase.json has no firestore.rules key, so it runs open and warns on startup — wiring that up is yours.

And on CI: firebase-tools is pinned to 14.18.0 because 14.19.0 raised the emulator's Java floor from 11 to 21. Whatever setup-java version your CI job installs needs to match that pin, or the pin needs lifting as part of your work. See the comment on TASK-5.
---
<!-- COMMENTS:END -->
