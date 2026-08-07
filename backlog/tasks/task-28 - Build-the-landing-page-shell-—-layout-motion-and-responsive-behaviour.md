---
id: TASK-28
title: 'Build the landing page shell — layout, motion and responsive behaviour'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 19:19'
updated_date: '2026-08-07 21:48'
labels: []
dependencies:
  - TASK-3
  - TASK-4
documentation:
  - docs/spin-the-wheel-editor/project/Home.dc.html
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 21500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build the static landing page at / from the prototype in docs/spin-the-wheel-editor/project/Home.dc.html. Everything except the two hero call-to-action destinations, which are TASK-22.

Split out of TASK-22. The visual layer needs only the design tokens (TASK-3) and the shadcn primitives (TASK-4), both of which are done, so it can be built now. TASK-22 was blocked six tasks deep behind TASK-21, but only its two hero buttons actually needed any of that — the markup, the type scale, the motion and the responsive behaviour needed none of it.

Sections, in order: header with brand mark and nav; a hero with an accent-2 tag pill, an h1 at clamp(48px, 6vw, 78px) reading 'Stop debating. Spin for it.', supporting copy, two call-to-action buttons, and an avatar-stack row reading 'No account needed'; a decorative wheel rendered as a conic-gradient circle turning slowly on a 26s linear loop; a three-step 'How it works' grid on an auto-fit minmax(260px, 1fr); a wrapped row of use-case pills; a full-bleed accent-filled call-to-action band; and a footer.

Decorative background: three soft circles — accent-200 top left at 420px, accent-2-200 right at 360px drifting on a 9s ease-in-out loop, and a small #ffc23c circle drifting on a 6s loop.

Honour prefers-reduced-motion for all three drifting circles and the turning wheel. The turning wheel and the drifting circles are purely decorative and must be inert to assistive technology.

The two hero buttons render with their prototype labels and styling but are not wired. 'Make a wheel' and 'See a live one' get their destinations in TASK-22, which depends on this task. Leave them as non-navigating elements rather than dead hrefs, so a click cannot look like a broken link during review.

Use the tokens from TASK-3 rather than the prototype's raw hex values, except where a colour genuinely has no token — the small #ffc23c circle is the known case. Per the project conventions, where the prototype and docs/spin-the-wheel-design.md disagree, the design doc wins.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The page matches the prototype section order, type scale, spacing and color treatment
- [x] #2 The layout holds from 360px to 1920px with no horizontal overflow
- [x] #3 prefers-reduced-motion stops the drifting circles and the turning wheel
- [x] #4 Both hero call-to-action buttons render with prototype labels and styling, and do not navigate
- [x] #5 The decorative wheel and background circles are hidden from assistive technology
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/landing.css — the two prototype keyframes (drift, turn) plus a prefers-reduced-motion guard that stops both. Page-scoped file imported by page.tsx, not theme.css: theme.css is a hand-curated token set and its header says component styling does not belong there.

2. Rewrite app/page.tsx as a server component, no 'use client'. Sections in prototype order: header, hero, decorative wheel, How it works, use-case pills, CTA band, footer.

3. CTAs render as plain <button type="button"> styled with buttonVariants(), not the Button component. Base UI's Button ships 'use client', so importing it would open a client boundary for four controls that do nothing yet. TASK-22 swaps in the real component when it needs handlers. Nav anchors (#how, #uses) stay real <a> links — they work today.

4. Responsive work, which the prototype has none of: its hero grid is minmax(360px,1.05fr) minmax(320px,0.95fr), a 680px floor that overflows any phone. Collapse to one column below the md breakpoint, scale the 48px gutters down at mobile, and cap the content at a max width so the page does not stretch to a bare 1920px.

5. Accessibility: decorative wheel and all three background circles aria-hidden and pointer-events-none; heading order h1 then h2 then h3 with no skips; header nav in a <nav>, footer in <footer>.

6. Verify: typecheck, lint, format:check, build, then drive the real page in the browser at 360, 768 and 1920 and confirm no horizontal overflow, plus a reduced-motion pass with the media feature emulated.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built app/page.tsx (server component, no client boundary — / stays statically prerendered) and app/landing.css.

Verified: typecheck, lint, format:check, build, npm test (51 eslint-rule tests) all pass.

Browser verification was done through same-origin iframes rather than window resizing — the resize_window tool reported success but never changed the viewport (innerWidth stayed 1343 across two attempts). An iframe gives a real viewport for media queries and vw units, so the measurements are honest.

- No horizontal overflow at 320, 360, 375, 414, 640, 768, 900, 1024, 1280, 1440 or 1920. scrollWidth === clientWidth at every step, and the only elements escaping the viewport are the three decorative circles, which the overflow-x-clip container contains.
- The prototype's hero grid has a 680px floor (minmax(360px,1.05fr) + minmax(320px,0.95fr)), so it now collapses to one column below the lg breakpoint. Gutters go 20px to 48px at md. Content capped at 1280px.
- Reduced motion exercised for real, not just inspected: widened the shipped media rule's condition to 'all' in the CSSOM and confirmed all three elements drop to animationName 'none' AND transform 'none', then restored it. transform none is the point of using animation:none over animation-play-state:paused — paused would freeze the conic-gradient disc at an arbitrary rotation.
- All decorative nodes confirmed aria-hidden: three background circles, hero wheel, its pointer, brand mark, avatar stack, three step chips. Heading order h1, h2, h3 h3 h3, h2, h2 with no skipped levels. One header, nav, main and footer each.

