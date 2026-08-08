---
id: TASK-8
title: Define shared validation limits and input sanitisation
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:36'
updated_date: '2026-08-08 04:45'
labels: []
dependencies:
  - TASK-7
documentation:
  - docs/spin-the-wheel-design.md
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One module of caps and validators shared by every write route, so the numbers live in one place and cannot drift between endpoints. From design doc sections 4 and 7.

Caps:
- 60 characters per option label
- 60 characters per suggestion label
- roughly 50 options per wheel
- roughly 200 pending suggestions per wheel

These caps are load-bearing, not cosmetic. With rate limiting deferred out of v1, per-wheel caps are what bounds the damage from a single scraped share URL.

Also: trim and normalise whitespace, reject empty labels after trimming, reject control characters, and cap the title length. Every rejection returns a structured error the client can display, not a bare 500.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A single module exports all caps and every write route imports them
- [x] #2 Labels are trimmed and rejected when empty after trimming
- [x] #3 Over-length labels are rejected with 400 and a message naming the limit
- [x] #4 Adding an option to a wheel already at the cap returns 409 with a distinguishable error code
- [x] #5 Submitting a suggestion to a wheel at the pending cap returns 409 with a distinguishable error code
- [x] #6 Tests cover the boundary at and one past each cap
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/validation.ts — the single source of caps and validators. Pure computation over strings, no Firestore and no server-only, so it unit-tests without an emulator (same split as tokens.ts vs store.ts).
2. Caps: option label 60, suggestion label 60, title 80, options per wheel 50, pending suggestions per wheel 200. Exported as named consts plus a LIMITS object for messages.
3. Normalisation: NFC, trim, collapse internal whitespace runs to a single space, reject control characters. Length is counted in CODE POINTS after NFC, not UTF-16 units and not graphemes — see the comment in the module for why each alternative is wrong.
4. ValidationError mirrors EditorAuthError: carries status + code, thrown rather than returned, with toResponse() producing the structured body the client displays. 400 for bad input, 409 for a cap that is already full.
5. Validators: validateOptionLabel, validateSuggestionLabel, validateTitle (optional -> DEFAULT_TITLE), assertOptionCapacity, assertPendingSuggestionCapacity.
6. lib/wheels/validation.test.ts — it.each tables covering at-cap and one-past-cap for every cap, plus normalisation and control-character rejection.
7. npm test, npm run typecheck, npm run lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added lib/wheels/validation.ts and lib/wheels/validation.test.ts (60 new unit cases; suite is 167 green).

Decisions worth knowing about:

- Length is counted in Unicode CODE POINTS after NFC. UTF-16 units (`value.length`) would silently halve the cap for anyone using emoji and disagree with the client's own counter. Grapheme clusters are what a user means by 'character' but are unbounded — a cluster takes arbitrarily many combining marks, so 60 graphemes can be megabytes, and 50 of those in one document walks into Firestore's 1MB limit where the failure is a rejected write surfacing as a 500 rather than a clean 400. Code points cap a full wheel's labels at roughly 12KB.
- NFC runs BEFORE the length check. A Mac-typed 'é' arrives decomposed and would otherwise count double.
- Control characters are rejected via \p{Cc} plus \p{Bidi_Control}. The bidi family is not a control code but reorders rendered text, so a label can display as something other than what was stored — worth rejecting given every label here is attacker-supplied text shown to strangers.
- Whitespace is normalised rather than rejected (pasting from a spreadsheet is the common case). U+200B is collapsed with it because it is the one invisible character a label can be made entirely of; ZWJ and ZWNJ are deliberately left alone because they are load-bearing in emoji sequences and in Persian/Indic orthography.
- ValidationError mirrors EditorAuthError: thrown rather than returned, carries status + code, has toResponse(). Same reasoning — forgetting to catch yields a 500 and no write, rather than an unvalidated write.
- Two numbers the design doc does not give: TITLE_MAX = 80 (sits above the label cap; a title has a full line in the OG unfurl, a label has to fit a wheel segment) and DEFAULT_TITLE = 'Untitled wheel'.
- validateTitle treats undefined/null as 'not supplied' (defaults) but rejects an empty or whitespace-only string, so PATCH cannot blank a wheel's heading.

AC 1, 4 and 5 are written as end-to-end route behaviour and cannot be closed here: no write route exists yet beyond the 501 stub. The mechanism each needs is in place — assertOptionCapacity throws 409/options_full, assertPendingSuggestionCapacity throws 409/suggestions_full — and the routes that call them are TASK-9, TASK-11 and TASK-12.

Post-review revisions (/code-review found five issues, all confirmed and all fixed):

1. An all-invisible label passed validation. My ZWSP handling had a comment claiming U+200B was 'the one invisible character a label can be made entirely of' — false. U+2060 word joiner, U+00AD soft hyphen, the Hangul fillers (U+115F/U+1160/U+3164/U+FFA0, category Lo, so no property escape excludes them), ZWNJ and ZWJ all survived cleaning and were matched by neither \s, \p{Cc} nor \p{Bidi_Control}. A suggestion of three word joiners stored as a 3-character label and rendered as a blank wheel segment — exactly what the ZWSP handling existed to prevent, so AC 2 was not actually met. Replaced the length-based emptiness test with a VISIBLE_CHARACTER rule: a label must contain at least one character that is not whitespace, not \p{Cf} and not a Hangul filler. Defined by exclusion because \p{Cf} grows with each Unicode revision, so an allowlist would be wrong again at the next one. Deliberately does NOT strip invisibles from an otherwise visible label: ZWJ holds multi-person emoji together, ZWNJ is required in Persian and Indic scripts, and the tag characters encode the England and Scotland flags. Tested, including the England flag surviving intact.

