---
id: TASK-30
title: Suppress the duplicate option row when a snapshot beats its own POST response
status: To Do
assignee: []
created_date: '2026-08-09 20:17'
labels: []
dependencies: []
priority: medium
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An add-option entry stays outstanding until its HTTP response settles it (`hasLanded` returns false while `settled === null`), and `project` appends its optimistic row unconditionally. The dedupe filter in `project` keys on `fromSuggestion`, so it applies to accepts only.

So if the Firestore snapshot carrying the new option arrives before the POST response, the wheel and the Options panel each draw two identical rows until the response lands. That is a real ordering: the response travels back through the route handler while the listener push goes Firestore to browser, and both leave at commit time. Reproduced during the TASK-18 review: `project` returned `['Pizza(o3)', 'Pizza(local:1)']`.

Self-healing and typically brief, but it is the duplicate AC 4 and the accept filter's own comment say this module exists to prevent.

Unlike the accept case it cannot be closed by identity, because the server mints the option id and the client does not learn it until the response. The options are a label-based suppression (which mis-fires on a wheel holding two options with the same label) or an explicit written-down tradeoff in `optimistic.ts`. Decide which, and if it is the tradeoff, say so where the next reader will look.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An optimistic add-option row is not drawn alongside the real option when the snapshot arrives before the POST response
- [ ] #2 The chosen approach is stated in optimistic.ts, including what it costs on a wheel with duplicate labels
- [ ] #3 A unit test in optimistic.test.ts delivers the snapshot before the settle and asserts a single row
<!-- AC:END -->
