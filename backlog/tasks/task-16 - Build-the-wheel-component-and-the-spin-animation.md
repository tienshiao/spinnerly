---
id: TASK-16
title: Build the wheel component and the spin animation
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:38'
updated_date: '2026-08-09 03:55'
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
- [x] #1 The rendered wheel matches the prototype geometry, slice colors, stroke widths, hub and label placement
- [x] #2 Labels flip so no label renders upside down, and long labels truncate at 17 characters with an ellipsis
- [x] #3 A spin lands the pointer on the chosen option for every option count from 2 to the cap
- [x] #4 The options list is snapshotted at spin start and the wheel does not reflow when a concurrent edit arrives mid-spin
- [x] #5 The wheel re-renders from live state once the result is dismissed
- [x] #6 Spin is disabled while spinning and when fewer than two options are present
- [x] #7 prefers-reduced-motion suppresses the rotation and still yields a result
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. components/wheel/geometry.ts — pure, React-free, DOM-free. Constants verbatim from the prototype (viewBox 400, centre 200, R 190, backdrop 198, hub 34 with a 5px accent stroke, label at 0.62R, 3px white wedge stroke); wedgePath; labelPlacement with the 90–270 flip; truncateLabel; targetRotation(current, index, count) = current - current%360 + 6 turns + (360 - (i*seg + seg/2))%360.

   Its own file rather than inline in the component because TASK-23 draws the same wedges server-side for the OG image, and a 'use client' module is the wrong place to reach into for that.

   In components/wheel/ rather than lib/wheels/ deliberately: the six-module table in CLAUDE.md is the client DATA path, and none of this is on it.

2. components/wheel/use-spin.ts — the spin state machine. Owns rotation, the spinning flag, the result, and the frozen options snapshot: freezes at spin start, thaws on dismiss (AC 4, AC 5). Exposes canSpin, false while spinning and below two options (AC 6). prefers-reduced-motion through useSyncExternalStore over matchMedia, guarded for matchMedia being absent — jsdom has it only behind a stub and an older Safari does not have addEventListener on the list (AC 7). Injectable pick so the RNG is testable; 4.3s transition, settle at 4.4s, timers cleared on unmount.

   THE WINNER IS READ FROM THE SNAPSHOT, NOT FROM LIVE STATE. The prototype's settle callback does this.state.options[i], which after a mid-spin delete either names the wrong option or bails out entirely. Decision 2 says freeze the view and do not lock the data, and accepts that a result may name an option deleted moments earlier — so the snapshot is the correct read and the live array is the wrong one. Gets its own test.

3. components/wheel/wheel.tsx — 'use client', presentational only. Pointer as a CSS triangle above the SVG (17px transparent sides, 34px accent-600 top, drop shadow), white backdrop circle, wedges, hub. Takes already-snapshotted options, so it holds no spin state.

4. Truncation counts CODE POINTS, not UTF-16 units. .slice(0,17) splits an astral character into a lone surrogate and renders a replacement glyph. Same argument validation.ts already makes against Zod's .max(); labels are user text and OPTION_LABEL_MAX is 60, so this is reachable.

5. Tests. geometry.test.ts in plain node — AC 1 as exact path and placement values, AC 2 as the flip predicate over every index at every count plus the truncation boundaries at 17/18/19 and an astral case, AC 3 as every count from 2 to OPTIONS_MAX times every index, asserting the DRAWN midangle lands under the pointer rather than re-deriving targetRotation's own algebra. use-spin.test.ts and wheel.test.tsx in jsdom with fake timers: the mid-spin edit (AC 4), the thaw on dismiss (AC 5), canSpin (AC 6), reduced motion still yielding a result with no transition (AC 7), and the winner surviving a mid-spin delete.

6. app/kitchen-sink — the wheel with a slice-count control and a Spin button, so the easing, the 4.3s curve and the reduced-motion path are looked at by a human in this task rather than first appearing in TASK-17.

7. npm test, typecheck, lint, format:check, build.

Not in scope, and stated so the reviewer does not look for it: the Spin button on the real page (TASK-17), the winner modal, confetti and toast (TASK-20), and any persistence of a spin — there is no spins write in v1, because the spin exists in one browser and has no shared state to protect. canSpin and result are outputs of the hook; AC 6 is satisfied by the flag, not by a disabled attribute on a button this task does not render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:BEGIN -->
Delivered: three modules in components/wheel/ — the geometry as pure arithmetic, the spin as a state machine, and a presentational SVG — plus a hand-drivable section on the kitchen sink page.

