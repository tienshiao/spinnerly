---
id: TASK-18
title: Build the Options panel in editor and participant variants
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:38'
updated_date: '2026-08-09 20:32'
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

Participant variant: the same options as a read-only vertical list of pills, dot plus label, no inputs and no remove buttons. Same stack and same left edge as the editor variant — the list is read rather than operated, and a column scans more easily than a ragged wrapping row.

Panel chrome: 24px padding, radius-lg, white surface, divider border, shadow-sm. Header row is Options at 26px baseline-aligned against a count label reading N on the wheel in 13px neutral-600.

Two behaviours depend on TASK-1 and must not be guessed at: whether option labels are editable in place (the prototype has an input per row, the API as specified has only add and remove), and whether the Picked chip is local-only or persisted. Do not build either until TASK-1 lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor variant matches the prototype row layout, colors, spacing and controls
- [x] #2 The participant variant renders read-only pills with no editing affordances
- [x] #3 Option dot colors correspond one to one with the wheel slice colors for the same index
- [x] #4 Adding an option appears optimistically and reconciles with the arriving snapshot without duplicating
- [x] #5 Removing an option updates the wheel immediately
- [x] #6 The count label is accurate and the empty state reads sensibly at zero options
- [x] #7 Label editing and the Picked chip are implemented per the decisions recorded in TASK-1
- [x] #8 Option labels render as static text with no in-place editing affordance
- [x] #9 Both variants are usable at 320px width, with the participant variant designed mobile-first
- [x] #10 The Picked badge is local client state only, is never persisted, and is absent from the participant variant
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `app/w/[shareId]/options-panel.tsx` — one component, both variants, keyed off the `role` the page already derives (so an editor in the participant preview gets the participant list, controls and Picked badge included). Props are data and callbacks, no session and no `shareId`: `options: ProjectedOption[]`, `role`, `picked: ReadonlySet<string>`, `onAdd`, `onRemove`, `onError`. That is what makes every case below testable by rendering the panel alone rather than driving a wheel through Firestore.

   Chrome stays local to this file rather than being extracted into a shared `Panel`. The Suggestions panel next door differs in fill, border, shadow, header size and count colour — four of the five properties — so the shared thing would be a box with a `tone` prop and nothing else. TASK-19 can extract one if the second panel actually turns out to match.

   - Editor rows: pill, `bg-neutral-200`, divider hairline; a 16px `aria-hidden` dot; the label as **static text** (decision 10 — no input per row, which is AC 8 and the one place the prototype is actively wrong); the Picked badge; a circular remove button carrying `aria-label={`Remove ${label}`}` rather than the prototype's `title`.
   - Participant rows: a wrapped list of read-only pills, 14px dot plus label, no buttons and no badge. Written first and given the plain flex-wrap so it degrades to one column at 320px (decision 14, AC 9).
   - Optimistic state comes off the projection and is not recomputed: `pending` dims the row and sets `aria-busy`, `optimistic` disables the remove button — `isOptimisticId` says why, a `local:` id is not addressable by `DELETE /options/{id}` — and `slow` adds a quiet "Saving…". The handler re-checks `option.optimistic` so the guard is a fact about the row rather than about the button being rendered.
   - Add row: a `<form>`, not the prototype's `onKeyDown`. Enter submits for free, and a mobile keyboard shows Go rather than a newline key. Pill input plus a secondary Add button.

2. The three ways an add is refused, each in the layer that owns it.
   - Empty after `trim()` — no request, no message. It is a stray Enter.
   - Over `OPTION_LABEL_MAX` — refused locally with the inline `aria-invalid` treatment `wheel-title.tsx` already uses, measured with `countCharacters`, never `value.length`. `lib/wheels/validation.ts` exists to argue that point: 40 emoji read 80 as UTF-16 units, so a counter built on `.length` blocks labels the server would have taken.
   - At `OPTIONS_MAX` — the add row is replaced by the full message. The server's `options_full` 409 is still the authority (two editors can both see 49); this only stops a click that is already known to fail.

   The draft clears on submit so the next option can be typed straight away, and is **restored on failure** — but only if the field is still empty, so a restore cannot clobber what the editor typed while the request was in flight. Losing the text is the worse half of an add that failed.

3. The Picked badge, which is where the interesting decision is. Decision 15 makes it local-only, so the state has to live somewhere in the client, and the only code that knows a spin landed is `useSpin`. So `components/wheel/use-spin.ts` gains `picked: ReadonlySet<string>`, added to at settle time next to `setResult` — a state update inside a timer, not state derived from state in an effect, which `react-hooks/set-state-in-effect` would refuse and which would be a render behind anyway.

   Keyed by option id, and the one case that costs: spinning onto an option whose optimistic row has not yet reconciled records a `local:` id, so the badge is lost when the real id arrives. It is a two-hundred-millisecond window on the editor's own just-added option, and the alternative — keying by label — badges both rows when a wheel holds a duplicate label, which is a permanent wrong answer instead of a transient missing one.

