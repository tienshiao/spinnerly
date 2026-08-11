---
id: TASK-36
title: Let a viewer spin the wheel for themselves
status: Done
assignee:
  - '@claude'
created_date: '2026-08-10 21:26'
updated_date: '2026-08-10 22:43'
labels: []
dependencies: []
documentation:
  - docs/spin-the-wheel-design.md
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wheel page gives a viewer nothing to do. The spin button, the winner modal, confetti and the sound toggle are all inside the editor-only branch of app/w/[shareId]/wheel-page.tsx, so someone arriving on a share link reads a list and a paragraph beside a wheel that never moves.

Give the viewer their own spin. It is purely local — the same useSpin hook, the same rotation, the same result — and it is propagated nowhere: no write, no document, nothing the editor or another viewer ever sees. That is not a new model, it is the model the design doc already has. Section 6 makes every v1 spin local to the browser that ran it; what this changes is only WHO gets a browser that can run one.

Two things in the design doc argue the other way and must be revised rather than worked around:

- Section 6 'Participants do not see the spin in v1' and decision 13 answer the question 'does a participant see the EDITOR's spin' — that answer is still no, and stays no. But the section's copy guidance goes further and tells viewer copy to 'leave the spin out of it', which after this task is wrong. Rewrite it: what the copy must not imply is that the spin is SHARED, not that it exists.
- The comment on SoundToggle in wheel-page.tsx says a participant 'has nothing to mute'. After this they do.

The design doc's phase-2 story is unaffected. A synchronized spin still arrives as a spins/{spinId} document and still replaces this; a local spin is the same seam useSpin already documents on its pick parameter.

Scope decided with the user: the viewer gets the spin and the result, but NOT the 'Picked' chips. Options-panel AC 10 stands — the participant list is unchanged, and picked is still not passed to it, so the chip's absence stays a fact about the tree rather than a condition. A viewer's landed options are remembered by useSpin either way; nothing renders them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A viewer — a page loaded with no edit token, or with one the server rejected — has a working Spin the wheel button, disabled below two options and while a spin is in flight, exactly as an editor's is
- [x] #2 A viewer's spin runs the full 4.3s rotation, plays the ticks and the win chord, opens the winner modal with confetti, and offers Spin again
- [x] #3 The sound toggle is present for a viewer, in the same corner of the wheel card
- [x] #4 Copy beside the viewer's wheel says the spin is theirs alone and is not shared — it must not imply the editor or other viewers see it, and must not imply a spin is about to arrive from elsewhere (design doc section 6)
- [x] #5 An editor in Preview as viewer can spin, and the preview toggle stays disabled for the duration of that spin
- [x] #6 The 'Picked' chips remain absent from the participant options list; picked is still not passed to ParticipantList
- [x] #7 A viewer's spin issues no network request and writes nothing — asserted against the injected WheelApi
- [x] #8 Design doc section 6 and decision 13 are revised to say that a v1 spin is local to whoever ran it and available to both roles, and that what the copy must not imply is a shared spin
- [x] #9 The existing test asserting a viewer has no spin button is replaced rather than deleted, and the 'says nothing about watching, live updates, or a spin' test is retuned to the new copy rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/w/[shareId]/wheel-page.tsx — hoist the spin button, WinnerModal and SoundToggle out of the `role === 'editor'` branch so both roles render them. The viewer keeps a paragraph, but beside the button rather than in place of it, and it now says the spin is theirs alone.
2. Rewrite the two comment blocks whose reasoning this invalidates: `togglePreview`'s 'the strip that dismisses it is editor-only' and SoundToggle's 'a participant has nothing to mute'. The mid-spin preview guard STAYS — a page that rearranges itself under a wheel in flight is disorienting, and the queued re-spin still has to be dropped — but its justification is no longer that the result would be swallowed, and the comment must not go on claiming it is.
3. app/w/[shareId]/wheel-header.tsx — same, on the preview button's disabled comment.
4. options-panel.tsx untouched. `picked` is still not passed to ParticipantList.
5. docs/spin-the-wheel-design.md — section 2's role table (the Participant row's 'watch'), section 6's 'Participants do not see the spin in v1', and decision 13. The answer to 'does a participant see the EDITOR's spin' stays no; what changes is that a participant has a spin of their own, so the copy rule becomes 'must not imply the spin is shared' rather than 'must leave the spin out'.
6. wheel-page.test.tsx — the three assertions that a viewer has no spin button invert; the preview test drops the spin button from its list of editor affordances and asserts it survives instead; the 'what a participant is promised' suite is retuned from 'says nothing about a spin' to 'says the spin is not shared'. New case: a viewer's spin touches no method on the injected WheelApi.
7. npm test, npm run typecheck, npm run lint, npm run format.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scope grew by one file, found in the browser rather than in the suite: the winner card's description reads 'Marked as picked in the list', which is true behind an editor's card and false behind a participant's — the 'Picked' badge is deliberately absent there. Shipping it unchanged would have sent every viewer looking for a chip that does not exist, on the one screen where they are most likely to look. `WinnerModal` now takes the previewed `role` and swaps that sentence for 'That spin was yours alone.', which is also the answer to the question a viewer has at that moment. Design doc section 6 records the coupling, since nothing type-checks it — the sentence and the badge are in different files and neither knows about the other.

The mid-spin preview refusal was kept but demoted. It used to be a correctness guard (the winner modal was editor-only, so a spin finishing behind the preview announced itself to nobody); with the modal in both views nothing is lost either way, so it now earns its place only by keeping the page still under a moving wheel. Both the code comments and the test's rationale say so rather than repeating the old argument.

Verified: npm test (1067 passing, 35 files), npm run typecheck, npm run lint, npm run format:check all clean. Also driven by hand against the seeded emulator wheel in Chrome — viewer spin, result card, and the editor view unchanged with its PICKED chip and its own wording.

Post-review fix. A code review flagged the sound toggle overlapping the new participant paragraph; measured in the browser rather than assumed, and it was real: the toggle is 36px at bottom-3, so it rises 48px from the section's padding edge while the content box stops at p-5's 20px, intruding 28px into the flow. The last in-flow child used to be a centred button (never wide enough to reach the corner) and is now this paragraph. At a 320px viewport — the width the grid comment above explicitly claims to survive — its final line ran under the toggle's tap target; clearance at 360px was 39px, one re-wrap from nothing. Fixed with pb-7 on the paragraph, which makes the clearance a constant 16px at every width from 320 to 768 rather than a function of where the text happens to wrap. No test: jsdom has no layout engine, so this is only checkable in a real browser.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The spin is no longer editor-only. The spin button, the winner modal with its confetti, and the sound toggle moved out of the role branch in app/w/[shareId]/wheel-page.tsx, so a viewer gets the whole 4.3s rotation, the ticks, the win chord and 'Spin again'. Nothing propagates: no request, no document, no other client — which is the model design doc section 6 already had, applied to both roles rather than one.

The 'Picked' chips stay editor-only by decision, which forced the one change outside the plan: the winner card's 'Marked as picked in the list' is false on a participant's page, so WinnerModal takes the previewed role and says 'That spin was yours alone.' instead.

Copy beside the viewer's wheel names the spin and denies the propagation in the same breath. Design doc section 2's role table, section 6 (retitled 'A spin belongs to the browser that ran it') and decision 13 are revised to match: participants still do not see the EDITOR's spin, and the copy rule turns from 'leave the spin out' into 'must not imply the spin is shared'.

Verified with npm test (1067 passing), typecheck, lint, format:check, and by hand in Chrome against the seeded emulator wheel in both roles.
<!-- SECTION:FINAL_SUMMARY:END -->
