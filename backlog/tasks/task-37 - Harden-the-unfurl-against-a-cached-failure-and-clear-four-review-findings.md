---
id: TASK-37
title: 'Harden the unfurl against a cached failure, and clear four review findings'
status: Done
assignee:
  - '@claude'
created_date: '2026-08-11 00:58'
updated_date: '2026-08-11 01:08'
labels: []
dependencies: []
documentation:
  - docs/spin-the-wheel-design.md
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A code review of the unpushed work on main turned up seven findings. One is serious and specific to the unfurl; the rest are small and unrelated to each other. All verified by hand before this task was written — the notes below record what the checks actually showed, because two of the seven were reported with the wrong mechanism and one was reported against the wrong file.

**The serious one.** `ImageResponse` stamps its own `cache-control`, and in production that value is `public, immutable, no-transform, max-age=31536000`. Confirmed from the compiled @vercel/og source and cross-checked against the running dev server, which returns the `no-cache, no-store` that only the development arm of the same ternary produces. So the `preview() === null` fallback in app/w/[shareId]/opengraph-image.tsx inverts its own intent: one Firestore timeout, or a preview deployment without credentials, renders the generic card — and that card is then held immutable for a year by the CDN and every intermediary. The route is never asked again for that share URL, so the 'recover on the next fetch' the file is built around never happens. On a product whose design doc opens by saying a cached card cannot be corrected, the fallback is the last thing that should be pinned.

Two things make it worse, and they are the same fix. The `try/catch` wraps the READ but not the RENDER, and the render is the half user input can break: `new ImageResponse(...)` returns immediately and satori/resvg run inside the body stream, after 200 and the headers are already committed — so a throw there cannot fall back to anything, it truncates the body. That is reachable: @vercel/og's `loadDynamicAsset` emoji branch does an unguarded `fetch` to cdn.jsdelivr.net for any emoji in a title, while the CJK branch immediately beside it is wrapped in a `try/catch`. A wheel called 'Lunch 🌮' therefore reaches out to a third-party CDN mid-render, and a failure there is a broken image rather than a generic card.

app/opengraph-image.tsx needs none of this and is deliberately left alone: it is static, prerendered at build time, so a render failure is a build failure and its immutable header describes a PNG that genuinely cannot change.

**The contradiction.** CLAUDE.md says `optionPills` 'reports an overflow **even when it is showing every option**, so four pills always read as a sample rather than as the wheel', and rests the whole 'a card may name options' decision on it. The code returns `Math.max(0, usable.length - PILLS_MAX)`, which is 0 at exactly four; its own doc block argues that is deliberate, and a test pins it. The code is right and the sentence is wrong — the card renders overflow as '+N more', so an always-on overflow would have to read '+0 more'. CLAUDE.md is what moves.

**The self-contradicting card.** Still in `optionPills`: `overflow` counts the FILTERED list while the count line beside it is fed `preview.optionCount`, which `readWheelPreview` takes from the unfiltered array — `labelOf` deliberately coerces a bad label to '' rather than dropping it, to keep the palette positions aligned. Six stored options with two label-less ones therefore render four pills, no '+N more', and '6 options on the wheel' underneath. Only a hand-edited document produces it, which is exactly the case `labelOf` and the filter exist for.

**Three small ones.** `WheelMark` stamps no aria attributes, so the landing header and the wheel header each expose an unnamed graphic immediately before the text that already names the brand. `createWheelSounds`'s recovery `catch` clears `context` and `master` but not `stopListening` or `noise`, so it is not the clean slate its comment claims and disagrees with `dispose()`, which clears all four. And two comments in disc.tsx still justify themselves by a white wedge stroke that the code eleven lines below records as removed — which CLAUDE.md specifically calls out as the way a seam gets put back into the favicon.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The per-wheel OG route never returns an immutable or long-lived cache header; a card built from a FAILED read is not cacheable at all, so the next fetch re-reads rather than being served a year-old generic card
- [x] #2 A render that throws — including on the emoji path — produces the generic card rather than a truncated body, which means the PNG is fully rendered before the response is constructed
- [x] #3 A wheel whose title contains an emoji still unfurls, and its card is not cached as though it were correct if the emoji asset could not be fetched
- [x] #4 app/opengraph-image.tsx is unchanged and still prerendered — its render failures stay build failures
- [x] #5 optionPills reports overflow against the wheel's own option count rather than the filtered sample, so pills plus '+N more' can never disagree with the count line beside them
- [x] #6 The overflow is still 0 when the card is showing every option; '+0 more' is not a state the card can reach
- [x] #7 CLAUDE.md's unfurl section describes what optionPills actually does, and states the real invariant it was reaching for
- [x] #8 WheelMark is hidden from assistive technology at every call site, and both OG cards and the favicon still render — verified by generating them, not by reasoning about Satori
- [x] #9 createWheelSounds' recovery path leaves the same state dispose() does: no orphaned preference subscription can survive a failed ensure(), and no AudioBuffer outlives the context that made it
- [x] #10 The two comments in disc.tsx describe why the backdrop and hub circles are there given that the wedges meet edge to edge with no stroke
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. app/w/[shareId]/opengraph-image.tsx — render to bytes before responding. `await new ImageResponse(...).arrayBuffer()` inside a try/catch puts satori's work in front of the response instead of inside its body stream, which is what makes both a fallback and a chosen cache header possible. Return a plain `Response` with an explicit `cache-control`. Three outcomes, three policies: a wheel that read fine gets a bounded public cache; a read that THREW gets `no-store`, so the generic card can never be pinned; a render that threw retries once with the generic card and is also `no-store`.
2. Keep the read's error distinguishable from a genuine 404. `readWheelPreview` already answers null for 'not there', and the catch currently collapses the two — the COPY must stay identical (preview.ts's `wheelMetadata` argues that at length) but the CACHING must not, since only one of them is a failure. A small discriminated result, not a second null.
3. app/og/preview.ts — `optionPills(options, total)`. Overflow becomes `total - pills.length`. Required rather than defaulted to `options.length`: WheelPreview's own doc says `options` may be a sample and nothing may assume it is complete, and a default would quietly re-make that assumption. Still 0 when everything is shown.
4. CLAUDE.md — rewrite the `optionPills` sentence to say what the function does. The invariant it was reaching for is real and stays: nothing on the card claims to be current or complete.
5. components/wheel/disc.tsx — `aria-hidden` inside WheelMark rather than at the four call sites, since all four are decorative. Then RENDER both cards and the favicon, because Satori's failure mode is a silently empty picture rather than an error.
6. components/wheel/sounds.ts — the recovery catch does what dispose() does: stop and null `stopListening`, null `noise`.
7. components/wheel/disc.tsx — rewrite the backdrop and hub comments to justify the circles by what is actually true now (antialiasing at the rim, converging wedge points) rather than by a stroke that was removed.
8. npm test, typecheck, lint, format, and a card re-render.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two of the seven findings were reported with the wrong mechanism, and checking rather than trusting changed what got written.

