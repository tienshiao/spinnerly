---
id: TASK-13
title: 'Implement POST /api/wheels/[shareId]/duplicate'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:37'
updated_date: '2026-08-08 08:20'
labels: []
dependencies:
  - TASK-9
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Unauthenticated, and deliberately so. Available to anyone holding the share URL, not just editors (design doc section 8). It is the escape hatch when a wheel expires, when the edit token is lost, or when someone wants to fork the list for their own group. Nothing is disclosed that the share URL did not already expose.

Mints a fresh shareId and editToken, copies title and options, and drops suggestions and spins. Fresh createdAt, updatedAt and expiresAt.

Design doc section 11 question 2 asks whether the title is copied verbatim or marked to distinguish the fork; two identically titled wheels in one group chat is a confusing failure mode. TASK-1 should have settled this — follow whatever it decided.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST duplicate succeeds with no Authorization header and returns a new shareId and editToken
- [x] #2 The new wheel copies title and options and has no suggestions and no spins
- [x] #3 The new wheel gets its own independently generated edit token, unrelated to the source wheel token
- [x] #4 The source wheel is left unmodified
- [x] #5 Title handling matches the decision from TASK-1
- [x] #6 The duplicated wheel title is byte-identical to the source title with no suffix or marker
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/store.ts — duplicateWheel(shareId, db?): CreatedWheel, placed next to createWheel because it is the second caller of it and the only one that supplies options.
   - Validate the shareId shape, then read the source wheel. Both failures are the same 404 no_such_wheel, for the reason assertEditor gives: an ID that cannot be a Firestore auto-ID cannot name a wheel that exists.
   - Copy title and options into createWheel, which mints the fresh shareId, editToken, createdAt, updatedAt and expiresAt. The fork is a wheel created from scratch that happens to be seeded, not a copy of a document.
   - The source is NOT written to — no expiry slide. AC 4, and it is also the safe direction: this endpoint takes no credential, so sliding here would let anyone holding a share URL extend any wheel's lifetime indefinitely by polling it. Reading a wheel is not activity.
   - Title copied verbatim per decision 17 — no suffix, no marker, not re-sanitised. Re-running validateTitle would rewrite a title the source is entitled to keep and could fail in front of a forker who cannot edit the input.
   - Option ids are carried across, which is what createWheel's optional id parameter exists for; fromSuggestion is dropped to null, because the provenance points into the SOURCE wheel's suggestions subcollection and the fork does not have it. addedAt is fresh.
   - assertOptionCapacity(0, copied.length) before the write — the bulk case the adding parameter documents itself for. A source cannot exceed OPTIONS_MAX today, but a lowered cap would otherwise fork a wheel straight past it and surface as a 500 from Firestore rather than a 409.
2. app/api/wheels/[shareId]/duplicate/route.ts — POST, unauthenticated per design doc section 8 and decision 16. No assertEditor and no body read: nothing about a fork is expressible in a body, and not reading one keeps the unauthenticated path from buffering bytes it would throw away. Returns 201 { shareId, editToken } with cache-control: no-store, matching POST /api/wheels — this is the second and last endpoint that emits a raw token.
3. Emulator tests only. Every path reaches duplicateWheel, whose db default parameter evaluates getAdminDb() before the body runs, so there is no rejection this route can answer without Firestore — unlike POST /suggestions, which is why that one has a unit file and this one does not.
   Covering: unauthenticated 201 with a well-formed new shareId and token (AC 1); title and options copied and the fork holding no suggestions and no spins, seeded on the source first (AC 2); the fork's hash differing from the source's and the source token being rejected against the fork (AC 3); the source document byte-identical before and after, updatedAt and expiresAt included (AC 4); verbatim titles including one already ending in '(copy)' (AC 5, 6); fromSuggestion cleared and addedAt fresh; 404 on unknown and malformed shareIds; the fork independently editable with its own token.
4. npm test, npm run test:emulator, typecheck, lint, format, build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two files added, one function plus one helper added to the store. Design doc section 6's API table already carried the endpoint and needed no change.

- app/api/wheels/[shareId]/duplicate/route.ts — POST, unauthenticated
- app/api/wheels/[shareId]/duplicate/route.emulator.test.ts — 34 cases
- lib/wheels/store.ts — duplicateWheel, copyableOptions

Unit suite 270 green, emulator 206 (up from 172). Typecheck, lint, format:check clean; production build succeeds and lists the route.

Decisions worth knowing about:

