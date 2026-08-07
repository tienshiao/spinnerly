---
id: TASK-20
title: 'Build the winner modal, confetti and toast'
status: To Do
assignee: []
created_date: '2026-08-07 08:39'
labels: []
dependencies:
  - TASK-16
  - TASK-4
documentation:
  - docs/spin-the-wheel-editor/project/Wheel.dc.html
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The payoff moment, from the prototype.

Winner modal: a fixed backdrop of #2e2b25 at 45 percent, a centred card at min(460px, 92vw) with 40px 36px 32px padding and radius-lg on white, shadow-lg, entering on a 320ms pop keyframe that scales 0.85 to 1.03 to 1 while fading in. Contents are an uppercase 13px accent-700 kicker, the winning label in Caprasimo at 44px in accent-800, a line of neutral-700 body copy, and two pill buttons — Nice which closes, and Spin again which closes and re-spins after 120ms.

Confetti: 70 absolutely positioned spans over a fixed pointer-events-none layer at z-index 45, alternating 9x14px 2px-radius rectangles and 13px circles, colored from the SLICE array, each falling from -10vh to 110vh while rotating, with per-piece horizontal drift and rotation set through CSS custom properties and staggered start delays. Re-keyed on each burst so a repeat spin replays it.

Toast: a fixed pill at the bottom centre, accent-900 background with accent-100 text, auto-dismissing at 2.2 seconds. Used for link copied, suggestion sent, and suggestion accepted.

Reduced motion: suppress the confetti and the pop entirely rather than shortening them. Announce the result to assistive tech regardless.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The modal matches the prototype dimensions, type scale, colors and entrance animation
- [ ] #2 Confetti replays on a repeat spin and cleans itself up rather than accumulating DOM nodes
- [ ] #3 Toasts stack or replace predictably and never overlap the spin button
- [ ] #4 prefers-reduced-motion suppresses confetti and the pop animation
- [ ] #5 The modal traps focus, closes on Escape and on backdrop click, and returns focus to the spin button
- [ ] #6 The winning option is announced to screen readers via a live region
<!-- AC:END -->