4. `app/w/[shareId]/page.tsx` gains `key={shareId}` on `<WheelPage>`, and this is a bug fix rather than tidiness. `duplicateWheel` **preserves option ids** (`copyableOptions` in `lib/wheels/store.ts` copies the id when it is usable), and the fork navigates with `router.push` inside the same route segment, so the component is not remounted. Without the key, every option picked on the source wheel arrives at the fork already badged. The key resets `picked`, and with it the rotation, the notice and the preview toggle, all of which are equally facts about the wheel that was left behind. `useWheelSession`'s own `reset` effect stays as it is — it is what the tests that swap `shareId` in place rely on.

5. `app/w/[shareId]/wheel-page.tsx` — delete `PanelSlot` for Options and render the real panel, passing `session.view.wheel.options`, `session.addOption`, `session.removeOption`, `spin.picked` and the existing `onError`. Leave the Suggestions slot for TASK-19.

   **The panel lists live options, not `spin.options`.** The freeze is about the picture (decision 2): handing the panel the frozen snapshot would make an editor's own add invisible for the 4.4 seconds of a rotation, and its optimistic row would appear only after the result was dismissed, which reads as a broken write. The cost is that a removal during a spin shifts the panel's dot colours while the wheel keeps the frozen ones, so AC 3's one-to-one holds outside the spin window and not inside it. Worth a comment on the prop.

6. Tests, all jsdom, `@testing-library/react`, split by what each AC is actually a claim about.

   `app/w/[shareId]/options-panel.test.tsx`, rendering the panel directly:
   - The editor variant has exactly one textbox — the add field — which is AC 8 stated as a count rather than as an absence, so a per-row input reintroduced later fails it.
   - Participant: labels present, no textbox, no buttons, and no badge even when `picked` names one of the rows (AC 2, AC 10).
   - AC 3 renders `<Wheel>` and the panel from the same options in one test and compares the wedge fills against the dot backgrounds pairwise. Asserting both against `sliceColors(i)` would pass just as happily if only one of them stopped using it.
   - Add: Enter and the button both call `onAdd` with the trimmed label; the draft clears; a rejected promise restores it and calls `onError`.
   - Refusals: over-length shows the message and never calls `onAdd`; at `OPTIONS_MAX` there is no add field.
   - Rows: `optimistic` disables remove, `pending` sets `aria-busy`, remove calls `onRemove` with the id.
   - Count label and the zero state (AC 6), including that it reads differently for the two roles — an editor is told to add the first one, a participant that the organiser has not yet.

   `app/w/[shareId]/wheel-page.test.tsx` gains AC 4 and AC 5 end to end, using the Firestore driver already in the file: add an option, assert the row is on screen **before** any snapshot; deliver the snapshot carrying the server id and assert there is exactly one row with that label, which is the no-duplicate claim; remove and assert the row goes immediately.

   `components/wheel/use-spin.test.ts` gains: settling records the landed id; a second spin accumulates; `dismiss` does not clear it.

   AC 9 has no automated check. jsdom does not lay out, so a viewport assertion would be theatre. It is verified in the browser at 320px, and defended in the code by the participant list being flex-wrap with `min-w-0` on the labels and no fixed widths anywhere in the panel.

7. `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`, `npm run build`. The emulator suite is untouched by this task; run it once at the end anyway.

Not in scope, and stated so the reviewer does not look for it: the Suggestions panel (TASK-19), the winner modal that will replace the result strip and own `dismiss` (TASK-20), and the "add one more to spin" hint for a wheel holding a single option — that belongs beside the disabled spin button in the left column, not here.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered: the Options panel in both variants, the Picked badge as spin-local state, and a `key` on the page that stops a fork inheriting it.

- `app/w/[shareId]/options-panel.tsx` — one component, both variants, driven by the role the page has already resolved, so the participant preview loses the add field, the remove buttons and the badge together. Props are data and callbacks, which is what lets the suite reach an optimistic row, a slow one or a full wheel with an object literal instead of a listener and a round trip. Labels are static text (decision 10); the prototype's per-row input is gone. Chrome is deliberately not shared with the Suggestions panel — it differs in fill, border, shadow, header size and count colour, so the common ancestor would be a box with a `tone` prop.
- Three refusals, each in the layer that owns it: an empty draft sends nothing, an over-length one is refused locally against `countCharacters` (never `.length` — the emoji point `lib/wheels/validation.ts` exists to make), and a wheel at `OPTIONS_MAX` loses the field entirely. The server's `options_full` 409 is still the authority. The draft clears on submit and is restored on failure, but only into a field the editor has left alone — they type the next option while the last is in flight.
- `components/wheel/use-spin.ts` — `picked: ReadonlySet<string>`, recorded at settle from the same snapshot and index as the result, so the badge and the announcement cannot name different options. State in a timer rather than derived from `result` in an effect, which would be a render behind and refused by `react-hooks/set-state-in-effect`. Returns the identical set on a repeat landing.
- `app/w/[shareId]/page.tsx` — `key={shareId}` on `<WheelPage>`, which is a bug fix rather than tidiness. `copyableOptions` preserves option ids through a duplicate and the fork navigates inside the same route segment, so without it every option picked on the source wheel arrives at the copy already badged. The rotation, the notice and the preview toggle were carrying over too.

