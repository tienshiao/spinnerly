---
id: TASK-26
title: Accessibility pass and cross-device audit
status: To Do
assignee: []
created_date: '2026-08-07 08:40'
updated_date: '2026-08-07 08:48'
labels: []
dependencies:
  - TASK-18
  - TASK-19
  - TASK-20
  - TASK-22
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Responsive layout is no longer deferred to this task — decision 14 makes it a requirement of every UI task, and TASK-17, TASK-18, TASK-19 and TASK-22 each carry their own width acceptance criteria. What remains here is the accessibility work and the audit that catches what the per-task criteria missed.

Accessibility: keyboard operation of every control including remove, approve and reject; visible focus rings using the 2px accent focus-visible outline from the design system rather than browser defaults; accessible names on icon-only buttons such as the option remove control, which is a bare multiplication sign in the prototype; live regions for spin results and toasts; and a contrast audit.

The Organic readme notes the accent-to-ground pair is tuned to roughly 3:1 — enough for icons, large text and interface chrome but not for body copy — so paragraph-size text in the accent must use a deep ramp step such as accent-700. Check the ten wheel slice INK colors against their SLICE backgrounds too; those pairs were chosen by eye in the prototype and have not been measured.

Audit: walk both pages on a real phone, not just a narrow desktop window. Touch target sizes, the on-screen keyboard covering the suggestion input, and the wheel at small sizes are the things a viewport resize will not surface.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both pages render without horizontal overflow from 320px to 1920px
- [ ] #2 The wheel page collapses to a single column on narrow viewports with the wheel first
- [ ] #3 Every interactive control is reachable and operable by keyboard with a visible focus ring
- [ ] #4 Icon-only buttons have accessible names
- [ ] #5 Spin results and toasts are announced via live regions
- [ ] #6 Body-size text meets 4.5:1 contrast and interface chrome meets 3:1, including wheel slice labels
- [ ] #7 prefers-reduced-motion is honoured on the wheel, the confetti, the modal and the landing page animations
- [ ] #8 Icon-only buttons have accessible names
- [ ] #9 Spin results and toasts are announced via live regions
- [ ] #10 Body-size text meets 4.5:1 contrast and interface chrome meets 3:1, including all ten wheel slice label pairs
- [ ] #11 prefers-reduced-motion is honoured on the wheel, the confetti, the modal and the landing page animations
- [ ] #12 Both pages are walked on a real iOS and a real Android device, with touch targets and keyboard-overlap issues fixed
- [ ] #13 No horizontal overflow anywhere from 320px to 1920px
- [ ] #14 Every interactive control is reachable and operable by keyboard with a visible focus ring
<!-- AC:END -->
