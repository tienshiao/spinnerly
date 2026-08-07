---
id: TASK-22
title: Build the landing page
status: To Do
assignee: []
created_date: '2026-08-07 08:39'
labels: []
dependencies:
  - TASK-3
  - TASK-4
  - TASK-21
documentation:
  - docs/spin-the-wheel-editor/project/Home.dc.html
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Recreate docs/spin-the-wheel-editor/project/Home.dc.html.

Sections, in order: header with brand mark and nav; a hero with an accent-2 tag pill, an h1 at clamp(48px, 6vw, 78px) reading Stop debating. Spin for it., supporting copy, two call-to-action buttons, and an avatar-stack row reading No account needed; a decorative wheel rendered as a conic-gradient circle turning slowly on a 26s linear loop; a three-step How it works grid on an auto-fit minmax(260px, 1fr); a wrapped row of use-case pills; a full-bleed accent-filled call-to-action band; and a footer.

Decorative background: three soft circles, accent-200 top left at 420px, accent-2-200 right at 360px drifting on a 9s ease-in-out loop, and a small #ffc23c circle drifting on a 6s loop.

The hero secondary call to action is See a live one, which in the prototype opens a wheel in guest mode. Decide what it points at in the real app — a seeded demo wheel is the obvious answer but it is a real piece of scope, so settle it rather than leaving a dead link.

Honour prefers-reduced-motion for all three drifting circles and the turning wheel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The page matches the prototype section order, type scale, spacing and color treatment
- [ ] #2 Make a wheel creates a wheel and navigates to the edit URL
- [ ] #3 See a live one resolves to a real destination that is documented
- [ ] #4 The layout holds from 360px to 1920px with no horizontal overflow
- [ ] #5 prefers-reduced-motion stops the drifting circles and the turning wheel
<!-- AC:END -->
