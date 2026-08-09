---
id: TASK-19
title: Build the Suggestions panel
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:38'
updated_date: '2026-08-09 22:27'
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
- [x] #1 The panel matches the prototype accent-2 treatment, dashed card borders and control styling
- [x] #2 Pending and accepted suggestions are visible to both roles
- [x] #3 Approve moves the suggestion into the options list and the wheel in one step, with no duplicate on a double-click
- [x] #4 Reject removes the suggestion from every connected client
- [x] #5 The participant submit row is present for participants and absent for editors
- [x] #6 A wheel with suggestionsOpen false shows a closed message instead of the submit row
- [x] #7 The count label and the all caught up empty state render correctly
- [x] #8 No rejected or declined state is rendered anywhere; rejected suggestions simply disappear
- [x] #9 No submitter name or attribution is displayed on any suggestion
- [x] #10 The panel and the submit row are usable at 320px width
- [x] #11 The suggestionsOpen toggle is present in the panel header for editors and absent for participants
- [x] #12 Toggling it takes effect for every connected client without a reload
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/w/[shareId]/suggestions-panel.tsx — one component for both variants, driven by the role the page already resolved, exactly as OptionsPanel is. Props and callbacks, never the session, so every state below is an object literal in the test rather than a wheel driven through Firestore. Accent-2 chrome per the prototype: bg-accent-2-100 on an accent-2-300 border, header at 22px against the neighbour's 26px, count in accent-2-700, cards neutral-100 at radius-md with a dashed accent-2-400 border, label 16px (AC 1).

2. Controls follow the ROW's state, not the role alone. Pending + editor: Approve filled accent-2-500 and Reject as a divider-outlined ghost. Accepted: an Added chip, for both roles. Pending + participant: a Waiting chip. Both roles read the same list (AC 2, decision 3). There is no rejected branch to render (AC 8): reject is a hard delete and SuggestionStatus holds only pending and accepted, so the absence is a fact about the type rather than a case someone could reinstate. No attribution anywhere (AC 9, decision 12) — clientHint was removed, so there is no field to not display.

3. AC 3's double-click guard is suggestion.pending || suggestion.optimistic disabling both controls. Pending because the accept is outstanding; optimistic because a local:n id addresses nothing, which is EditorRow's reason in the Options panel. This is the caller-side half TASK-32 explicitly names — the projection-level invariant stays that task's.

4. The suggestionsOpen kill switch in the panel header, editor-only (AC 11, decision 16, design doc section 7 — it is the one control reached for while a wheel is being spammed). role=switch with aria-checked rather than a Button with aria-pressed: there is no Switch primitive and a switch is what this is. Reads the projected suggestionsOpen, which the optimistic layer already patches, and disables on saving.suggestionsOpen. AC 12 needs no code — PATCH writes the wheel document and every listener delivers it; the test states it by rendering two pages off one snapshot.

5. Participant submit row: a form rather than a keydown handler, for the reason AddRow records — Enter submits by definition and a phone keyboard offers Go instead of a newline key. Measured and sent as toStoredForm + countCharacters against SUGGESTION_LABEL_MAX, never .length. Draft cleared on submit and restored only into a field the user has left alone, which is AddRow's rule and the same failure. Absent for editors (AC 5); present in the preview, because the preview is honest about what a participant sees.

6. Closed replaces the submit row with a message rather than disabling it (AC 6). PENDING_SUGGESTIONS_MAX does the same — not an AC, but a participant typing into a field certain to 409 is the wasted effort the Options panel's cap message already avoids.

7. The confirmation after a submit is inline and local, not a toast. WheelHeader's copy button set that precedent and TASK-20 owns toasts; the Toaster is not mounted outside the kitchen sink.

8. wheel-page.tsx — PanelSlot and its placeholder go; the panel takes session.view.suggestions, the projected suggestionsOpen, view.saving.suggestionsOpen and the four callbacks.

9. Tests. suggestions-panel.test.tsx from props for the component half of every AC. The two claims that need the whole page — an accept drawing its option before any snapshot confirms it, and a toggle one client sets that another sees — go in wheel-page.test.tsx.

10. npm test, typecheck, lint, format, build. AC 10's 320px check is done in a real browser against the emulator: jsdom has no layout, so a passing test there would say nothing.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
clientHint no longer exists (TASK-12, 2026-08-07). The note above saying it 'exists for dedupe only and is never displayed' is out of date: the field was removed and design doc section 4 amended, because section 5 makes the suggestions subcollection publicly readable and rules cannot exclude a field — so storing it handed every participant a per-submitter correlator, which is decision 12's attribution by the back door. Decision 12 itself is unchanged and still binding on this panel: no submitter name, no by-line, nothing identifying who sent what. There is simply no field to not display.

