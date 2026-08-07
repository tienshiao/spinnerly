---
id: TASK-26
title: Accessibility pass and cross-device audit
status: To Do
assignee: []
created_date: '2026-08-07 08:40'
updated_date: '2026-08-07 21:48'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 19:31
---
Concrete finding from TASK-28 (landing page), already measured — three text nodes on / fail WCAG AA:

1. 'Open a wheel' (header), 14px — #f7f6fb on #f2545b, 3.15:1
2. 'Make a wheel' (hero), 18px — #f7f6fb on #f2545b, 3.15:1
3. 'Make the wheel now, argue never.' (band), 18px — #ffffff on #f2545b, 3.39:1

1 and 2 are not landing-page bugs. They are the shared Button 'default' variant from TASK-4 — bg-primary on text-primary-foreground — so every primary button in the app carries this ratio, on every screen. globals.css states the cause plainly: the accent-to-ground pair is tuned to 3:1, which carries icons and large text but not body copy. That is fine for the 40px band heading, which clears the 3:1 large-text bar, and not fine for a 14px button label.

The fix is a design-system decision, not a per-page one. Options, roughly in increasing order of blast radius: darken the primary button fill to accent-600 (#d93b45, 4.0:1 against the ground — still short of 4.5) or accent-700 (#b02730, 6.14:1, comfortably passing but a visibly deeper red than the prototype); or keep the fill and darken nothing, accepting the 3:1 pairing as a documented deviation.

Worth deciding once here rather than per screen, since it lands on every button the product ships.

Also flagged in the same sweep: the three use-case pill colour pairs on the landing page (#ffe6ab/#6b4a00, #d6f5ea/#0d4c3f, #e8e2fb/#3a2a63) are one-off literals with no home in the theme ramps. They pass AA, but they are unowned colour and would be worth either tokenising or replacing during this pass.
---

author: @claude
created: 2026-08-07 21:48
---
Correction to my previous comment — item 3's ratio was wrong, and it is the number TASK-26 would have decided from.

I recorded the band paragraph as '#ffffff on #f2545b, 3.39:1'. That measured the SPECIFIED colour. The element also carries opacity 0.92 (from the prototype), which composites the painted text to #fef1f2. Re-measured with opacity folded in: 3.08:1, not 3.39:1. Slightly worse than logged, and still short of the 4.5:1 it needs at 18px normal weight.

Corrected table for the three failures on /:

1. 'Open a wheel' (header), 14px — #f7f6fb on #f2545b, 3.15:1, needs 4.5
2. 'Make a wheel' (hero), 18px — #f7f6fb on #f2545b, 3.15:1, needs 4.5
3. 'Make the wheel now, argue never.' (band), 18px — painted #fef1f2 on #f2545b, 3.08:1, needs 4.5

26 other text nodes on the page pass.

One extra option for item 3 specifically, which items 1 and 2 do not have: dropping opacity-92 lifts it from 3.08 to 4.04 without touching the band colour or the shared button variant. That still fails 4.5, so it is a partial mitigation rather than a fix — I left it in place because it is prototype-faithful and does not resolve the criterion either way. Flagging it because it is free if this pass decides to take it.

General lesson for the rest of this audit: measure the painted colour, not the specified one. Any element under an opacity or inside an opacity-carrying ancestor will read better than it renders.
---
<!-- COMMENTS:END -->