- components/wheel/geometry.ts — constants, wedgePath, labelPlacement, truncateLabel, targetRotation. No React, no DOM, no 'use client', so TASK-23's OG image generator can import it server-side rather than growing a second implementation of the same wedges.
- components/wheel/use-spin.ts — rotation, the spinning flag, the result, the frozen snapshot, and prefers-reduced-motion through useSyncExternalStore.
- components/wheel/wheel.tsx — pointer, backdrop, wedges, hub. Stateless; takes the options to draw.
- app/kitchen-sink/wheel-demo.tsx — slice-count control and a Spin button.

Unit 687 (up from 598 — 91 new across the three suites); emulator 269 unchanged. Typecheck, lint, format:check clean, production build succeeds.

A BUG THE TESTS COULD NOT HAVE FOUND, which is the argument for having built the kitchen-sink section:

A one-option wheel rendered as a blank white disc. The natural wedge path — centre, out, around, back — makes the arc's start and end points COINCIDE when the segment is 360 degrees, and SVG defines an arc with identical endpoints as equivalent to omitting the segment entirely (1.1 F.6.2). It is not the renderer choosing the short way round, so the large-arc flag does not rescue it and the code reads as correct. What is left is a line from the centre to twelve o'clock, and the label on top is white ink chosen for contrast against a fill that is not there. The prototype has the same defect and never met it, because it is only ever shown with six options. Fixed by describing the full circle as two half-turn arcs, with no spoke back to the centre — the boundary between the only wedge and itself is not a real edge. Reachable in the real app: a one-option wheel is on screen the whole time an editor is adding the first two.

Decisions worth knowing about:

- The winner is read from the array the rotation was computed against, not from live state. The prototype reads this.state.options[i] at settle, which after a mid-spin delete names a different option or nothing at all. Decision 2 accepts that a result may name an option deleted moments earlier; what it does not accept is naming the wrong one.
- Truncation counts CODE POINTS, the one deliberate departure from the prototype's .slice(0, 17). An emoji is two UTF-16 units, so a plain slice leaves a lone surrogate and renders a replacement glyph. Same argument validation.ts already makes against measuring user text with .length. Not grapheme clusters — a ZWJ sequence will still split, and arguing about that on a wedge label does not pay.
- prefers-reduced-motion JUMPS the wheel to the winning wedge rather than skipping the rotation. Leaving it at its old angle would put the pointer on one option while the result named another. The settle shortens to 400ms rather than firing immediately, so the landed wheel is on screen for a beat instead of appearing simultaneously with the announcement.
- The pointer is a CSS triangle OUTSIDE the svg. Structural, not stylistic: everything inside the element rotates, so a pointer drawn there spins along with the wedges it indicates. Asserted, and the assertion fails when the element is moved inside.
- Geometry is in components/wheel/ rather than lib/wheels/. That directory is the client DATA path — the six modules CLAUDE.md lists, Firestore document to rendered state — and wedge angles are not on it.
- useSpin takes positional arguments rather than an input object. An exported type with a function-typed member, in a module carrying 'use client', trips Next's TS plugin into reporting a non-serializable client prop and advising a rename to pickAction. It is a hook argument, not a prop; a second parameter says the same thing with no standing editor warning.

Verified by mutation, not only by passing. Each mutation was caught by the assertion meant to catch it:

- targetRotation dropping its six turns: 3 cases fail.
- Flip predicate > 90 becoming >= 90: exactly the exactly-vertical case fails.
- truncateLabel back to a UTF-16 slice: the astral case fails.
- options: frozen ?? live becoming options: live: 4 cases fail, the whole of AC 4 and AC 5.
- Reduced motion ignored in the transition: the AC 7 case fails.
- canSpin dropping its two-option floor: 2 cases fail.
- Per-slice ink replaced by one hard-coded white: the contrast case fails.
- Hub drawn before the wedges: the layering case fails.
- The pointer relocated inside the rotating svg: 2 cases fail.
- The single-option arc put back the broken way: 3 cases fail.