2. validateTitle(undefined) returning DEFAULT_TITLE was a data-loss bug waiting for TASK-10. PATCH /wheels/{shareId} updates title AND suggestionsOpen, so it routinely receives a body with no title — an editor hitting the kill switch on a brigaded wheel sends { suggestionsOpen: false } and nothing else, and would have silently renamed their wheel to 'Untitled wheel'. Same loss the function already rejected an empty string to prevent, reintroduced via the absent-field path. Split: validateTitle requires a title, validateNewWheelTitle defaults when absent and is for creation only.

3. normalise ran normalize('NFC') plus two full-string replaces on an unbounded value from the request body before any length check. Next.js caps Server Action payloads, not route-handler request.json(), so a 50MB label allocated several copies per request. Added a cheap pre-check on raw UTF-16 length. First cut used 8x the cap and my own test caught it rejecting 60 emoji with 200 spaces of padding — a paste, not an attack — so the factor is 64 and its comment records why it is deliberately nowhere near the real cap.

4. assertOptionCapacity only answered 'may I add exactly one more'. POST /wheels seeds an initial list and POST /wheels/{shareId}/duplicate copies a whole array, so both would have passed a check against a count of zero and written past OPTIONS_MAX — failing as a Firestore oversized-document 500 rather than the clean 409 this module exists to give. Now takes an 'adding' count, defaulting to 1.

5. The module header promised the client could render a counter that agrees with the server, but countCharacters was private, so a client built from the exported cap alone would have used value.length — the UTF-16 measure the module argues at length is wrong. Exported it.

Also folded the growing positional parameter list into a TextField descriptor, which fixed a real inconsistency: the new size guard had been reporting a bare 'too_long' rather than the field's own label_too_long/title_too_long code.

Suite is 200 green (up from 167); typecheck, lint and format:check clean.

Closed by TASK-12, which supplied the last route the three open criteria were waiting on.

- AC 1 — all seven route files under app/api import from lib/wheels/validation.ts, and no route restates a limit: a grep for the cap values across app/api/**/route.ts finds nothing but HTTP status codes.
- AC 4 — POST /wheels/{shareId}/options answers 409 options_full at the cap, checked inside the transaction that writes. Covered in app/api/wheels/[shareId]/options/route.emulator.test.ts at the cap, one past it, and with two adds racing for the last free slot. POST /suggestions/{id}/accept reaches the same assertion by a second path and answers the same code, with the suggestion left pending.
- AC 5 — POST /wheels/{shareId}/suggestions answers 409 suggestions_full at PENDING_SUGGESTIONS_MAX, counting pending rows only, so a wheel that has been curated properly keeps taking suggestions.

Both bulk-form callers of assertOptionCapacity(current, adding) now exist as intended — POST /wheels seeds an initial list and TASK-13's duplicate will copy an array — and validateSuggestionLabel has its caller. The reason it shares OPTION_LABEL_MAX turned out to matter in TASK-12: acceptSuggestion deliberately does not re-validate the stored label, because a rejection there would land in front of an editor who cannot fix an input that is neither theirs nor mutable.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-08 00:22
---
Staying In Progress deliberately, not because work remains here.

The module is complete, tested and merged-ready — 200 unit tests green, typecheck/lint/format clean. What is outstanding is verification that can only happen elsewhere:

- AC 1 (every write route imports the caps) — no write route exists yet beyond the 501 stub in app/api/wheels/route.ts.
- AC 4 (option cap returns 409 with a distinguishable code) — needs TASK-11's POST /wheels/{shareId}/options. The mechanism is assertOptionCapacity, which throws 409/options_full.
- AC 5 (suggestion cap returns 409 with a distinguishable code) — needs TASK-12's POST /wheels/{shareId}/suggestions. The mechanism is assertPendingSuggestionCapacity, which throws 409/suggestions_full.

Close these as TASK-9, TASK-11 and TASK-12 land and each route is confirmed to import from lib/wheels/validation.ts rather than restating a limit locally. TASK-9 additionally exercises validateNewWheelTitle and the bulk form of assertOptionCapacity(current, adding), both of which exist for it and have no caller yet.

Note for whoever picks those up: assertOptionCapacity's 'adding' parameter is the one to reach for in POST /wheels and in duplicate. Checking capacity one option at a time against a count of zero passes and then writes past the cap.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
lib/wheels/validation.ts is the single source of every input cap and validator, imported by all seven write routes and by nothing that restates a limit. Counts characters in Unicode code points after NFC — not UTF-16 units, which halve the cap for emoji, and not grapheme clusters, which are unbounded — normalises whitespace rather than rejecting it, and requires one visible character so a label of word joiners or Hangul fillers cannot render as a blank wheel segment. ValidationError carries the status and code clients branch on and is thrown rather than returned, so forgetting to catch it yields a 500 and no write. Verified by the module's own it.each tables at and one past every cap, and end-to-end by the route suites: 409 options_full at OPTIONS_MAX from both the add and the accept path, 409 suggestions_full at PENDING_SUGGESTIONS_MAX on submit.
<!-- SECTION:FINAL_SUMMARY:END -->