Delivered: app/w/[shareId]/suggestions-panel.tsx, its 34-case suite, five page-level cases, and the placeholder panel removed from wheel-page.tsx. Unit suite 827 (up from 788); typecheck, lint, format:check clean and the production build succeeds.

- suggestions-panel.tsx — one component for both variants, props rather than the session. Accent-2 chrome per the prototype, 22px heading, dashed accent-2-400 cards. Controls follow the row rather than the role: pending + editor gets Approve and Reject, everything else gets a state chip. Two states and never a third — decision 11 makes reject a hard delete, and SuggestionStatus has only the two members.
- The kill switch is role=switch with a stable accessible name and aria-checked carrying the state, sitting under the panel heading (decision 16, section 7). Deliberately NOT disabled while saving: optimistic.ts applies patches in order, so two rapid toggles settle on the second, and disabling would take the control away for a round trip in the one case it exists for.
- The submit row's confirmation is a local live region, not a toast. WheelHeader's copy button set that precedent, TASK-20 owns toasts, and the Toaster is not mounted outside the kitchen sink.
- Beyond the ACs, in one line: the submit row is also replaced at PENDING_SUGGESTIONS_MAX. The client counts PENDING rows only, matching assertPendingSuggestionCapacity — counting the whole queue would close the field on a wheel the route would still accept a submission for, and there is a test for that.

AC 3's double-click guard is the caller-side half only: both controls go while the row is pending or optimistic. The projection-level invariant — two outstanding accepts of one suggestion emitting two optimistic options — remains TASK-32, which anticipated this and asked not to be closed by a disabled button.

AC 1 and AC 10 were verified in a browser against the emulator rather than in jsdom, which has no layout and no cascade. The 320px pass found a real defect: the Approve and Reject pair is ~166px of a ~212px row, which left the label ninety and broke 'The bahn mi cart' over four lines. Fixed by wrapping the row — flex-wrap with basis-32 on the label, tuned to fall between the two control widths so a state chip still sits beside the label and the button pair takes the line below. Chrome will not open a window under 500px, so the viewport was forced by constraining the root element; no media query lies between 320 and 500 here (sm is 640), so the mobile layout is the one that was measured.

Also confirmed live, on the seeded wheel: an approve puts the option on the wheel and the row on ADDED in one step and reconciles to a single row with no flicker, and a participant who only listened saw the closed message after the switch was thrown in the other view. The seed fixture was restored afterwards.

Review follow-up (2026-08-09).

Fixed: the submit row's draft and its confirmation are now owned by SuggestionsPanel rather than by SubmitRow, which is unmounted by both the kill switch and the pending cap. Same hoisting AddRow does next door and the same failure — a participant typing when the editor closes suggestions, or when another participant fills the queue, lost what they had written, and on their own submission crossing the cap the 409 rollback would have restored the label into a component that had gone. Covered by a two-case it.each over both ways of unmounting the field.

Filed rather than fixed: TASK-33 — the confirmation is a role=status region mounted together with its own text, which JAWS and NVDA often do not announce. Repo-wide rather than mine: the spin result strip and the notice strip in wheel-page.tsx share the shape, and an always-present region here gives the participant view two role=status elements, which several existing wheel-page tests reach for with a bare getByRole('status') — two of them asserting none is present.

Rejected: a finding that decision 16 puts the kill switch 'in the header row next to the count label'. That phrase is in neither the decisions table nor section 7 nor this file. Decision 16 says 'suggestionsOpen in the Suggestions panel header' and section 7 says 'belongs in the Suggestions panel header, not in a settings menu' — both of which the placement under the heading line satisfies.

Unit suite 829; typecheck, lint, format:check and the production build all clean.
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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the Suggestions panel in both variants, replacing the placeholder in the wheel page. One component driven by the resolved role and taking props rather than the session; controls follow the row's own state, so a pending row in the editor view gets Approve and Reject and everything else gets one of the only two chips there can be. The suggestionsOpen kill switch is a role=switch in the panel header (decision 16), left usable while its own write is outstanding because the optimistic layer settles rapid toggles on the last one. The participant submit row's draft is owned by the panel, since the row is unmounted by both the kill switch and the pending cap.

Verified with 34 component cases and 5 page-level ones — unit suite 829, up from 788 — plus typecheck, lint, format:check and a production build. AC 1 and AC 10 were checked in a browser against the emulator, which jsdom cannot speak to: that pass confirmed an approve puts the option on the wheel and flips the row in one step with no flicker, and found a real 320px defect where the Approve/Reject pair squeezed the label over four lines, now fixed by wrapping the row.

Two findings from review: the lost draft was fixed here, and the live-region announcement was filed as TASK-33 because it is one pattern across three sites and half-fixing it would leave two conventions in one file family. AC 3's double-click guard is the caller-side half only — the projection-level invariant remains TASK-32, which asked not to be closed by a disabled button.
<!-- SECTION:FINAL_SUMMARY:END -->