- The fork is a wheel created from scratch and seeded, not a copy of a document. duplicateWheel reads the source and calls createWheel, which mints the shareId, the token, createdAt, updatedAt and expiresAt and writes suggestionsOpen: true. Nothing is copied field-by-field, so a field added to the data model later is written by the one path that already knows how to write it rather than being silently omitted from forks until someone notices.
- suggestionsOpen resets to true even when the source had it closed. The kill switch was the source editor's decision about the source's audience, usually taken because of the source's spam; the fork has a new editor and a URL nobody has pasted anywhere.
- The source is not written to at all — not even the expiry slide every other write in the store applies. AC 4 asks for it, and it is also the security-relevant direction: this is the one path that reaches a wheel with no credential and no cap, so sliding here would let anyone who once saw a share URL keep that wheel alive indefinitely by calling this on a timer, defeating the bounded lifetime of a leaked link that design doc section 8 lists as expiry's first reason for existing. Tested by comparing the whole source document before and after rather than a field at a time.
- A wheel past its expiresAt but not yet reaped forks fine, and there is a test pinning that. Firestore TTL deletes 'typically within 24 hours', so the window where the escape hatch still works on an expired wheel is exactly when someone reaches for it.
- Option ids are carried across, which is what createWheel's optional id parameter was documented as existing for — but only within OPTION_ID_MAX. Copying a longer one verbatim would give the fork an option that assertOptionId refuses to name, so DELETE /options/{id} could never remove it. Out-of-bounds ids get a fresh randomUUID instead.
- fromSuggestion is deliberately not copied and lands as null. It names a document in the SOURCE wheel's suggestions subcollection, which the fork does not have and never will; carrying it would point the fork's provenance at another wheel's queue, which is worse than no provenance.
- assertOptionCapacity(0, options.length) before the write, the bulk case the adding parameter documents itself for. Unreachable today since every path that writes an option checks the cap, and reachable the moment OPTIONS_MAX is lowered — where the alternative is Firestore refusing an oversized document as a 500 rather than a 409 options_full.
- The route reads no body. Nothing about a fork is expressible in one — the path says which wheel and decision 17 settles the title — and leaving it unread keeps this unauthenticated path from buffering bytes it would discard.
- Reading the source is total over data this API cannot produce: a non-string title forks as DEFAULT_TITLE, an option with a non-string label is dropped. The narrowing is there because Firestore hands back unknown, and the direction is deliberate — an escape hatch that refuses to open because one row is malformed fails precisely when it is most needed.
- Emulator tests only, and no unit counterpart despite this being unauthenticated like POST /suggestions. That route parses its body before reading anything, so its rejections are reachable without a database; here the first thing every request does is call duplicateWheel, whose db default parameter evaluates getAdminDb() before the body runs, so even the malformed-shareId 404 needs an emulator.

The title tests are the ones that would catch a well-meaning regression: a source already titled 'Lunch Friday (copy)' forks to exactly that, and emoji, RTL and double-spaced titles all survive byte for byte because the title is not re-run through validateTitle. Re-sanitising would let a later change to those rules rewrite a title the forker never typed and cannot see us edit.

Post-review fixes (/code-review, two low-severity findings, both confirmed and fixed):

- assertOptionCapacity was called as (0, options.length), putting the source's option count in the 'adding' slot. The message interpolates 'current' alone, so a forker hitting the cap after a future OPTIONS_MAX reduction would read 'a wheel holds at most 40 options, and this one has 0' — both numbers wrong, on the only message this endpoint ever shows. Now (options.length, 0), which is the identical predicate at every value including the boundary, with a truthful count. The emulator test asserted only the error code, so nothing caught it; it now asserts the real count is in the message and that 'has 0' is not.
- copyableOptions dropped a non-string label but copied the empty string, contradicting its own docstring. A copied label is deliberately never re-validated, so that function is the only thing between a stored empty label and a blank, unnamed slice on the fork. The guard now covers it, and the test is an it.each over non-string, absent and empty.

Length is deliberately still not checked on a copied label, and the asymmetry against OPTIONS_MAX is the one this codebase already draws: OPTIONS_MAX is a storage boundary, where a document past it breaches Firestore's 1MB limit and the write fails outright, so a lowered cap has to be enforced on the way past. OPTION_LABEL_MAX is a product cap with no storage consequence, so a fork carrying a label a point over a later, lower limit is cosmetically stale rather than broken — and truncating someone's option to fit is the worse answer.

Both fixes were verified by reverting them and confirming the two new assertions fail and nothing else does. Emulator 208 (up from 206), unit 270; typecheck, lint, format:check clean, production build succeeds.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:52
---
Decision 16: the duplicate action surfaces in the header overflow menu on the wheel page (TASK-17), available to both roles. The endpoint itself stays unauthenticated per design doc section 8 — a participant who has lost track of the editor, or who wants to fork the list for their own group, is exactly who this is for.
---

created: 2026-08-07 08:54
---
Decision 17 (design doc section 10): duplicate copies the title VERBATIM. No "(copy)" suffix, no rename prompt, no disambiguation of any kind. The fork is indistinguishable from the original by title alone; the URL is the identifier.

Renaming is a one-field edit away via PATCH (TASK-10) if the forker wants it, and guessing on their behalf gets it wrong for the most common case: a wheel that expired and is simply being resurrected under the same name.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added POST /api/wheels/[shareId]/duplicate — unauthenticated per design doc section 8, forking a wheel into a fresh one with a new shareId, a new edit token and a full 30 days. duplicateWheel reads the source and delegates to createWheel, so the fork is a wheel created from scratch and seeded rather than a copied document: title verbatim per decision 17, options with their ids but with fromSuggestion cleared and a fresh addedAt, suggestions and spins dropped, suggestionsOpen reset to the default. The source is left byte-for-byte unmodified, expiry included, because this is the one path reaching a wheel with no credential and sliding here would let a leaked share URL keep its wheel alive forever. Verified with 34 emulator cases covering all six acceptance criteria plus the traversal 404s, the capacity 409, an already-expired source, a fork of a fork and the raw token staying out of console output; unit 270 and emulator 206 green, typecheck, lint, format:check clean, production build succeeds.
<!-- SECTION:FINAL_SUMMARY:END -->