Bug found and fixed during verification: the call-to-action band button rendered white-on-white. buttonVariants() returns raw cva output, which concatenates instead of merging, so bg-white and text-accent-700 landed in the class list alongside bg-primary and text-primary-foreground and the winner was decided by stylesheet order. bg-white won, text-accent-700 lost. All four call-to-action buttons now go through cn(), which runs the project's extended tailwind-merge. Worth knowing generally: buttonVariants() outside a cn() is unsafe anywhere an override is passed.

--- Post-review pass (/code-review) ---

Four low-severity findings, all confirmed and all fixed. Re-verified after: typecheck, lint, format:check, build, npm test green; no overflow at 320/360/768/1024/1440/1920; reduced motion still drops all three to animationName none and transform none.

1. Recorded contrast figure was wrong. I logged the band paragraph at 3.39:1 by reading getComputedStyle().color, which ignores element opacity. The p carries opacity 0.92, so the painted colour is #fef1f2, not #ffffff, and the real ratio is 3.08:1. Corrected on TASK-26, which would otherwise have decided from the wrong number. The two button figures (3.15:1) re-verified and hold. 26 other text nodes pass.

2. conicFromPalette indexed SLICE with a plain number, which widens a tuple to string — an out-of-range index would type-check, lint clean, then emit conic-gradient(undefined 0 12.5%, ...), which the browser discards as an invalid declaration. Blank transparent disc, no console error, no build failure. Now routed through sliceColors(), which already wraps and truncates for this exact reason; the two remaining direct SLICE reads went the same way, so the page now has one accessor and no direct tuple indexing. Verified the emitted gradients still contain real colours.

3. The header nav button was the one buttonVariants() call not wrapped in cn(), contradicting the invariant this file's own doc comment asserts. Harmless today (no override passed) but exactly the white-on-white failure waiting for TASK-22 to add a class — and a false invariant is what stops someone looking. Wrapped.

4. var(--landing-drift-duration) had no fallback. animation is a shorthand, so an unresolvable var() inside it is invalid at computed-value time and the whole declaration is dropped — .landing-drift on an element without the inline property would silently not animate rather than fall back. Added a 9s fallback and verified with a bare probe element that it now animates.

Side effect to note: the review agent ran pkill -f 'next dev', which killed a pre-existing dev server (PID 73359) that was running before this task started, not just its own.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 19:30
---
Contrast finding, deliberately not fixed here — it is a design-system property, not a page bug.

Swept every text node on the page against its own painted background. Three fail WCAG AA:

1. 'Open a wheel' (header), 14px — #f7f6fb on #f2545b, 3.15:1, needs 4.5
2. 'Make a wheel' (hero), 18px — #f7f6fb on #f2545b, 3.15:1, needs 4.5
3. 'Make the wheel now, argue never.' (band), 18px — #ffffff on #f2545b, 3.39:1, needs 4.5

Everything else passes, including all body copy at neutral-700 and the 40px band heading, which clears the 3:1 large-text bar.

1 and 2 are the shared Button 'default' variant from TASK-4 — bg-primary with text-primary-foreground — used unmodified. Every primary button in the app has this ratio, and it is already in the kitchen sink. globals.css documents the cause: the accent-to-ground pair is tuned to 3:1, which carries icons and large text but not body copy. Fixing it means retuning the button variant, which changes every screen.

3 is white on the accent band. That pairing is the prototype's design. Darkening the band to accent-600 (4.0:1) or accent-700 (6.14:1) would fix it but departs from the colour treatment AC 1 asks for.

Left alone on purpose: silently retuning a shared variant is a design-system change, and fixing only the one page-local instance would leave the page failing anyway while making it internally inconsistent. TASK-26 is the accessibility pass and is where this belongs.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the landing page from the Claude Design prototype as a server component with no client boundary, so / stays statically prerendered.

app/page.tsx carries the full section order — header, hero, decorative wheel, How it works, use-case pills, call-to-action band, footer. app/landing.css holds the two prototype keyframes and the reduced-motion guard, kept out of theme.css because that file is a token set, not a place for one route's decoration.

Disc colours are derived from wheel-palette.ts by index rather than repeated as hex literals, so the page advertising the wheel stays in sync with the wheel. The three use-case pills with no counterpart in the theme ramps stay as literals.

The responsive layer is new work — the prototype is a fixed-width desktop mockup whose hero grid alone has a 680px floor. Verified no horizontal overflow at ten widths from 320 to 1920 via same-origin iframes, since resize_window silently failed to change the viewport.

Reduced motion was exercised rather than assumed: forcing the shipped media rule on drops all three animations to none with transform reset, not frozen mid-rotation.

Fixed a real bug found in the browser — the band button rendered white-on-white because buttonVariants() concatenates rather than merges. All four call-to-action buttons now go through cn().

Left open and reported: three white-on-accent text instances fail AA at 3.15-3.39:1. Two are the shared Button primary variant from TASK-4, one is the band paragraph. Flagged to TASK-26 rather than fixed, since retuning the variant changes every screen.
<!-- SECTION:FINAL_SUMMARY:END -->
