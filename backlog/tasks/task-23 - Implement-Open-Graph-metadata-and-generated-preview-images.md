---
id: TASK-23
title: Implement Open Graph metadata and generated preview images
status: To Do
assignee: []
created_date: '2026-08-07 08:39'
updated_date: '2026-08-07 08:54'
labels: []
dependencies:
  - TASK-2
  - TASK-9
documentation:
  - docs/spin-the-wheel-editor/project/OG Image.dc.html
  - docs/spin-the-wheel-editor/project/OG Image - Shared Wheel.dc.html
priority: high
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The main reason the project uses a framework at all (design doc section 3). Sharing is the product, and Slack, Discord, iMessage and Twitter crawlers do not execute JavaScript — a client-rendered SPA would show one identical generic preview for every wheel ever created.

Two routes:
  app/w/[shareId]/page.tsx            generateMetadata for title and description
  app/w/[shareId]/opengraph-image.tsx ImageResponse, rendered per wheel

Plus a static site-level OG image for the landing page.

next/og renders JSX to PNG through Satori, which supports flexbox only — no grid, no float — needs fonts fetched and passed explicitly, and covers only a subset of CSS. The two prototype OG files both use CSS grid for their outer layout and must be rewritten as nested flex boxes. The wheel graphic in both is a conic-gradient, which Satori does not support; render it as arc paths in raw SVG instead. The app React wheel component will not render here, so expect a second, simpler implementation.

Unfurl caching is the real design constraint. Slack and Twitter cache OG images aggressively and will not re-fetch when the wheel changes. The share URL is the cache key and it is the thing people paste, so cache-busting is not available. Design the image to be robust to staleness — title, option count, decorative wheel — rather than an exact render of the current option list. Design doc section 11 question 1 leans this way; TASK-1 should have confirmed it.

Prototype references: OG Image.dc.html is the marketing card (1200x630, headline left, wheel right). OG Image - Shared Wheel.dc.html is the per-wheel card (wheel left, title plus option pills plus a N options on the wheel line right).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 generateMetadata emits a per-wheel title and description, and a fallback for a missing wheel
- [ ] #2 opengraph-image renders a 1200x630 PNG per wheel using only Satori-supported CSS
- [ ] #3 Caprasimo and Figtree are explicitly fetched and passed to ImageResponse and render correctly
- [ ] #4 The wheel graphic in the OG image is SVG arcs, not a conic-gradient
- [ ] #5 The image content stays sensible when it is served stale after the wheel has changed
- [ ] #6 A static landing-page OG image is served for the site root
- [ ] #7 Previews are verified by pasting a share URL into Slack and into a Twitter card validator
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:54
---
Decision 17: duplicate copies the title verbatim, so two forks of one wheel produce identical OG unfurls. This is consistent with the staleness-robust design already required here rather than a new problem, but it does mean the unfurl cannot be relied on to distinguish two wheels. Do not add fork markers or disambiguating text to the image to compensate.
---
<!-- COMMENTS:END -->
