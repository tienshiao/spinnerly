---
id: TASK-3
title: Port the Organic design tokens into the Tailwind theme
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:35'
updated_date: '2026-08-07 09:44'
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
- [x] #1 A single CSS entry point defines the full token set as Tailwind v4 @theme variables
- [x] #2 All 27 ramp steps plus bg, surface, text, accent, accent-2 and divider match the prototype hex values exactly
- [x] #3 Caprasimo and Figtree load via next/font with the weights the prototype uses
- [x] #4 Headings default to Caprasimo and body text to Figtree with no per-component font declarations
- [x] #5 The focus-visible ring is a 2px accent outline at 2px offset globally, per the Organic readme interaction states section
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/theme.css — full Organic token set as Tailwind v4 @theme, using the Spinnerly :root override values (27 ramp steps + bg/surface/text/accent/accent-2/divider), plus space, radius and shadow scales.
2. app/fonts.ts — Caprasimo 400 and Figtree (variable, covers 400/600/700) via next/font/google, exposed as CSS variables wired into --font-heading / --font-body.
3. app/globals.css — import tailwindcss + theme.css; base layer for body ground/type, h1-h6 heading font and the prototype size scale, :focus-visible 2px accent ring at 2px offset, ::selection tint.
4. app/wheel-palette.ts — SLICE and INK arrays as named exports, kept out of the theme.
5. Verify with typecheck, lint, format:check and a production build.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Ported into three files: app/theme.css (tokens), app/fonts.ts (next/font), app/globals.css (base layer). Wheel slice palette kept out of the theme in app/wheel-palette.ts as SLICE/INK named exports plus a sliceColors(i) wrapping helper.

Verified in a running dev server, not just by inspecting source: computed body ground #f7f6fb, heading family resolves to Caprasimo, body to Figtree, an unstyled h2 computes to 32px, and every token reads back off :root with the prototype value. The focus ring renders coral 2px at 2px offset on a focused input. Build emits four self-hosted woff2 files and zero requests to fonts.googleapis.com or fonts.gstatic.com.

Three decisions worth knowing about:

1. @theme static, not plain @theme. Tailwind v4 emits only the theme variables it can see used in a utility class, and a first build dropped --spacing-1/6/8 and --radius-container/pill entirely. Components are expected to reach for these through plain var() too, which Tailwind cannot detect and which would then resolve to nothing. The token set is small and hand-curated, so emitting all of it is cheap.

2. Shadows are derived from the Spinnerly neutral-900 (#26252c), not carried over literally. Organic's styles.css hardcodes its own #2e2b25 in the three shadow tokens, and the prototype pages override the colour vars but never the shadows, so the prototype literally renders warm-brown shadows on the cool Spinnerly ground. Organic documents elevation as derived from the ground; the ground changed, so the derivation was reapplied. The difference is invisible at 14-22% alpha.

3. The space scale is a partial override. Organic defines steps 1/2/3/4/6/8 only. Tailwind v4's dynamic --spacing multiplier stays live for the rest, so p-4 is Organic's 17.6px while p-5 falls back to 20px off the 4px grid. Verified in generated CSS. Leaving the multiplier in place is deliberate: killing it would break the standard scale that shadcn primitives depend on in TASK-4.

Post-review fixes (all findings verified before acting, none taken on trust):

1. Links were on --color-accent, which is Organic's default rule but not what ships. All four prototype pages override a{} to --color-accent-700 with the base accent on hover, and the Organic readme says why: the accent-to-ground pair is tuned to 3:1, fine for icons and large text, not for body copy. Measured #f2545b on #f7f6fb at 3.15:1, failing WCAG AA for inline links; #b02730 is 6.14:1. Fixed, hover state restored.

2. Radius, elevation and the neutral ramp were partial overrides of Tailwind namespaces, so the unreferenced default steps survived the merge. The radius one was the worst: Tailwind's --radius-xl (12px) outlived the override, so rounded-xl rendered a SMALLER corner than rounded-md (16px), and rounded-2xl was identical to it — a component asking for a rounder corner would have quietly got a squarer one. Shadows mixed pure-black Tailwind steps in with the ink-tinted Organic ones, and the neutral ramp kept Tailwind's chroma-0 grey at the 50 and 950 steps. All three namespaces now reset with *: initial before being redefined; confirmed against generated CSS that no default steps survive.

   Consequence for TASK-4: rounded-xs/xl/2xl/3xl/4xl, shadow-2xs/xs/xl/2xl and neutral-50/950 no longer exist. Organic is a three-step system and shadcn defaults reach for steps outside it, so retuning those primitives means mapping them onto sm/md/lg rather than pasting snippets unchanged.

3. --font-heading put the fallback chain after the var() instead of inside it. A bare var() naming an undefined property poisons the whole declaration, and font-family being inherited means the element inherits its parent's face rather than falling through to system-ui — so the documented fallback did nothing in exactly the case it was written for (a tree not carrying the next/font classes, such as an OG route reusing theme.css). Now var(--font-heading-src, system-ui).

4. --radius-container hardcoded 28px while its comment called it radius-lg * 1.15; retuning --radius-lg would have left it stale. Now references the token, as the prototype does. Same treatment for the three shadows, which hardcoded #26252c instead of --color-neutral-900 — and this cost nothing, because Tailwind emits the precomputed hex plus a var() form behind an @supports guard.

5. sliceColors could return undefined typed as string, two ways: a fractional or NaN index passes through the modulo unchanged, and nothing tied SLICE and INK to the same length. Added Math.trunc plus a finite guard, and an exported PALETTE_LENGTH whose annotation makes the arrays diverging a compile error. Verified it fails in both directions by growing each array in turn.

6. page.tsx used text-neutral-600 (#7d7a8c, 3.88:1) where the Tailwind gray-500 it replaced was 4.50:1 — a contrast regression I introduced. Now neutral-700 at 6.26:1.

Re-verified: typecheck, lint, format:check, test (20 pass), production build, and the built CSS confirms the link rules and that no Tailwind default steps remain in the three reset namespaces.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Ported the Organic design system's tokens, in its Spinnerly palette variant, into the Tailwind v4 theme.

app/theme.css holds the token set as a single @theme static block: the 27 ramp steps plus bg, surface, text, accent, accent-2 and divider verbatim from the prototype :root override, Organic's 1.1x space scale, the radius scale with the rounded-frame container and pill values, the heading size ramp, and the three elevation shadows. app/fonts.ts loads Caprasimo 400 and variable Figtree through next/font/google and feeds them to --font-heading and --font-body. app/globals.css restores the heading face and scale that Tailwind's preflight strips, and sets the themed interaction states. app/wheel-palette.ts keeps the slice colours out of the theme, since they are a data palette indexed by option position rather than a semantic role.

Verified with npm run typecheck, lint, format:check, test (20 pass) and a production build, and then in the browser against a running dev server: tokens read back off :root with the prototype values, headings compute to Caprasimo at the Organic scale, body to Figtree at 15px/1.55, and the focus ring renders coral 2px at 2px offset. The build ships four self-hosted woff2 files and makes no request to Google.

Also aligned the TASK-2 placeholder page, which was still on Tailwind's default grays and put font-bold on a face that only ships weight 400.
<!-- SECTION:FINAL_SUMMARY:END -->
