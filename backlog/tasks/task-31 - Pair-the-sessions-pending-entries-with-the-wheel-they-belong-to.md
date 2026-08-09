---
id: TASK-31
title: Pair the session's pending entries with the wheel they belong to
status: To Do
assignee: []
created_date: '2026-08-09 20:17'
labels: []
dependencies: []
priority: low
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In `lib/wheels/use-wheel-session.ts` the `reconcile` effect is declared before the `reset` effect, and both run post-commit. On the render where `shareId` changes from A to B, the hook therefore projects wheel A pending entries against wheel B live state, which is empty: A optimistic submit-suggestion rows appear as `view.suggestions` on the new wheel, and A settled remove, patch and reject entries are retired against a snapshot that never contained them.

Masked today only because `app/w/[shareId]/page.tsx` now carries `key={shareId}`, which is precisely the assumption the hook comment says it must not make. `useWheel` and `useSuggestions` avoid this by pairing held state with the id it describes; this hook should do the same rather than depending on effect declaration order.

Found in the TASK-18 review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pending entries from a previous shareId can never be projected against a new one, whatever order the effects run in
- [ ] #2 The hook is correct without page.tsx keying on shareId, and a test swaps shareId in place to prove it
<!-- AC:END -->
