---
id: TASK-16
title: Build the wheel component and the spin animation
status: To Do
assignee: []
created_date: '2026-08-07 08:38'
labels: []
dependencies:
  - TASK-3
documentation:
  - docs/spin-the-wheel-editor/project/Wheel.dc.html
priority: high
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The centrepiece. Recreate the SVG wheel from the script block of docs/spin-the-wheel-editor/project/Wheel.dc.html.

Geometry: viewBox 0 0 400 400, centre 200, radius 190. Each option is an arc path from centre to arc to centre, filled from the ten-color SLICE array, stroked white at 3px. A white circle of radius 198 sits behind the wedges and a white hub of radius 34 with a 5px accent stroke sits on top. Labels are rotated to the wedge midangle, placed at 0.62 of the radius, flipped 180 degrees when the normalised midangle falls between 90 and 270 so text never reads upside down, filled from the INK array (which is per-slice, chosen for contrast against that slice), and truncated to 17 characters plus an ellipsis past 18.

The pointer is a CSS triangle above the wheel, not part of the SVG: 17px transparent left and right borders and a 34px accent-600 top border, with a drop shadow.

Spin: pick the winning index, compute target rotation as current minus current mod 360, plus six full turns, plus the offset that brings the chosen wedge midpoint under the pointer. Transition transform over 4.3s on cubic-bezier(0.16, 0.85, 0.16, 1), settle the result at 4.4s. Disabled while spinning and below two options.

The spinning client snapshots the options array at spin start and animates against that snapshot, then re-renders from live state once the result is shown. This is how mid-spin edits are handled — freeze the view, do not lock the data (decision 2). Concurrent edits land normally and no editor is ever blocked. There is deliberately no server-side spin lock in v1: the spin exists in a single browser, so there is no shared state to protect. The accepted residual is that a result may name an option deleted moments earlier, which for a lunch app is arguably correct — show it and let the group re-spin.

Honour prefers-reduced-motion: skip or heavily shorten the rotation and present the result directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The rendered wheel matches the prototype geometry, slice colors, stroke widths, hub and label placement
- [ ] #2 Labels flip so no label renders upside down, and long labels truncate at 17 characters with an ellipsis
- [ ] #3 A spin lands the pointer on the chosen option for every option count from 2 to the cap
- [ ] #4 The options list is snapshotted at spin start and the wheel does not reflow when a concurrent edit arrives mid-spin
- [ ] #5 The wheel re-renders from live state once the result is dismissed
- [ ] #6 Spin is disabled while spinning and when fewer than two options are present
- [ ] #7 prefers-reduced-motion suppresses the rotation and still yields a result
<!-- AC:END -->
