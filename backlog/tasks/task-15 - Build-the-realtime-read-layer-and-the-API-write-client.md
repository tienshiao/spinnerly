---
id: TASK-15
title: Build the realtime read layer and the API write client
status: To Do
assignee: []
created_date: '2026-08-07 08:38'
labels: []
dependencies:
  - TASK-5
  - TASK-6
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The two halves of the client data path from design doc section 3.

Reads: onSnapshot listeners straight from the browser to Firestore, one on wheels/{shareId} and one on the suggestions subcollection. This is the entire reason the project is on Firestore — live updates with no websocket layer to build. Routing reads through the API too would mean polling or hand-rolled websockets, at which point Firestore buys nothing over Postgres.

Writes: a thin typed client that calls the route handlers and attaches Authorization: Bearer {editToken} when the caller has one.

The expensive part is the optimistic layer. Because writes are routed through an API, the client loses Firestore latency compensation — normally Firestore echoes a write into the local cache before the round trip, so edits feel instant. Here the path is client to API to Firestore to snapshot back. The design doc calls this out as the single most likely why does this feel bad regression. The editor UI must hold optimistic local state, and that state must reconcile cleanly when the real snapshot arrives without flickering or duplicating rows.

Cold starts compound it: the first request after a quiet period stalls a second or two on Vercel, with no always-warm option. Annoying on the first edit specifically. Design the pending state for that, do not assume writes are fast.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A hook exposes the live wheel document and a hook exposes the live suggestions list, both via onSnapshot
- [ ] #2 Listeners are torn down on unmount and do not leak across navigations
- [ ] #3 A typed write client covers every endpoint and attaches the bearer token when present
- [ ] #4 Optimistic entries are keyed so the arriving snapshot replaces the local entry rather than rendering both
- [ ] #5 A failed write rolls the optimistic entry back and surfaces the error
- [ ] #6 A write that is slow past a threshold shows a pending affordance rather than appearing frozen
- [ ] #7 A missing or deleted wheel renders a not-found state rather than hanging
<!-- AC:END -->