ONE MUTATION SURVIVED, and is recorded rather than papered over. Rewriting the settle to read live[index] instead of snapshot[index] passes all 91 cases, because inside that callback the two are the same captured binding — the closure is the mechanism and 'snapshot' earns its line as documentation. The way the bug actually returns is a REF: answering a stale-closure warning with liveRef.current[index] reintroduces the prototype's behaviour exactly, and that mutation the suite does catch. Both the code comment and the test's docblock now say which of the two they guard, because a reader who assumes the strict-looking mutation is covered would trust the test for more than it does.

Checked in a browser at every option count the demo offers — 0, 1, 2, 3, 6, 11 and the cap of 50 — which is how the single-option bug surfaced. The freeze and the thaw were confirmed live: switching to 50 slices while a result is up leaves the wheel showing the six it spun, and Dismiss thaws it.

Observation for TASK-18 and TASK-26, not fixed here because no AC asks for it and inventing a rule is not this task's call: at the 50-option cap the labels overlap into illegibility. The wheel is correct — right colours, right angles, nothing upside down — but unreadable. The prototype behaves the same way and the design doc says nothing about label handling at high counts.

Not in scope, and stated so the reviewer does not look for it: the spin button on the real page and role resolution (TASK-17), the winner modal, confetti and toast (TASK-20), and any persistence of a spin — v1 has no spins write, because the spin exists in one browser and has no shared state to protect. canSpin and result are outputs of the hook.

