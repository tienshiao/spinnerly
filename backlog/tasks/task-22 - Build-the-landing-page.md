---
id: TASK-22
title: Wire the landing page call-to-action buttons
status: To Do
assignee: []
created_date: '2026-08-07 08:39'
updated_date: '2026-08-07 19:31'
labels: []
dependencies:
  - TASK-21
  - TASK-28
documentation:
  - docs/spin-the-wheel-editor/project/Home.dc.html
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Give the two hero buttons on the landing page their real destinations. The page itself is TASK-28.

Split out of the original TASK-22. Everything visual moved to TASK-28, which can be built immediately off the design tokens. What is left here is the part that genuinely needed the backend: the two buttons, which TASK-28 renders unwired.

'Make a wheel' posts to /api/wheels and navigates to /w/{shareId}#e={editToken}, per the create flow in TASK-21. The edit token must reach the URL fragment and nothing else — not a query string en route, not a log line.

'See a live one' opens a wheel in guest mode in the prototype. Decide what it points at in the real app and write the decision down. A seeded demo wheel is the obvious answer, but it is real scope — it needs an owner, a policy on whether participants can mutate it, and something to reset it. The alternatives are pointing it at a wheel created on demand, or dropping the button. Settle it rather than leaving a dead link.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Make a wheel creates a wheel and navigates to the edit URL with the token in the fragment
- [ ] #2 See a live one resolves to a real destination, and the choice is recorded in the design doc
- [ ] #3 The edit token never appears in a query string, a path segment, or a log line in this flow
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 19:19
---
Split: the landing page markup, type scale, motion and responsive behaviour are now TASK-28, which depends only on TASK-3 and TASK-4 and is buildable today. This task keeps only the two hero CTA destinations, which are what actually needed TASK-21 and the create flow behind it.

The 'See a live one' destination is still undecided and is the real open question here — it is closer to a design decision than a wiring detail. If it grows a seeded demo wheel, that is its own task, not this one.
---

author: @claude
created: 2026-08-07 19:31
---
Scope correction from building TASK-28: the page has FOUR inert call-to-action buttons, not the two this task's description names.

In prototype order:
1. Header nav — 'Open a wheel'
2. Hero primary — 'Make a wheel'
3. Hero secondary — 'See a live one'
4. Call-to-action band — 'Make a wheel'

4 is the same action as 2 and needs no extra decision. 1 is the one that was missed: 'Open a wheel' is not 'Make a wheel', and in the prototype it points at the same static Wheel.dc.html as everything else, so the prototype gives no signal about intent. It plausibly means the same thing as 'See a live one', or it is a vestige of a mockup where every link had to go somewhere. Decide whether it creates a wheel, resolves to the same demo destination as 'See a live one', or is dropped from the header.

All four render today as <button type="button"> with no handler, styled through cn(buttonVariants(...)). They are in app/page.tsx and are the only <button> elements on the page, so they are easy to find.
---
<!-- COMMENTS:END -->
