---
id: TASK-33
title: Announce the live regions that are mounted with their own content
status: To Do
assignee: []
created_date: '2026-08-09 21:28'
labels:
  - accessibility
dependencies: []
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three `role="status"` regions in the wheel page are rendered together with their first content rather than existing empty and later gaining it: the submit confirmation in `suggestions-panel.tsx`, the spin result strip and the notice strip in `wheel-page.tsx`.

JAWS and NVDA frequently do not announce a live region that is inserted into the DOM along with its text, because the region was not being observed at the moment of the mutation. The suggestions one is the site where it costs most: it is the ONLY acknowledgement a participant gets that their suggestion was sent, since the optimistic row lands at the end of a queue that may be off screen. A screen-reader user submits and hears nothing — the field simply empties.

The fix is to render each region unconditionally and toggle only its text.

Worth doing in one pass rather than per-site, because it is one pattern in three places and half-fixing it leaves two conventions in one file family. It also has a cost the individual fix hides: an always-present region in the Suggestions panel means the page has two elements with `role="status"` in the participant view, and several existing tests in `wheel-page.test.tsx` reach for the notice strip with a bare `getByRole('status')` — two of them asserting that NO status role is present. Those need a handle on the notice strip that does not depend on it being the only one.

Found in the TASK-19 review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All three status regions are present in the DOM before they carry text, and change only their content
- [ ] #2 The notice strip is addressable in tests without relying on being the page's only role=status
- [ ] #3 A test covers the submit confirmation announcing, rather than merely appearing
<!-- AC:END -->