Post-review fixes (/code-review, four findings; three in this task's code, all confirmed and fixed, and one out of scope).

- use-spin.ts, the pick clamp did not survive NaN. Clamping is comparison and every comparison against NaN is false, so it passed through Math.trunc, Math.max and Math.min untouched, snapshot[NaN] was undefined, and SpinResult.option held a value its own type forbids — 4.4 seconds after the click, with nothing in between to suggest why. The comment directly above claimed the clamp existed to stop exactly that, so the code contradicted its own docstring. Not hypothetical for the reason the parameter is injectable at all: phase 2's server draw parses an index out of a response and Number(...) of anything malformed is NaN.

  Fixed with Number.isNaN and ONLY Number.isNaN. The first attempt used Number.isFinite, which is the obvious spelling and is wrong: the infinities are perfectly ordered, so Infinity already clamped to the last index and -Infinity to the first, and gating on finiteness throws away a correct answer to fix a different value's problem. Caught because the table-driven test asserted the infinities' existing behaviour rather than only the broken case, and both spellings are now pinned by their own row.

- use-spin.ts, a preference toggled MID-SPIN half-applied. The transition read the live reducedMotion while the settle delay was captured at spin start, so flipping the setting during a rotation snapped the wheel to its wedge immediately and then left it sitting there for the remaining four seconds with no result — the dead air REDUCED_MOTION_SETTLE_MS exists to prevent, arrived at by trying to honour the preference promptly. Both now read a flag fixed at spin start: one in-flight spin finishes the way it started, the next honours the new setting. The bound on how long the preference goes unhonoured is one spin.

- wheel.tsx, WHEEL_RADIUS was a dead export whose comment claimed the tests used it. They import from ./geometry directly. Deleted; a re-export justified by a consumer that does not exist is one the next reader preserves on the strength of the comment.

Unit 687 -> 693. The three fixes were mutation-verified in turn: removing the NaN guard fails the NaN row and nothing else; widening it to Number.isFinite fails the Infinity row and nothing else; putting the transition back on the live preference fails the mid-spin toggle case and nothing else.

The fourth finding is in lib/wheels/optimistic.ts and belongs to TASK-15, not here — see the comment on this task.

Follow-up after manual testing: the freeze reads as a bug in the demo, so both the demo and the contract were made explicit.

- app/kitchen-sink/wheel-demo.tsx — the status line now names the freeze when the drawn slice count has diverged from the selected one, in both the mid-spin and result-showing states, and names Dismiss as the way out. Changing the count with a result up previously did nothing with no explanation, which is correct behaviour presented as a fault. The real page will not have this problem — a modal covering the screen makes dismissal unavoidable — but the demo's Dismiss is a small button off to one side.
- use-spin.ts — dismiss() now documents itself as MANDATORY for whatever presents the result. This is the contract TASK-20 has to honour and the failure mode is silent: a winner modal that closes on its own state without calling it leaves the wheel frozen on its snapshot for the rest of the session, so options an editor adds stop appearing and accepted suggestions never show up. No error, nothing in the console, and the symptom reads as a broken Firestore listener rather than a missed call — the listeners are fine, the projection is fine, and the only thing wrong is a boolean nobody cleared.
- A new case pins the one path that is safe WITHOUT dismissing: 'Spin again' re-freezes from live, so a second spin picks up everything that landed while the last result was on screen rather than re-running against the previous snapshot. Mutation-verified — making setFrozen keep its existing value fails exactly that case.

Unit 693 -> 694.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-09 02:10
---
Code review raised a fourth finding that is out of this task's scope and is left unactioned: versionCaughtUp in lib/wheels/optimistic.ts (TASK-15, already committed) compares a route-computed wall-clock updatedAt against the stored one, and clock skew between serverless instances can strand an optimistic entry rather than merely delay it.

The path: two editors patch the same field seconds apart on instances whose clocks differ. A is handed version T; B's write lands later but stores T-300ms. A's identity evidence is now false, because B's value won, and A's version evidence is false too, because the stored updatedAt never reaches T. A's row waits for a version no snapshot will ever carry, and the wheel does not heal until somebody writes to it again — an idle wheel does not heal at all.

Worth taking seriously because CLAUDE.md names 'a row that never clears' as the specific failure the version mechanism must not produce, and because the module docstring currently says entries reconcile 'to within that skew', which understates it: skew in the wrong direction is not a delay, it is a stall. The residual is narrow — concurrent editors, same field, then silence — and the fix is either a skew tolerance on the comparison or an explicit note alongside the existing null-version case.

Not fixed here because it is another task's committed code and no acceptance criterion on TASK-16 touches it. Flagged for a follow-up task.
---

author: @claude
created: 2026-08-09 03:47
---
Contract for TASK-20 (winner modal), stated here because the failure is silent and will not look like the modal's fault.

useSpin freezes the wheel on the options it spun, from spin start until dismiss() runs. Every path that closes the winner modal must call it — the Nice button, Spin again, the backdrop, Escape. Miss one and the wheel keeps drawing that snapshot for the rest of the session: newly added options never appear, accepted suggestions never appear, and each further spin draws from a list the page has stopped showing. There is no error and nothing in the console, and it presents as a dead Firestore listener rather than as a missing call.

'Spin again' is the one exception and only by accident of design: spin() re-freezes from live, so it is safe whether or not it dismisses first. There is a test pinning that, so it will not quietly stop being true.

Also relevant to TASK-17: the spin button is the page's, and its disabled state is useSpin's canSpin — false while spinning and below two options. Do not re-derive it from options.length, which misses the spinning half.
---

author: @claude
created: 2026-08-09 03:55
---
Raised by /code-review during TASK-16 and verified against the code rather than taken on report: versionCaughtUp is the only thing that can retire an entry whose identity evidence has gone false, the slow flag does not retire anything, and the comparison is a plain >= on two wall-clock Dates. Filed as TASK-29 rather than fixed in TASK-16, whose acceptance criteria touch none of this.
---
<!-- COMMENTS:END -->

<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the wheel and its spin as three modules in components/wheel/, split by what can be tested without a DOM: geometry.ts holds the arithmetic (React-free and directive-free, so TASK-23's OG image generator can import it server-side rather than growing a second copy of the wedge math), use-spin.ts holds the state machine, and wheel.tsx draws. A section on the kitchen sink page drives it by hand.

All seven acceptance criteria met. Verified with 694 unit tests (up 96), the emulator suite unchanged at 269, and a clean typecheck, lint, format:check and production build. Every load-bearing assertion was mutation-tested rather than only run: sixteen mutations, each caught by the assertion meant for it, and the one that survived is recorded in the notes with an explanation of what actually guards that invariant.

Two defects were found by looking at the thing in a browser, which is what the kitchen sink section was added for. A one-option wheel rendered as a blank white disc, because SVG treats an arc whose endpoints coincide as omitted entirely and the large-arc flag does not change that — the prototype has the same defect and never met it. And the freeze read as a broken control in the demo, which was an affordance problem rather than a component one; the status line now names it.

Code review raised three findings in this task's code, all confirmed and fixed: a NaN hole in the pick clamp that contradicted its own comment, a reduced-motion preference toggled mid-spin that half-applied and left seconds of dead air, and a dead export. A fourth finding concerns clock skew in TASK-15's optimistic layer and is left unactioned as out of scope — see the comment on this task.
<!-- SECTION:FINAL_SUMMARY:END -->
