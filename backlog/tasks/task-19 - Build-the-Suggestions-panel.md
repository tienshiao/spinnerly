---
id: TASK-19
title: Build the Suggestions panel
status: To Do
assignee: []
created_date: '2026-08-07 08:38'
updated_date: '2026-08-08 06:10'
labels: []
dependencies:
  - TASK-16
  - TASK-12
documentation:
  - docs/spin-the-wheel-editor/project/Wheel.dc.html
priority: high
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The lower right panel, visually set apart from Options by an accent-2-100 fill and an accent-2-300 border. Header reads Suggestions at 22px against a count label of N waiting or all caught up in accent-2-700.

Each suggestion is a white card at radius-md with a dashed accent-2-400 border, the label at 16px, and role-dependent controls. For an editor with a pending suggestion: an Approve button filled accent-2-500 with white text and a Reject button as a divider-outlined ghost. For a participant: a state chip instead of buttons.

The queue is public. Everyone holding the share URL sees pending and accepted suggestions (decision 3) — it prevents duplicate submissions and makes the curation feel collaborative rather than opaque. Both roles read the same list.

Reject is a hard delete, so a rejected suggestion vanishes from every viewer immediately. The prototype Declined chip does not survive into the real app; confirm against the TASK-1 decision before building it.

Participant variant also gets the submit row: a pill input placeholder Suggest a spot with a Suggest button, Enter submits, followed by the confirmation toast. When suggestionsOpen is false the submit row is replaced by a closed-for-suggestions message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The panel matches the prototype accent-2 treatment, dashed card borders and control styling
- [ ] #2 Pending and accepted suggestions are visible to both roles
- [ ] #3 Approve moves the suggestion into the options list and the wheel in one step, with no duplicate on a double-click
- [ ] #4 Reject removes the suggestion from every connected client
- [ ] #5 The participant submit row is present for participants and absent for editors
- [ ] #6 A wheel with suggestionsOpen false shows a closed message instead of the submit row
- [ ] #7 The count label and the all caught up empty state render correctly
- [ ] #8 No rejected or declined state is rendered anywhere; rejected suggestions simply disappear
- [ ] #9 No submitter name or attribution is displayed on any suggestion
- [ ] #10 The panel and the submit row are usable at 320px width
- [ ] #11 The suggestionsOpen toggle is present in the panel header for editors and absent for participants
- [ ] #12 Toggling it takes effect for every connected client without a reload
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
clientHint no longer exists (TASK-12, 2026-08-07). The note above saying it 'exists for dedupe only and is never displayed' is out of date: the field was removed and design doc section 4 amended, because section 5 makes the suggestions subcollection publicly readable and rules cannot exclude a field — so storing it handed every participant a per-submitter correlator, which is decision 12's attribution by the back door. Decision 12 itself is unchanged and still binding on this panel: no submitter name, no by-line, nothing identifying who sent what. There is simply no field to not display.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:48
---
Decisions from TASK-1 that this task was blocked on:

- Decision 11: reject is a hard delete. The prototype Declined chip and the rejected state styling are dropped entirely. A rejected suggestion vanishes from every connected client. There is no tombstone and no undo.
- Decision 12: no submitter attribution. Drop the by-name line from the prototype card. clientHint exists for dedupe only and is never displayed.
- Decision 14: responsive, mobile-first. The submit row is the single most important control on the participant mobile view.
---

created: 2026-08-07 08:52
---
Decision 16 (design doc section 10): the suggestionsOpen kill switch lives in THIS panel, in the header row next to the count label. Not in a settings menu, not behind an overflow icon.

It is the only tool an editor has while a wheel is actively being spammed, so it needs to be within reach of the thing going wrong. An editor reaching for it is already having a bad time; do not make them hunt.

The toggle is editor-only. Participants see the resulting closed-for-suggestions state, not the control.
---
<!-- COMMENTS:END -->
