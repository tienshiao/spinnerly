---
id: TASK-3
title: Port the Organic design tokens into the Tailwind theme
status: To Do
assignee: []
created_date: '2026-08-07 08:35'
updated_date: '2026-08-07 08:35'
labels: []
dependencies:
  - TASK-2
documentation:
  - >-
    docs/spin-the-wheel-editor/project/_ds/organic-2961c01a-302a-41de-98ef-dd210a0f5164/styles.css
  - >-
    docs/spin-the-wheel-editor/project/_ds/organic-2961c01a-302a-41de-98ef-dd210a0f5164/readme.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The design bundle ships a design system named Organic at docs/spin-the-wheel-editor/project/_ds/organic-*/. Its styles.css is the source of truth for color, type, spacing, radius and elevation. Every prototype page then overrides the :root palette with the Spinnerly variant, so the shipped palette is the override, not the Organic defaults.

Spinnerly palette (from the per-page :root block in Wheel.dc.html, Home.dc.html and both OG files):
bg #f7f6fb, surface #ffffff, text #26252c, accent #f2545b (coral), accent-2 #3fa7d6 (blue), divider color-mix(in srgb, #26252c 14%, transparent). Each of neutral, accent and accent-2 carries a full 100 to 900 ramp; copy all 27 values verbatim.

Type: Caprasimo 400 for headings, Figtree 400/600/700 for body. Load both through next/font so there is no render-blocking Google Fonts request and so the OG image route can reuse the same font files.

Also carry across: the space scale (4.4 / 8.8 / 13.2 / 17.6 / 26.4 / 35.2px), radius scale (sm 8, md 16, lg 28) with the rounded-frame override that pushes buttons, tags and inputs to 999px, and the three shadow tokens.

The wheel slice palette is separate from the theme ramps and lives with the wheel component: SLICE and INK arrays of ten colors each, defined in the Wheel.dc.html script block. Keep them as a named export, not as theme tokens.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single CSS entry point defines the full token set as Tailwind v4 @theme variables
- [ ] #2 All 27 ramp steps plus bg, surface, text, accent, accent-2 and divider match the prototype hex values exactly
- [ ] #3 Caprasimo and Figtree load via next/font with the weights the prototype uses
- [ ] #4 Headings default to Caprasimo and body text to Figtree with no per-component font declarations
- [ ] #5 The focus-visible ring is a 2px accent outline at 2px offset globally, per the Organic readme interaction states section
<!-- AC:END -->
