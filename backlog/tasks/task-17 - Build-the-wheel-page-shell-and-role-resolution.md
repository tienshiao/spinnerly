---
id: TASK-17
title: Build the wheel page shell and role resolution
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:38'
updated_date: '2026-08-09 04:44'
labels: []
dependencies:
  - TASK-15
  - TASK-9
documentation:
  - docs/spin-the-wheel-design.md
  - docs/spin-the-wheel-editor/project/Wheel.dc.html
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The /w/[shareId] page: header, layout, and the logic that decides whether the visitor is an editor or a participant.

Role comes entirely from the URL, per design doc section 2. There is no identity.
  Edit:  /w/{shareId}#e={editToken}
  Share: /w/{shareId}

The token lives in the fragment because fragments are never sent to servers, so it stays out of Referer headers, access logs, analytics and any error reporter added later. It also means the edit page cannot be server-rendered: it must be a client component that reads location.hash on mount and only then calls the API. Accept the brief loading state.

Do not fix this by moving the token into a route segment such as /w/{id}/edit/{token}. That puts it straight back into the request path and into every server and platform log, which is exactly what the fragment placement avoids.

A free benefit worth preserving: pasting an edit URL into Slack strips the fragment before Slack fetches the page, so the unfurl is an ordinary share preview and the token never reaches Slack servers.

Header, from the prototype: brand mark as a four-color conic gradient circle with a 5px white inset ring, the wheel title in Caprasimo at 24px over the Spinnerly wordmark at 13px in neutral-600, and a role chip — Editor tinted from the accent ramp, Viewer tinted from accent-2. Right side holds the viewer-preview toggle and the copy-link button.

Page background is bg with two large soft blurred circles bleeding off the corners: accent-200 top right at 420px, accent-2-200 bottom left at 380px, both partially transparent and pointer-events none.

Layout is a two-column grid, wheel left and panels right, 34px gap, 34px 40px 60px padding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor token is read from location.hash on mount and never appears in the path or query
- [x] #2 A visitor with no fragment renders the participant view, and one with a valid fragment renders the editor view
- [x] #3 A fragment carrying an invalid token degrades to the participant view with a clear message rather than an error page
- [x] #4 The header, brand mark, role chip and decorative background circles match the prototype
- [x] #5 The loading state before the token resolves is brief and does not flash the wrong role
- [x] #6 No viewer-facing copy implies participants will see a spin, a result or an animation
- [x] #7 The layout collapses to a single column on narrow viewports with the wheel first, with no horizontal overflow from 320px up
- [x] #8 The title is click-to-edit for editors, static for participants, and persists via PATCH
- [x] #9 A header overflow menu exposes Duplicate wheel and is reachable for both roles
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Role resolution is the whole task; the header and layout are a port. Ordered so the thing nobody has built yet lands first.

1. GET /api/wheels/[shareId]/editor — the verification endpoint AC 3 needs. The server never sees the fragment and Firestore rules deny the client any read of wheelSecrets, so nothing on the page can currently tell a real token from a truncated one; the alternatives were validating on the first failed mutation (AC 3 only becomes true after the user has already tried to edit) or a no-op PATCH (a write, so every editor page load would slide expiry and fire a snapshot for every other viewer). Calls assertEditor and nothing else: 204, or the EditorAuthError response verbatim. No body read, no write, so no x-wheel-updated-at — the one editor route that reports no version, because it produces none. runtime = 'nodejs' per the ESLint rule. Design doc section 6 gains the row and a note saying why it is not a mutation.

2. api-client.verifyEditor(shareId, token) -> 'editor' | 'not-editor' | 'unknown'. Tri-state on purpose: ONLY an authoritative 401/403 demotes. A network failure or a 500 returns 'unknown' and the caller keeps the editor view, because otherwise a flaky connection silently strips a legitimate editor's role and the only way back is a reload they have no reason to attempt.

3. lib/wheels/use-edit-token.ts — location.hash on mount, plus hashchange. Returns undefined while unread and null when read-and-absent, and that distinction is AC 5: collapsing them to 'falsy means participant' renders the participant view on the server and for the first client frame, which is the wrong-role flash for every editor.

