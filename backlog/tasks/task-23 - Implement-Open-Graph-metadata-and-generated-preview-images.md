---
id: TASK-23
title: Implement Open Graph metadata and generated preview images
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-07 08:39'
updated_date: '2026-08-10 20:19'
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
- [x] #1 generateMetadata emits a per-wheel title and description, and a fallback for a missing wheel
- [x] #2 opengraph-image renders a 1200x630 PNG per wheel using only Satori-supported CSS
- [x] #3 Caprasimo and Figtree are explicitly fetched and passed to ImageResponse and render correctly
- [x] #4 The wheel graphic in the OG image is SVG arcs, not a conic-gradient
- [x] #5 The image content stays sensible when it is served stale after the wheel has changed
- [x] #6 A static landing-page OG image is served for the site root
- [ ] #7 Previews are verified by pasting a share URL into Slack and into a Twitter card validator
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Commit Caprasimo 400 and Figtree 400/700 TTFs under assets/fonts/ with the OFL text; app/og/fonts.ts reads them at module scope for ImageResponse. Not subset: the files are ~40KB each and subsetting would cost the accented characters an 80-code-point title may hold.
2. Add readWheelPreview(shareId) to lib/wheels/store.ts, returning { title, optionCount } | null. Deliberately narrower than a full Wheel so this path cannot grow into rendering the live option list. Emulator tests.
3. app/og/preview.ts — the pure derivations: metadata title and description, the option-count line, the decorative slice count, the title font-size ramp. Unit tested under npm test.
4. app/og/ card pieces — the wheel as SVG arcs via components/wheel/geometry.ts wedgePath, the frame and blobs as nested inline-styled flex. No grid, no conic-gradient, no client component.
5. app/w/[shareId]/opengraph-image.tsx and generateMetadata on the page. Both fall back to generic copy and the generic card for a missing wheel or a failed read — an OG failure must not take the page with it.
6. app/opengraph-image.tsx — the marketing card, static, no request data.
7. metadataBase in the root layout from NEXT_PUBLIC_SITE_URL then VERCEL_PROJECT_PRODUCTION_URL then localhost; documented in .env.example.

Deviations from the prototype, both from design doc section 11 question 1 winning over the prototype per CLAUDE.md: no option pills (that is the live list the staleness argument rules out) and no 'suggest your own' line (suggestionsOpen is a kill switch, so a cached unfurl would invite people into a box the organiser has closed).

AC 7 cannot be met from here: Slack and the Twitter card validator need a public URL and deployment is TASK-25. Verification here is a local render of both PNGs plus the emitted meta tags.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented.

New files:
- assets/fonts/ — Caprasimo 400 and Figtree 400/700 as ttf, plus each face's OFL text. Committed because next/font self-hosts woff2, which Satori cannot parse, under content-hashed paths the route cannot name. Not subset: ~40KB each, and a title is up to TITLE_MAX code points of arbitrary user text, so an ASCII subset would put a hole in 'Café'.
- app/og/theme.ts, fonts.ts, preview.ts, wheel.tsx, cards.tsx — the Satori half. preview.ts is pure and unit tested; the cards are nested flex with literal colours; the disc is SVG arcs from components/wheel/geometry.ts, which was split out of the client component for this.
- app/opengraph-image.tsx (static, prerendered) and app/w/[shareId]/opengraph-image.tsx (dynamic).
- lib/site.ts — SITE_NAME, SITE_TAGLINE and siteUrl() for metadataBase.
- lib/wheels/preview.emulator.test.ts, app/og/preview.test.ts.

Changed:
- lib/wheels/store.ts gains readWheelPreview — its only read. Returns { title, optionCount } or null, never throws for a missing wheel, and does not slide expiresAt: a crawler reading a pasted link is not activity, and treating it as such would let a link in a busy channel keep a wheel alive forever.
- lib/wheels/model.ts gains WheelPreview, deliberately without options.
- app/layout.tsx gains metadataBase, the %s · Spinnerly title template, and the site-level openGraph/twitter defaults.
- app/w/[shareId]/page.tsx gains generateMetadata and runtime = 'nodejs'.
- next.config.ts gains outputFileTracingIncludes for the fonts.
- .env.example documents NEXT_PUBLIC_SITE_URL.
- CLAUDE.md gains an 'unfurl' section.

Two findings worth recording:

1. Next replaces the openGraph and twitter field groups wholesale rather than merging them. The first version of generateMetadata set only twitter.title and twitter.description, which silently dropped the layout's card: 'summary_large_image' — X would have rendered the 1200x630 card as a small square thumbnail on the one page that matters. Caught by reading the emitted tags, not by the build, a type check or lint. Both groups now restate type, siteName and card.

2. The prototype's 92px headline overflows in Satori, which sets Caprasimo a shade wider than a browser does; 'Stop debating.' broke after 'Stop' and the marketing card came out three lines where the design has two. Set to 84.

Verified locally against the emulator: both cards render 1200x630 PNGs with both faces correct; checked a 5-option wheel, an 80-code-point title on an empty wheel, a 14-option wheel (capped at ten wedges, one full palette pass) and a wheel that does not exist (generic card, HTTP 200 rather than a 500). Meta tags confirmed on both the wheel page and the root. npm run test:all, lint, typecheck, format:check and build all pass.

Follow-up folded in at the user's request: app/robots.ts (plus app/robots.test.ts).

`/w/` and `/api/` are disallowed for `*`, so a share URL linked from a public page does not become a search result — the share URL is the capability (design doc §2) and there is nothing else gating it.

The part that is easy to get wrong: the unfurlers honour robots.txt like any other crawler, Twitter's, Slack's and Discord's documentation all saying so, so a bare `Disallow: /w/` would have taken every preview down with the search results. They are named in their own group, which wins over `*` for the bot it names. The test asserts both halves, because both fail silently.

Deliberately not a `noindex` meta tag, which would be the stronger measure — it keeps a URL out of results even when linked from elsewhere, which robots.txt does not. Several unfurlers decline a card on a noindexed page, so it would cost the previews this task exists to produce. Noted in the file and in CLAUDE.md so it is not 'upgraded' later.

Verified: /robots.txt serves the expected two groups from the dev server and prerenders static in the build.

Unified the three wheel drawings, and the card now lists the options — both at the user's request during review.

The three surfaces that draw a wheel had drifted: the landing hero was a conic-gradient with no dividers between slices and a hub inset by 38%, the wheel page was SVG arcs with a 34-unit hub and a drop-shadowed pointer, and the Open Graph card had a third hub size, a rim more than twice as thick and a pointer in accent-500 rather than accent-600. Nothing was wrong with any one of them, which is why nobody noticed.

They now share components/wheel/disc.tsx — WheelDisc and WheelPointer — with the proportions in components/wheel/geometry.ts (POINTER_WIDTH/HEIGHT/RISE are new there) and the palette sequences in app/wheel-palette.ts (DECORATIVE_SLICES and BRAND_MARK_SLICES moved out of app/page.tsx, which is what had the hero and the card closing their eight-slice wheel on different colours). components/wheel/wheel.tsx keeps only what is its own: the rotation, the aria-label and the wedge labels. The wheel page's rendered DOM is unchanged apart from the group described below.

Three Satori behaviours cost time and all three fail the same way — a blank disc on a card, no error anywhere:

  1. It does not invoke a function component inside an <svg> subtree, so WheelDisc has to render the <svg> element itself rather than its contents.
  2. It renders only the first child of a fragment, so the drawing is wrapped in one <g>. That is the one change to the wheel page's DOM; components/wheel/wheel.test.tsx now reads through 'svg > g'.
  3. It drops a second level of <g>, so a wedge is a bare <path> unless it carries a label.

The options are now shown as pills, four of them plus a '+N more'. That answers design doc §11 question 1 the opposite way to its own leaning — recorded as a comment on TASK-1, which owns that question. WheelPreview gains options: string[] alongside optionCount, and the two are deliberately separate because the labels are a sample. optionPills reports an overflow even when it is showing every option it was given, so four pills never read as a complete wheel; og:description stays a count, since it is quoted verbatim into a chat message where a stale list of specific things reads worse than a stale number. A pill's dot is its option's palette position, which pairs it with its own wedge — readWheelPreview therefore keeps a place in the array for an option whose stored label is not a string, since dropping one would shift every colour after it.

Re-verified by rendering: a 5-option wheel, a 6-option wheel with a 73-character title and a label long enough to truncate, an empty wheel, and the marketing card; plus browser screenshots of the landing hero and the wheel page. npm run test:all (1003 unit, 322 emulator), lint, typecheck, format:check and build all pass.

Two more review changes.

