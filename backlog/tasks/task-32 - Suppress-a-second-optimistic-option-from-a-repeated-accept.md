---
id: TASK-32
title: Suppress a second optimistic option from a repeated accept
status: To Do
assignee: []
created_date: '2026-08-09 20:17'
labels: []
dependencies: []
priority: low
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In `project`, two outstanding `accept-suggestion` entries for the same suggestion each push their own optimistic option. The filter that follows only asks whether a live option already carries that `fromSuggestion`; it never asks whether another outstanding entry has already emitted one. A double-click landing in two render passes therefore draws two identical rows until the first lands.

Not reachable until TASK-19 ships the Suggestions panel, and a disabled button there would hide it. File it anyway: the invariant belongs in the pure function that owns the projection rather than in the disabled state of a future caller.

Found in the TASK-18 review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two outstanding accepts of the same suggestion project one optimistic option, not two
- [ ] #2 Covered by a unit test in optimistic.test.ts that does not depend on any component disabling a control
<!-- AC:END -->
