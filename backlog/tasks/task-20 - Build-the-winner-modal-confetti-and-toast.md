---
id: TASK-20
title: Build the winner modal and confetti
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:39'
updated_date: '2026-08-10 02:54'
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

Toast: cut. The task originally carried a bottom-centre toast pill for link copied, suggestion sent and suggestion accepted. Decided 2026-08-09 not to build it: the two confirmations that matter already ship inline and closer to the action — the header's Copy button swaps its own label, and the suggest form answers under the field — and a toast would confirm each of those a second time, which for the suggest form means two live-region announcements of one send. sonner and components/ui/sonner.tsx stay in the tree for the kitchen sink; nothing on the wheel page mounts a Toaster.

Reduced motion: suppress the confetti and the pop entirely rather than shortening them. Announce the result to assistive tech regardless.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The modal matches the prototype dimensions, type scale, colors and entrance animation
- [x] #2 Confetti replays on a repeat spin and cleans itself up rather than accumulating DOM nodes
- [x] #3 prefers-reduced-motion suppresses confetti and the pop animation
- [x] #4 The modal traps focus, closes on Escape and on backdrop click, and returns focus to the spin button
- [x] #5 The winning option is announced to screen readers via a live region
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/motion.css — the prototype's two page-level keyframes (wl-pop, wl-fall) as Tailwind --animate-* tokens, imported from globals.css. Not theme.css: theme.css is the Organic port, and these are the prototype page's own <style> block.
2. components/wheel/confetti.tsx — 70 deterministic pieces (no Math.random, so nothing differs between the server render and the client one), self-removing once the longest piece has landed, and returning null outright under prefers-reduced-motion.
3. app/w/[shareId]/winner-modal.tsx — built on Base UI's Dialog primitives directly rather than components/ui/dialog.tsx, because the pop keyframe has to replace the shadcn zoom rather than fight it; reuses useInertBackground and pins finalFocus to the spin button.
4. app/w/[shareId]/wheel-page.tsx — replaces the placeholder result strip with the modal, holds the ref the modal returns focus to, owns the 120ms Spin again timer (the modal cannot: it unmounts on close and its own cleanup would clear the timer), and renders the persistent sr-only live region.
5. Tests: components/wheel/confetti.test.tsx, app/w/[shareId]/winner-modal.test.tsx, and the spin describe in app/w/[shareId]/wheel-page.test.tsx rewritten against the modal.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built app/w/[shareId]/winner-modal.tsx (Base UI dialog primitives, not components/ui/dialog.tsx — the shadcn zoom entrance and the prototype's pop both write the animation shorthand and cannot be reconciled by tailwind-merge), components/wheel/confetti.tsx, and app/motion.css for the two keyframes. The page wires them up, holds the spin-button ref the modal returns focus to, owns the 120ms Spin again timer, and carries the sr-only live region.

Three things only a browser found, all verified against the seeded emulator wheel:

- **The pop was off-centre by half the card.** Tailwind v4's -translate-x-1/2 writes the independent `translate` property, so a keyframe animating `transform: translate(-50%,-50%) scale(...)` — the spelling every pre-v4 example uses — ADDS to the centring rather than replacing it. Measured at exactly (-230, -107) on a 460x214 card. Now animates the independent `scale` property and leaves `translate` alone.
- **The confetti fired once per page load and never again.** It was mounted inside Dialog.Portal and relied on the portal unmounting to replay; Base UI keeps a closed popup mounted until its exit animations settle, which it decides on an animation frame, and in a merely occluded window that frame never came. Gated on `open` instead, which also stops a burst carrying on over a page whose backdrop has gone.
- The pop is `data-open:`-scoped rather than a bare class, so a `both`-filling enter animation is not left attached to a closed popup for Base UI to reason about.

Also confirmed in the browser: focus returns to the spin button on both Nice and Escape, the page is not left inert, and three consecutive spins each produce 70 fresh pieces. The old placeholder result strip is gone; the page's spin describe in wheel-page.test.tsx was rewritten against the modal, and the preview-mid-spin case now closes the card first, since a modal that inerts the header is itself why that guard can no longer be reached that way.

Tests: components/wheel/confetti.test.tsx (7), app/w/[shareId]/winner-modal.test.tsx (12), plus four page-level cases. 899 pass; lint, typecheck, format and build clean.

Follow-up: the confetti was visible along the top edge of the page before it fell.

Pieces are staggered by up to 900ms, and an animation that has not started yet styles nothing — `forwards` fills only AFTER one ends — so for most of a second seventy spans sat at `top: 0` and then dropped out of the row one at a time. The start offset had been written into the keyframe's 0% frame, which is exactly the place that does not apply during a delay.

It now lives on the span as `-top-[10vh]`, with the keyframe travelling 0 to 120vh instead of -10vh to 110vh, and the fill mode changed to `both` so the delay-phase state is stated twice rather than depending on a keyword whose absence is silent.

Measured in the browser: at the instant the burst mounts, 0 of 70 pieces have any part below the top of the viewport, and the piece holding the longest delay stays at bottom -71px until its 900ms is up. Mid-burst all 70 are on screen, so nothing was pushed out of frame by the extra travel. confetti.test.tsx pins the class, which is as much as jsdom can see with neither layout nor animations.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The wheel now lands on a modal instead of a strip: the prototype's card at min(460px,92vw), 40/36/32 padding, radius-lg on white with shadow-lg, an accent-700 kicker, the winner at 44px in accent-800, and Nice / Spin again as pills. A 70-piece confetti burst falls behind it and takes itself out of the DOM once the last piece has landed. prefers-reduced-motion drops both the burst and the pop and keeps the card; the result is announced from a persistent sr-only live region regardless, so it does not depend on the card being read.

The toast the task originally carried was cut — the two confirmations it would have covered already ship inline and closer to the action.

Verified by 899 unit tests (12 on the modal, 7 on the confetti, 4 on the page's wiring to useSpin) and by driving a seeded wheel in a real browser, which is where three things the jsdom suite cannot see were found and fixed: the pop centring against Tailwind v4's independent translate property, a confetti burst that replayed only once per page load, and a both-filling enter animation left attached to a closed popup. Lint, typecheck, format and build clean.
<!-- SECTION:FINAL_SUMMARY:END -->