**Dividers removed.** The wedges meet edge to edge on all three surfaces; the wheel and the brand mark now read as the same object, which they did not while one had white gaps and the other never has. WEDGE_STROKE is gone from components/wheel/geometry.ts, and BACKDROP_RADIUS's comment no longer justifies itself by the stroke — it is simply the rim, and now the only white in the drawing apart from the hub. components/wheel/wheel.test.tsx asserts the absence rather than the width.

**One brand mark, and it is the favicon.** There were three hand-rolled copies: the landing header and the wheel page's header each had their own BRAND_MARK_SLICES constant and a conic-gradient with an inset box-shadow ring, and the cards had OgMark. All four now render WheelMark from components/wheel/disc.tsx, which crops the viewBox to the wedges rather than sharing the wheel's rim margin — at favicon size that margin is a wasted pixel on every side. conicFromPalette is deleted; nothing used it once the marks moved.

app/icon.tsx renders that component through ImageResponse at 32 square. Generated rather than committed as a .ico so it cannot drift from the mark: quarters from BRAND_MARK_SLICES, geometry from components/wheel/geometry.ts, both shared with everything else that draws a wheel. Static, no fonts, prerendered at build. Next emits <link rel="icon" type="image/png" sizes="32x32"> on every page.

No apple-icon: worth adding when someone wants a home-screen bookmark to look right, and it would be the same component at 180 square.

Re-verified: both cards rendered, the favicon rendered and inspected, browser screenshots of the landing hero and the wheel page. test:all (1004 unit, 322 emulator), lint, typecheck, format:check, build all pass.

Code review, six findings, all acted on.

1. **Title overflow on the wheel card (the one that mattered).** The title div had no maxWidth and no wordBreak in a flex-start column, so a title with no break opportunity — a URL, a hashtag, a run of CJK — grew past the card and was cropped by the root's overflow:hidden. titleFontSize shrinks the text but cannot save a single 40-character word, and its own doc claimed TITLE_MAX 'lands inside the column at the smallest step', which was untrue for unbroken text. Fixed with maxWidth: PANEL_WIDTH and wordBreak: 'break-word', PANEL_WIDTH being the 560 the pills row already used. Verified by rendering 'Supercalifragilisticexpialidociousness-ish' at 48px and 80 W's — the widest glyph in the face — at 38px; both now wrap and stay inside the card.

2. **Same-colour adjacent wedges at 11, 21, 31 and 41 options.** Real, and a direct consequence of removing the divider: the palette wraps at ten, so a count one past a multiple of ten puts SLICE[0] next to itself and the two read as one double-width slice. Documented in app/wheel-palette.ts rather than fixed. The fix would be to shift the last few colours when the count lands badly, which costs the invariant that a wheel's Nth slice is always the Nth colour — adding an option would recolour slices nobody touched, mid-spin, on a wheel other people are watching.

3. **optionPills' doc overclaimed.** It said overflow is reported 'even at exactly PILLS_MAX', which the code does not do and should not: four pills on a four-option wheel is a complete list, the count line beside it says the same number, and '+0 more' would be nonsense. The comment moved, not the code — the real rule is that anything not shown is counted.

4. **Applebot removed from the robots.txt exception.** It draws iMessage's rich links but also feeds Siri and Spotlight, so excepting it handed a search crawler exactly the /w/ access the file exists to deny. iMessage loses nothing: the device fetches those previews itself and does not read robots.txt. app/robots.test.ts now asserts the exclusion, since it is the kind of decision a later reader would helpfully undo.

5. **metadataBase pointed at production from preview deployments.** VERCEL_PROJECT_PRODUCTION_URL is set on preview builds too, so a wheel created on a preview advertised its card at https://production/w/{shareId}/opengraph-image — where that wheel does not exist. Production would serve the generic card and the crawler would cache it against the preview link. siteUrl now uses VERCEL_URL unless VERCEL_ENV is 'production'.

6. **segmentAngle's doc drift.** It claimed the Math.max(count, 1) floor was load-bearing because wheel.tsx calls wedgePath(0, 0) for an empty wheel. After the disc.tsx refactor slicesFor hands it one blank slice, so no caller passes zero. Reworded as defensive, kept for the reason it is worth keeping — the failure it prevents renders as nothing at all.

All green after: 1005 unit, 322 emulator, lint, typecheck, format:check, build.

Colour allocation reworked so a wheel can never meet itself.