The panel is handed live options rather than `useSpin`'s frozen snapshot: the freeze is about the picture, and freezing the list as well would make an editor's own add invisible for the 4.4 seconds of a rotation. Stated on the prop, along with what it costs — a removal mid-spin shifts the dot colours here while the wheel keeps the ones it froze, so AC 3's one-to-one holds outside the spin window.

Tests: 22 new cases in `options-panel.test.tsx`, 5 in `use-spin.test.ts`, 3 end-to-end in `wheel-page.test.tsx` (the optimistic row before any snapshot, the single row after it, the immediate remove, and a rolled-back add). AC 3 renders the wheel and the panel together and compares wedge fills to dot backgrounds pairwise — asserting each against `sliceColors` separately would pass if only one of them stopped consulting it. Unit suite 773 (up from 743); typecheck, lint, format:check clean; production build succeeds.

AC 9 has no automated case, because jsdom does not lay out. Verified in the browser instead, against the seeded wheel in a 316px viewport: no horizontal overflow in either variant, the editor rows and the add row fit, and a 60-character label wraps inside its pill rather than being clipped. The add, the remove, the reconcile and the badge were all exercised there too.

The emulator suite is untouched by this task and was not run: the port was held by a Firestore emulator already running outside this work, and the rules suite clears the database it would have shared.
<!-- SECTION:NOTES:END -->

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

created: 2026-08-09 18:16
---
The participant variant is now a vertical stack, not the prototype's wrapping row of pills — the editor row geometry minus the controls (same 16px dot, same gap, same left edge, the remove button's width given back as right padding).

Why: the shared view is read, not operated, and a column puts every label at one left edge instead of making the eye hunt along a row whose rhythm changes with each label length. It also means the preview toggle no longer relayouts the panel. At 320px the wrapping version had already collapsed to one column, so this makes that the layout everywhere rather than an accident of narrowness.

AC 2 is unchanged and still holds — read-only pills, no editing affordances. Only the axis changed. Implementation plan step 1 and the notes describe the wrapping version; this comment supersedes them.
---

created: 2026-08-09 20:18
---
Three review findings fixed in this task; three filed as TASK-30, TASK-31 and TASK-32.

1. The add field draft is now owned by `OptionsPanel`, not by `AddRow`. `AddRow` is unmounted at the cap, so on a wheel at 49 the editor's own optimistic row took the count to 50, took the field away, and the `options_full` rollback then restored the label into an unmounted component — losing the text in the one refusal where retrying is not possible.

2. Both editors now count and send `toStoredForm(draft)`, a new export from `lib/wheels/validation.ts` that applies the same NFC normalisation and whitespace collapse `validateText` applies before it counts. Counting the raw draft refused a 60-character label holding a decomposed `é` — what a Mac produces — and an internal double space, both of which the server would have taken. Sending the stored form also stops an optimistic row showing a label the snapshot quietly rewrites.

3. `wheel-title.tsx`'s focus effect depends on `editable` as well as `editing`. The input unmounts when an editor opens the viewer preview mid-rename while `editing` stays true, so the field came back neither focused nor selected — the remount the effect's own argument applies to.

15 new cases, and each was run against the pre-fix source first: all six of the component cases fail without their fix. `app/w/[shareId]/wheel-title.test.tsx` is new — what the title does through the page stays in wheel-page.test.tsx. Unit suite 788; typecheck, lint, format:check and the production build are clean.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the Options panel in both variants, made the Picked badge spin-local state, and stopped a fork inheriting it.

One component keyed off the role the page already resolved, so the participant preview loses the add field, the remove buttons and the badge together. Labels are static text (decision 10) and the Picked badge is client-only (decision 15) — the two places the prototype is actively wrong. The participant variant is a vertical stack rather than the prototype's wrapping pill row: the shared view is read rather than operated, and a column scans better than a ragged row. `useSpin` gained `picked`, recorded at settle from the same snapshot and index as the result; `page.tsx` gained `key={shareId}`, without which a duplicate — which preserves option ids — arrived already badged.

A review of the working tree found three defects, all fixed here: the add draft was lost when the optimistic row took the wheel to its cap and unmounted the field, so it now lives in the panel; both text editors counted the raw draft where the server counts after NFC and whitespace collapse, so `lib/wheels/validation.ts` gained `toStoredForm` and both use it to count and to send; and the title's focus effect missed the remount out of the viewer preview. Three further findings are filed as TASK-30, TASK-31 and TASK-32.

Verified: the unit suite is 788, up from 743 before this task, and each of the six regression cases was run against the pre-fix source to confirm it fails without its fix. Typecheck, lint, format:check and the production build are clean. AC 9 was verified in a 316px browser viewport, jsdom having no layout. The emulator suite is untouched by this task and was not run.
<!-- SECTION:FINAL_SUMMARY:END -->
