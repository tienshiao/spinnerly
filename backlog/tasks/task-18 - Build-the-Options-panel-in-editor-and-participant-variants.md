---
id: TASK-18
title: Build the Options panel in editor and participant variants
status: To Do
assignee: []
created_date: '2026-08-07 08:38'
updated_date: '2026-08-07 08:52'
labels: []
dependencies:
  - TASK-16
  - TASK-11
documentation:
  - docs/spin-the-wheel-editor/project/Wheel.dc.html
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The upper right panel. Two visually distinct variants driven by role.

Editor variant: a vertical stack of pill rows, each with a 16px color dot matching its wheel slice, the label, and a circular remove button. Row background is neutral-200, or accent-2-100 when the option has been picked. Below the stack, a pill input placeholder Add a spot with an adjacent Add button; Enter submits.

Participant variant: the same options as a read-only wrapped row of pills, dot plus label, no inputs and no remove buttons.

Panel chrome: 24px padding, radius-lg, white surface, divider border, shadow-sm. Header row is Options at 26px baseline-aligned against a count label reading N on the wheel in 13px neutral-600.

Two behaviours depend on TASK-1 and must not be guessed at: whether option labels are editable in place (the prototype has an input per row, the API as specified has only add and remove), and whether the Picked chip is local-only or persisted. Do not build either until TASK-1 lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The editor variant matches the prototype row layout, colors, spacing and controls
- [ ] #2 The participant variant renders read-only pills with no editing affordances
- [ ] #3 Option dot colors correspond one to one with the wheel slice colors for the same index
- [ ] #4 Adding an option appears optimistically and reconciles with the arriving snapshot without duplicating
- [ ] #5 Removing an option updates the wheel immediately
- [ ] #6 The count label is accurate and the empty state reads sensibly at zero options
- [ ] #7 Label editing and the Picked chip are implemented per the decisions recorded in TASK-1
- [ ] #8 Option labels render as static text with no in-place editing affordance
- [ ] #9 Both variants are usable at 320px width, with the participant variant designed mobile-first
- [ ] #10 The Picked badge is local client state only, is never persisted, and is absent from the participant variant
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:48
---
Decisions from TASK-1 that this task was blocked on:

- Decision 10: option labels are NOT editable in place. The prototype input on every option row is dropped; render the label as static text. Removing an option and adding it again is the path to fix a typo, so keep both controls cheap to reach and make sure a fresh add lands visibly.
- The Picked chip is STILL OPEN (design doc section 11 question 5). Do not build it until that lands.
- Decision 14: responsive, and the participant variant is mobile-first. The read-only pill list is what most people will see, on a phone, in a group chat.
---

created: 2026-08-07 08:52
---
Decision 15 (design doc section 10): the Picked chip is LOCAL-ONLY. It lives in client state in the spinning browser, is gone on refresh, and is never visible to participants or to a second editor. No picked field, no endpoint, nothing persisted.

This task is now fully unblocked. Both TASK-1 gaps that gated it are resolved:
- Labels are static text, no in-place editing (decision 10).
- Picked is a local badge (decision 15).

Decision 16: the wheel title becomes click-to-edit inline in the page header, not in this panel. Do not add a title control here.
---
<!-- COMMENTS:END -->