4. lib/wheels/use-editor-role.ts — the token plus the verification, as one status. Guards a stale response against a changed shareId or token.

5. app/w/[shareId]/page.tsx stays a server component (TASK-23 hangs OG metadata off it) and renders the client shell.

6. app/w/[shareId]/wheel-page.tsx — the shell. Background circles, two-column grid collapsing to one with the wheel first, loading / not-found / error states, and the panel slots TASK-18 and TASK-19 fill. The spin button is editor-only per design doc section 2's role table, and it ships with a minimal inline result strip whose dismiss calls useSpin's dismiss() — without it the wheel stays frozen on its snapshot for the rest of the session and reads as a broken listener. TASK-20 replaces the strip with the modal.

7. app/w/[shareId]/wheel-header.tsx — brand mark, click-to-edit title over the wordmark, role chip, preview toggle, copy link, overflow menu holding Duplicate (decision 16). Copy link copies the SHARE url with no fragment, and the button flips its own label rather than raising a toast, since toasts are TASK-20. Preview is an effective role, not a real one: it hides every editor affordance including the spin button, and the chip says Viewer.

8. components/ui/dropdown-menu.tsx — added from the shadcn registry for the overflow menu (Base UI Menu underneath, so Escape, roving focus and dismissal are not hand-rolled).

9. Tests. Emulator: the new route, including the confused-deputy case — wheel A's token on wheel B is 403. jsdom: the two hooks in isolation, and the page for each role, the invalid-token degrade, the no-flash requirement, preview, title edit and duplicate. api-client gets the verifyEditor cases including the network one that must NOT demote.

10. npm test, npm run test:emulator, typecheck, lint, format, build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered: the verification endpoint AC 3 needed, two hooks that resolve a role from the URL, and the page shell the panel tasks plug into.

- app/api/wheels/[shareId]/editor/route.ts — GET, editor-authenticated, writes nothing. The body is assertEditor and nothing else, so it cannot drift from what the six write routes would say. 12 emulator cases.
- lib/wheels/api-client.ts — verifyEditor, the one read and the one method that answers a refusal instead of throwing it.
- lib/wheels/use-edit-token.ts, use-editor-role.ts — the fragment, and what the server says of it.
- app/w/[shareId]/{page,wheel-page,wheel-header,wheel-title}.tsx — server shell plus the client page, header and inline title editor.
- components/ui/dropdown-menu.tsx from the shadcn registry (Base UI Menu underneath) for the overflow menu; @testing-library/user-event added as a devDependency, since the menu and the title editor need real pointer and keyboard sequences rather than fireEvent.
- app/wheel-palette.ts — conicFromPalette lifted out of app/page.tsx, which now imports it. The brand mark is the second caller and the subtlety in its comment was worth having in one place.
- Docs: design doc section 6 gains the endpoint row and a subsection, section 3 gains what role resolution costs, decision 23. CLAUDE.md gains a 'Resolving a role' section and a corrected module table. README gains the consequence in the roles section.

Unit 737 (42 new), emulator 307 (12 new); typecheck, lint, format:check clean, production build succeeds.

Decisions worth knowing about:

- AC 3 needed a way to tell a good token from a truncated one and there was none. The fragment never reaches a server and section 5's rules deny the client every read of wheelSecrets, so the page has no evidence either way. Both cheaper-looking alternatives are worse: validating on the first mutation means the user composes an edit before learning they were never an editor, and a no-op PATCH is a write, so merely opening an edit link would slide the wheel's 30-day expiry and arrive at every other viewer's listener as an edit nobody made. Agreed with the user before implementation.
- The endpoint carries no x-wheel-updated-at. It produces no version, and a header naming one it did not write is exactly the value optimistic.ts compares a pending entry against. Asserted, alongside a case that reads updatedAt and expiresAt back off the stored document — a route can write and simply neglect to report it, which is the failure a header-absence check would miss.
- Only 401 and 403 demote. A dropped connection, a timeout, a 502 and a 404 are all 'unknown' and keep the editor view. The cautious-looking reading is the harmful one: demoting on a network blip silently strips the role from someone holding a good link and leaves them on a page that looks like an ordinary share view, with no reason to suspect a reload would fix it. Nothing is risked, because every write is still authorised on its own merits. This is why verifyEditor returns a value rather than a boolean — a boolean has to fold 'the server says no' together with 'the server did not answer', and the caller acts on those in opposite directions.
- The token is three-state, not falsy. undefined means 'not read yet' — the server render and the render that hydrates it — and null means 'read, and there is none'. Collapsing them makes 'no token' the answer during the frame nobody has looked yet, so every editor's page is built as a participant's and visibly rebuilt. Tested through react-dom/server, which is the only way to exercise the getServerSnapshot path.
- The page waits for BOTH the role and the first snapshot. They race, so the cost is the slower one rather than the sum, and the alternative is picking a side for a frame and then moving the spin button, the header controls and both panel variants when the answer lands.
- A verdict is keyed on the wheel AND the token, held alongside the request it answers exactly as useWheel holds its state alongside its shareId. A bare verdict state is a race the render loses — the effect that clears it runs after the render that would have used it, so wheel A's 'editor' verdict is briefly applied to wheel B.
- Copy copies the SHARE url and says so on the label. An editor's address bar holds the token, so a button copying 'the current URL' promotes every recipient to an editor. The URL is passed in already stripped rather than read from location in the component, so there is no version of it that could copy the fragment by accident.
- The spin button is editor-only, per design doc section 2's role table and section 6's 'the editor announces the outcome'. It ships with a throwaway result strip because useSpin's dismiss() is not optional — see below.

Two bugs found by running the app rather than by a test, both fixed:

- Entering the viewer preview with a result on screen stranded the wheel. The result strip is editor-only, so previewing removed the only control that calls dismiss(), and the wheel then drew its spun snapshot for the rest of the session — added options silently never appear, and it reads as a broken listener. togglePreview now dismisses first. Pinned by a test that adds a third option while the preview is open and asserts the wheel's aria-label names it.
- The title input opened focused-in-appearance but not focused. select() sets a selection range and does not move focus per spec; browsers mostly focus as a side effect and jsdom does not, so everything typed after a rename click went nowhere. Now focus() then select().

Also caught before it shipped: navigator.clipboard is undefined outside a secure context, and the optional-chained call awaited successfully — the button would say 'Copied' over an untouched clipboard. Tested for explicitly instead.

Verified by mutation rather than only by passing. getServerSnapshot returning null failed the hydration case and nothing else; 'unknown' demoting failed exactly the two cases that argue against it; dropping the shareId from the verdict key failed all three staleness cases; gating the page on the snapshot alone failed the no-flash case; copying location.href failed the fragment case; removing focus() failed both rename cases; rendering the spin button for participants failed three; removing dismiss() from togglePreview failed the thaw case; making the route write failed the 'writes nothing' case; and disabling assertEditor failed all eight refusals.

Run against the emulator with real data, both roles: the editor view renames through PATCH and the new title comes back on the snapshot, the spin lands and the result strip thaws it, the preview toggle hides every editor affordance, Duplicate forks and navigates into the fork's edit URL with the token in the fragment, and a truncated token renders the shared view with the AC 3 notice. AC 7 checked at a 316px viewport in an iframe — a real viewport, so the sm: breakpoints evaluate — with scrollWidth equal to clientWidth in both roles.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:48
---
Decision 13 (design doc section 10): participants do NOT see the spin in v1. The spin exists only in the spinning browser — no rotation, no result, no confetti for anyone else.

The prototype viewer copy "Watching live" is removed. It promises a synchronized experience that only arrives in phase 2, and a participant staring at a still wheel waiting for it to move will reasonably conclude the app is broken. Viewer copy should describe what a participant can actually do: read the list, suggest a spot.

Decision 14: responsive. The two-column grid collapses to one column with the wheel first.
---

created: 2026-08-07 08:52
---
Decision 16 (design doc section 10) adds two header responsibilities to this task:

- The wheel title is click-to-edit inline in the header, editor-only. It calls PATCH /api/wheels/{shareId} (TASK-10). Participants see static text.
- An overflow menu sits next to the copy-link button holding Duplicate wheel. The suggestionsOpen toggle does NOT go here — it belongs in the Suggestions panel (TASK-19).

Header order for an editor, left to right: brand mark, editable title over the Spinnerly wordmark, role chip; then preview toggle, copy link, overflow menu. Participants get the brand mark, static title, role chip, and a duplicate action.

At narrow widths the header wraps rather than overflowing, and the overflow menu is the natural home for anything that does not fit.
---

author: @claude
created: 2026-08-09 04:11
---
Two decisions taken with the user before implementation.

AC 3 needs a way to tell a valid edit token from an invalid one, and there was none. The fragment never reaches the server and section 5's rules deny every client read of wheelSecrets, so the page has no evidence either way. Adding GET /api/wheels/{shareId}/editor is new API surface beyond the section 6 table, which is why it was asked rather than assumed. It reuses assertEditor verbatim, so it inherits the 'is this THIS wheel's token' shape rather than restating it, and it is read-only, so it does not slide expiry the way a no-op PATCH would have. The latency is free in practice: it races the Firestore listener the page is already waiting on.

The spin button ships here with a throwaway result strip. components/wheel/wheel.tsx assigns the button to this task, but useSpin's dismiss() must be called or the wheel holds its frozen snapshot for the rest of the session — added options stop appearing and it reads as a broken listener. The strip is the minimum that keeps that contract until TASK-20's modal replaces it.
---

author: @claude
created: 2026-08-09 04:43
---
Panels are placeholders, deliberately. app/w/[shareId]/wheel-page.tsx renders a PanelSlot for each of TASK-18 and TASK-19, showing the live option and suggestion counts rather than a fixed-height grey box, so the column is being exercised against real data. Both tasks replace theirs outright.

The spin result strip is TASK-20's. It exists here only because useSpin freezes the wheel from spin start until dismiss() runs, so a spin button shipped without any caller of it leaves the wheel drawing a stale option list with no error anywhere. When the winner modal replaces the strip, keep the dismiss() call in togglePreview too — the modal is editor-only for the same reason the strip is, and previewing mid-result is how the freeze gets stranded.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The /w/{shareId} page: header, layout and the role resolution the whole page hangs off.

Role comes from the URL fragment (design doc section 2) and nothing else, which left AC 3 without a mechanism — the server never sees the fragment and section 5's rules deny the client every read of wheelSecrets, so a truncated edit link was indistinguishable from a real one. Added GET /api/wheels/{shareId}/editor, the one editor route that writes nothing: its body is assertEditor, so it cannot disagree with the six routes that do. Only 401 and 403 demote; a failure to answer keeps the editor view, because a dropped connection is evidence about the network and none about the token. Design doc decision 23.

The page waits for the role and the wheel's first snapshot together — they race, so the cost is the slower one — and renders no role until both are in, which is what keeps an editor's page from being built as a participant's and rebuilt a moment later. Header carries the brand mark, the click-to-edit title over the wordmark, the role chip, a viewer-preview toggle, a copy button that copies the SHARE url, and an overflow menu holding Duplicate for both roles. The spin button is editor-only and ships with the throwaway result strip TASK-20 replaces, because useSpin's dismiss() has to have a caller or the wheel silently freezes.

Verified: unit 737 (42 new), emulator 307 (12 new), typecheck, lint, format:check clean, production build succeeds. Every new assertion checked by mutation. Driven against the emulator in both roles — rename persists through PATCH, the spin lands and thaws, Duplicate forks into the new wheel's edit URL, and a truncated token renders the shared view with the notice. AC 7 measured at a 316px viewport, scrollWidth equal to clientWidth. Two bugs the tests did not have and running the app did: previewing with a result on screen stranded the frozen wheel, and the title input opened unfocused.
<!-- SECTION:FINAL_SUMMARY:END -->