The cache-header finding survived scrutiny but not on the first attempt: constructing an `ImageResponse` in a bare node script returns `public, max-age=0, must-revalidate`, which would have made the whole thing a false alarm. That is a different constructor from the one the route reaches. What settled it was the running dev server answering `no-cache, no-store` — the exact string only the development arm of @vercel/og's ternary produces, so the production arm is the immutable year. Fixed, and confirmed end to end against the dev server: a healthy card now answers `public, max-age=600, stale-while-revalidate=3600`, and a forced render failure answers `no-store` with a valid 1200x630 generic-card PNG rather than a truncated body.

The emoji path was confirmed live rather than argued: a wheel retitled 'Lunch Friday 🌮' unfurls with the taco drawn, which is only possible because @vercel/og fetched it from cdn.jsdelivr.net mid-render. The title was restored afterwards.

The sounds test needed two attempts and the first one was worthless. It asserted that flipping the preference after `dispose` does not throw, which passes with the leak in place — `cancel` had already emptied `playing`, so the orphaned callback ran harmlessly. Rewritten to count `storage` handlers at the window and to require the rebuilt context to mint its own noise buffer. The ORDER turned out to be the whole test: an earlier version failed the very first `ensure()`, which leaves both `noise` and `stopListening` null and makes both assertions true with or without the fix. It now spins successfully first, then interrupts the context the way iOS does. Mutation-checked in both directions — with the fix 23 pass, without it the case fails.

The `optionPills` contradiction resolved against CLAUDE.md rather than against the code: the card renders overflow as '+N more', so an always-on overflow would have to read '+0 more'. The code, its doc block and its test all agreed already; the doc sentence was the only outlier.

Verified: npm test 1071 passing across 35 files, npm run test:emulator 322 passing across 14 (run against the already-running emulator, since the port was taken), typecheck, lint, format:check all clean. Both OG cards and the favicon re-rendered after the disc.tsx change and inspected — the mark still draws its four quarters with no seam.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Seven review findings addressed; the unfurl one was the real defect.

app/w/[shareId]/opengraph-image.tsx now renders the PNG to bytes before constructing its response, which is what makes the other two fixes possible: satori runs in front of the response instead of inside its body stream, so a render that throws falls back to the generic card instead of truncating, and the route chooses its own cache-control instead of accepting the `public, immutable, max-age=31536000` that ImageResponse writes in production. A card built from a failed read, or from a failed render, is now `no-store` — so a Firestore timeout can no longer pin the generic card against a live share link for a year. A healthy card gets ten minutes. The read result became a discriminated type so that 'this wheel is gone' and 'we could not read it' keep sharing their wording, as wheelMetadata argues they must, while no longer sharing a cache policy.

optionPills takes the wheel's own option count and counts overflow against the pills it drew, so '+N more' can no longer disagree with the count line beside it. CLAUDE.md's claim that it 'reports an overflow even when it is showing every option' was the outlier and now describes what the function does.

Three smaller ones: WheelMark carries aria-hidden, so neither header exposes an unnamed graphic beside the word it duplicates; createWheelSounds' recovery path clears the same four fields dispose does, closing an orphaned storage listener and a cross-context AudioBuffer; and two comments in disc.tsx now justify the backdrop and hub circles by antialiasing and converging wedge points rather than by a white stroke the code removed.

app/opengraph-image.tsx deliberately untouched: it is prerendered, so its failures are build failures and its immutable header is honest.

Verified with npm test (1071), npm run test:emulator (322), typecheck, lint, format:check; the cache and fallback behaviour driven against the dev server; and both cards plus the favicon re-rendered and inspected.
<!-- SECTION:FINAL_SUMMARY:END -->
