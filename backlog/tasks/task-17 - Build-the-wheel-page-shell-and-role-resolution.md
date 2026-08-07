---
id: TASK-17
title: Build the wheel page shell and role resolution
status: To Do
assignee: []
created_date: '2026-08-07 08:38'
updated_date: '2026-08-07 08:52'
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
- [ ] #1 The editor token is read from location.hash on mount and never appears in the path or query
- [ ] #2 A visitor with no fragment renders the participant view, and one with a valid fragment renders the editor view
- [ ] #3 A fragment carrying an invalid token degrades to the participant view with a clear message rather than an error page
- [ ] #4 The header, brand mark, role chip and decorative background circles match the prototype
- [ ] #5 The loading state before the token resolves is brief and does not flash the wrong role
- [ ] #6 No viewer-facing copy implies participants will see a spin, a result or an animation
- [ ] #7 The layout collapses to a single column on narrow viewports with the wheel first, with no horizontal overflow from 320px up
- [ ] #8 The title is click-to-edit for editors, static for participants, and persists via PATCH
- [ ] #9 A header overflow menu exposes Duplicate wheel and is reachable for both roles
<!-- AC:END -->

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
<!-- COMMENTS:END -->
