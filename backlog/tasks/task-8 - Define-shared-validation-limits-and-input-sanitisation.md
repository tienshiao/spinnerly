---
id: TASK-8
title: Define shared validation limits and input sanitisation
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
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
- [ ] #1 A single module exports all caps and every write route imports them
- [ ] #2 Labels are trimmed and rejected when empty after trimming
- [ ] #3 Over-length labels are rejected with 400 and a message naming the limit
- [ ] #4 Adding an option to a wheel already at the cap returns 409 with a distinguishable error code
- [ ] #5 Submitting a suggestion to a wheel at the pending cap returns 409 with a distinguishable error code
- [ ] #6 Tests cover the boundary at and one past each cap
<!-- AC:END -->