The seam — the last slice is adjacent to the first — collided whenever the option count was one past a multiple of ten, because `sliceColors` was `SLICE[i % 10]`. At 11, 21, 31 and 41 options the last wedge and the first were both SLICE[0] and read as one double-width slice with two labels on it. The white divider used to hide it.

Worth writing down why a second palette was not the answer, since it is the obvious one: the collision is structural rather than a matter of palette size. For any mapping that depends on position alone and repeats every P, the seam collides whenever count ≡ 1 (mod P). Brute-forced over 2..OPTIONS_MAX: ten colours clash at 11, 21, 31, 41; twenty clash at 21, 41; two palettes alternating by lap also clash at 21, 41. Clearing it that way needs more than fifty distinct colours.

What does clear it, with the ten colours already there: reserve SLICE[0] for position 0 and cycle the other nine after it — `i === 0 ? 0 : 1 + (i - 1) % 9`. Because the first colour never recurs, the seam cannot match it at any count.

Cheap for two reasons. It is the identity for positions 0 through 9, so no wheel of ten options or fewer changes, and neither does anything that names a palette entry by index — DECORATIVE_SLICES, BRAND_MARK_SLICES, the avatar row, the Open Graph pills. And `sliceColors` keeps its signature, so none of the six call sites move. A count-aware `sliceColors(index, count)` was the alternative and is worse: it would have to be threaded through the five option-position call sites but not the decorative ones, and a missed one is a dot that disagrees with its own slice.

Cost, accepted: colours repeat every nine after the first rather than every ten, SLICE[0] appears exactly once on any wheel, and wheels with more than ten options recolour once from position 10.

New app/wheel-palette.test.ts asserts the invariant the way the defect had to be found — for every count from 2 to OPTIONS_MAX, no two circularly adjacent slices share a colour, seam included. Also that the first pass is unchanged, that the ink stays paired with its fill, and the defensive cases. components/wheel/wheel.test.tsx's wrap test now asserts through `sliceColors` rather than restating the rule.

Also deleted `conicFromPalette`, which I had wrongly reported as removed earlier — its call sites went when the brand marks moved to WheelMark, but the function itself was still there, unused.

Verified by rendering an 11-option wheel in the browser: Option 11 is yellow against Option 1's red under the pointer, and every Options-panel dot still matches its wedge. 1061 unit, 322 emulator, lint, typecheck, format:check, build all pass.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:54
---
Decision 17: duplicate copies the title verbatim, so two forks of one wheel produce identical OG unfurls. This is consistent with the staleness-robust design already required here rather than a new problem, but it does mean the unfurl cannot be relied on to distinguish two wheels. Do not add fork markers or disambiguating text to the image to compensate.
---

author: @claude
created: 2026-08-07 09:31
---
From TASK-3: the fonts load via next/font/google, so Caprasimo and Figtree are self-hosted as woff2 under .next/static/media with content-hashed filenames. This route cannot reuse those files. Satori (which next/og wraps) does not parse woff2 at all — it needs ttf, otf or woff — and the hashed paths are not stable to read from a route handler anyway.

So TASK-23 needs its own font source: commit a ttf of each face (both are OFL-1.1, so redistribution is fine) and read them with fs.readFile at module scope, or fetch and cache them at build time. A subset ttf is worth it here since the OG image only ever renders a title and a count.

Flagging because TASK-3's description assumed the OG route could share the same font files, and it cannot.
---

author: @claude
created: 2026-08-10 09:18
---
AC 7 is not met and cannot be met from this branch. Slack's unfurl and the Twitter card validator both need a publicly reachable URL, and deployment is TASK-25, which is still To Do. Everything up to that point is verified: the routes return 1200x630 PNGs, the meta tags are correct in the rendered HTML, and both faces render. Re-run AC 7 as the first check after the first deploy — the twitter:card regression described in the notes is exactly the class of bug only that check finds.

Two things noticed and deliberately left out of scope:

1. Wheel pages are indexable. A share URL is the capability (design doc §2), so having Google list /w/{shareId} is not obviously wanted. The fix is a robots.txt disallowing /w/ rather than a noindex meta tag: several unfurlers, X's among them, are reported to skip cards on a noindexed page, so the meta route would risk the thing this task delivers. Worth its own task alongside TASK-25.

2. No twitter-image route. X falls back to og:image, which is what we want — a second route would be a second identical card to keep in step.
---
<!-- COMMENTS:END -->
