---
id: TASK-21
title: Build the create-wheel flow and the share and preview controls
status: To Do
assignee: []
created_date: '2026-08-07 08:39'
updated_date: '2026-08-07 08:52'
labels: []
dependencies:
  - TASK-17
  - TASK-9
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
How a wheel comes into existence and how it gets shared.

Create: the landing page call to action posts to /api/wheels and redirects to /w/{shareId}#e={editToken}. Creating a wheel is one click with no account, per the design principles. The edit token must reach the URL fragment and nothing else — do not stash it in a query string en route, and do not log it.

The token is a bearer capability and the edit URL is transferable by design (decision 1). The creator may hand it to a co-organiser and both edit at once. Because there is no account and no recovery path, losing the edit URL means losing edit rights permanently — the UI should make it obvious that this link is the only key, and the duplicate flow is the documented mitigation.

Share: a Copy viewer link button that copies /w/{shareId} with the fragment stripped, and confirms via toast. The prototype copy is Viewer link copied — they can look and suggest, not edit, which is worth keeping because it explains the permission model in one line.

Preview: a toggle that lets an editor see the participant view without opening another browser. Prototype labels are Preview viewer link and Back to editing. This is local UI state, not a role change; the token stays in the fragment throughout.

Duplicate: surface the duplicate action, which is open to anyone with the share URL, not just editors.

Include a clipboard fallback for browsers or contexts where navigator.clipboard is unavailable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The landing call to action creates a wheel and lands the user on the edit URL with the token in the fragment
- [ ] #2 The edit token never appears in a query string, a path segment, or a log line at any point in the flow
- [ ] #3 Copy viewer link copies the share URL with the fragment stripped and confirms via toast
- [ ] #4 Clipboard copy has a working fallback when navigator.clipboard is unavailable
- [ ] #5 The viewer preview toggle switches the rendered view without discarding the token
- [ ] #6 The UI communicates that the edit link is the only key and cannot be recovered
- [ ] #7 The duplicate action is reachable by a participant, not only an editor
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:52
---
Decision 16: the header controls this task builds now include an overflow menu alongside the copy-link and preview-toggle buttons. It holds Duplicate wheel (TASK-13). The suggestionsOpen toggle is NOT here; it lives in the Suggestions panel.
---
<!-- COMMENTS:END -->
