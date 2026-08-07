---
id: TASK-4
title: Add shadcn/ui primitives retuned to the Spinnerly tokens
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:35'
updated_date: '2026-08-07 17:16'
labels: []
dependencies:
  - TASK-2
  - TASK-3
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Adopt shadcn/ui for the small set of primitives where accessibility is the expensive part to hand-roll, and theme them from the tokens rather than from shadcn defaults.

Components to install: button, input, dialog, badge, sonner (toast), tooltip if needed. Nothing else. The wheel, the option rows, the suggestion rows and the confetti are bespoke and should not be forced through shadcn.

Theming approach: shadcn reads flat semantic CSS variables (--background, --foreground, --primary, --border, --radius). Map those onto the Organic ramp rather than duplicating hex values, so the ramp stays the single source of truth. --radius maps to 999px so every primitive is a pill, which is what the design calls for.

Button variants must land on the prototype look: primary is a solid accent fill with accent-600 hover and accent-700 active; secondary is a divider-colored outline with a text tint on hover. Both use Caprasimo, not the body face, per the Organic .btn rule.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 shadcn is initialised against Tailwind v4 with components under a project-local path
- [x] #2 shadcn semantic variables are defined in terms of the Organic ramp variables, with no duplicated hex literals
- [x] #3 Button primary and secondary render identically to the prototype btn-primary and btn-secondary including hover and active states
- [x] #4 Dialog traps focus, closes on Escape and on backdrop click, and restores focus to the trigger
- [x] #5 A rendered sample of each installed primitive is checkable in the app or in a scratch route
- [x] #6 shadcn is initialised on Base UI (the current default), and no Radix-era asChild usage remains
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Run shadcn init on Base UI (-b base) against the existing project; expect it to rewrite app/globals.css, and restore the Organic base layer afterwards from git.
2. Add app/shadcn-tokens.css mapping shadcn's flat semantic variables (--background, --foreground, --primary, --border, --radius, ...) onto the Organic ramp via var() references only — no duplicated hex.
3. Install button, input, dialog, badge, sonner. Retune each to the prototype: Caprasimo on buttons, pill radius, accent-600/700 hover and active, divider-coloured secondary outline, surface-filled 36px pill input with accent caret.
4. Sweep the generated components for utilities the TASK-3 namespace resets removed (rounded-xl, shadow-xs, neutral-50/950) and map them onto Organic's steps.
5. Build app/_kitchen-sink as a dev-only scratch route rendering every primitive and state side by side.
6. Verify: typecheck, lint, format:check, build, plus a browser pass on the scratch route for the Dialog focus-trap, Escape, backdrop-click and focus-restore criteria.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
shadcn initialised on Base UI 1.7.0 with the nova preset. Installed button, input, dialog, badge, sonner; nothing else.

The init is destructive and its output was largely rejected. `shadcn init` rewrites app/globals.css and app/layout.tsx on the assumption that it owns the theme, and three of its changes were unacceptable:

  1. It emits '--color-accent: var(--accent)' in an @theme block placed after theme.css. shadcn's 'accent' means menu-hover tint; Organic's means the brand colour. Same name, unrelated jobs — and shadcn's landed last, so Organic's coral silently became a near-white grey. Verified in compiled CSS before reverting: the surviving definition was 'var(--accent)' = oklch(0.97 0 0), which would have made the focus ring, link hover and selection tint invisible on a near-white ground. None of the five installed components use shadcn's accent, so it is simply never defined and Organic keeps the name.
  2. It redefined the whole --radius-* namespace off its own --radius, undoing TASK-3's reset. Radius is handled per-component instead.
  3. It forced 'html { font-sans }' with Geist, overriding Figtree, and injected a Geist next/font call into the root layout.

globals.css and layout.tsx were reverted to their committed state and app/shadcn-tokens.css written by hand: every shadcn semantic name resolves to an Organic token via var(), no hex literal appears in the file. muted-foreground is neutral-700 rather than neutral-600 because it carries real body copy and neutral-600 measures 3.88:1, under AA. destructive is accent-700, since Organic has no destructive role and inventing a hex would leave the ramp.

Also rebound the 'dark' variant to an explicit '.dark' ancestor. Tailwind's built-in dark variant keys off prefers-color-scheme, so the dark: utilities baked into every shadcn component would have activated for anyone whose OS is set to dark — producing a half-dark control on a light page in a design with no dark mode. Same class of bug in sonner.tsx, which read the theme from next-themes with no provider mounted (resolves to 'system'); pinned to 'light'.

Component retuning is against Organic's .btn / .input / .tag / .dialog rules. Recurring fixes: 'outline-none' plus shadcn's 3px ring removed so the global :focus-visible outline is the single focus indicator (dropping one without the other would leave no indicator at all); 'font-medium' replaced with font-heading, since Caprasimo ships only weight 400 and font-medium asks for a synthesised fake bold; and rounded-xl / rounded-4xl / rounded-b-xl / shadow-xs mapped onto Organic's steps, since TASK-3's namespace reset means those utilities do not exist and would have rendered square corners or no shadow.

app/kitchen-sink is a dev-only route (notFound() in production) rendering every primitive, variant, size and state.

BLOCKED on AC #4 (dialog focus trap). Verified against Base UI 1.7.0 in a running dev server, reproducibly:

  - Opening the dialog by pointer leaves focus on the trigger. It never moves inside, measured immediately and again after 600ms. Base UI's own docs for Dialog.Popup say the default is 'focus moves to the first tabbable element inside the popup, except when the dialog is opened by touch' — this is a mouse open, so the observed behaviour contradicts the documented default.
  - Modality is enforced by focus guards at the portal boundary plus markOthers(), which is called with { ariaHidden: modal } and never with inert. aria-hidden hides content from assistive tech but does NOT remove it from the tab order. Confirmed in node_modules/@base-ui/react/floating-ui-react: the inert branch of applyAttributeToOthers is never reached from the dialog path.
  - Net effect: with focus left outside, Tab walks the entire page behind an open modal. Instrumented the focusin sequence — it visited 'Fire a toast', 'Success', an inline link and the Next.js dev overlay, all outside the dialog, before a guard finally pulled focus in on the 5th tab.

Ruled out as causes: React StrictMode (reproduced identically with reactStrictMode: false), and the retune itself (nothing in it touches Dialog.Root, Portal or the focus machinery — only classNames plus a variant=outline -> secondary swap).

Attempted fix that did NOT work: passing initialFocus={popupRef} to Dialog.Popup. Confirmed the dev server recompiled and the prop is in the served code; focus still stays on the trigger. The prop is left in place because it is correct and harmless, but it is not sufficient.

Verified as WORKING: Escape closes the dialog and releases the scroll lock (when focus is inside); backdrop click closes and releases the scroll lock; scroll lock applies on open, which proves modal={true} machinery is live. Focus restore to the trigger could not be assessed independently — focus was never inside to restore from.

Not yet verified: AC #3 hover and active states were confirmed by reading the emitted CSS, not by forcing :hover in the browser.

Upstream check on the AC #4 focus-trap blocker:

CONFIRMED as a known upstream bug. mui/base-ui issue #4678, 'Modal applies aria-hidden but doesn't remove focusable elements from tab order', filed April 2026, still OPEN. Independently matches the diagnosis reached here: FloatingFocusManager calls markOthers with ariaHidden but never inert, so background elements stay in the tab order while hidden from assistive tech. Flagged by axe-core and IBM Equal Access as a WCAG 2.1 SC 4.1.2 violation. Affects Dialog, AlertDialog and anything using modal FloatingFocusManager.

No version bump available: 1.7.0 is the latest published @base-ui/react.

Fix PR #4714 ('apply inert to background elements') is OPEN and stalled — last activity 27 June 2026, roughly six weeks ago. Reviewer mj12albert raised concerns about inert side effects citing prior floating-ui problems, and DrawerViewport tests are failing. Not landing soon.

Workaround documented in the issue itself: Base UI already stamps a 'data-base-ui-inert' marker on outside elements; mirror that marker to the inert property, skipping the focus-guard sentinels so the trap still works. PR #4714 takes the same approach with a data-base-ui-focus-guard exclusion.

CORRECTION to the earlier note in these notes: the second finding, 'opening by pointer leaves focus on the trigger', has NO matching upstream issue and should be treated as unconfirmed. Related closed PR #3541 shows openType detection has misfired before (openType not reported as touch on Safari), which makes it plausible that the synthetic CDP clicks used for testing were misclassified and took an unexpected initial-focus branch. The very first manual observation in this session did show focus landing on the input inside the dialog, which is the documented behaviour. Treat that finding as a probable test-harness artefact, not a library bug — the inert gap in #4678 is the real defect, and applying inert to the background also forces focus off a trigger that ends up inside an inert subtree.

AC #4 RESOLVED. Implemented the data-base-ui-inert mirror in lib/base-ui-inert.ts, driven from DialogContent.

Two things were harder than the issue's one-line description of the workaround:

1. The marker is not a modality signal, and aria-hidden cannot substitute for one. markOthers() stamps 'data-base-ui-inert' whenever the popup is open, independent of modal, so mirroring it unconditionally would freeze the page behind a deliberately non-modal dialog. The obvious gate — also require aria-hidden='true' — does not work, because Base UI runs two separate markOthers() passes with different inside-sets and the two attributes land on DIFFERENT elements: <main> gets the marker but no aria-hidden (it is kept in the walk path because it contains the trigger), while <main>'s children get aria-hidden but no marker. Verified in the DOM. Modality is therefore threaded down from Dialog root through context instead.

2. Release timing is load-bearing, and getting it wrong silently broke focus restore. Releasing inert on unmount is too late: closing with Escape has Base UI restore focus to the trigger while the trigger is still inside an inert subtree, so the focus call is dropped and focus falls to <body>. Confirmed by A/B — with the hook disabled, Escape restored to the trigger; with it enabled and releasing on unmount, it did not. Fixed by keying the hook to open state so React runs the cleanup during the commit that closes the dialog; cleanups run before effects, so the background is live again before Base UI restores focus.

Also skipped: focus guards (inerting them breaks the trap outright) and everything inside the portal (inerting the overlay would swallow the clicks that dismiss the dialog).

Verified in the browser after the fix:
  - Focus containment: instrumented the focusin sequence over 10 tabs with the dialog open. Zero real page controls reachable — the cycle is guard, the 4 dialog controls, guard. Before the fix the same probe reached 'Fire a toast', 'Success' and an inline link.
  - main.inert true while open; overlay, guards and popup all left untouched.
  - Escape closes, releases inert and the scroll lock, and restores focus to the trigger.
  - Close button closes and restores focus to the trigger.
  - Backdrop click closes and releases inert and the scroll lock. It does not return focus to the trigger, which is Base UI's own behaviour for pointer dismissal and is unchanged by this fix — confirmed identical before it was applied.
  - No stale inert left on page content afterwards. The one remaining [inert] node is Base UI's own InternalBackdrop, which it marks inert by design while closed.

AC #3 re-verified properly rather than by reading CSS. Hovered the real buttons: primary hover computes to #d93b45, exactly --color-accent-600, with Caprasimo 400, 999px radius and a #f7f6fb label (--color-bg), matching Organic's .btn-primary. Secondary hover computes to #26252c at 7% on a divider border, matching .btn-secondary. Active states confirmed present in the cascade resolving to --color-accent-700 and text at 14%; synthetic input cannot reliably produce :active, so those two are rule-level rather than interaction-level checks.

Full suite green: lint, typecheck, format:check, test (20 pass), production build.

Post-review fixes. All eight findings verified independently before acting; seven held, one was partly wrong.

1. HIGH — the space scale was hijacking the numeric utilities, not just adding tokens. Defining --spacing-1..8 in @theme rebinds every numeric Tailwind utility at those steps across padding, margin, gap, inset AND sizing, while undefined steps stay on the 4px multiplier. Verified in the built CSS: size-4 resolved to var(--spacing-4) = 17.6px, so every button icon rendered 10% oversized, while size-9 stayed 36px and gap-1.5 stayed 6px. Exactly the mixed-grid failure the radius and shadow resets exist to prevent — I had reasoned about it for --spacing in the TASK-3 notes and concluded 'deliberate', which was wrong because I only considered padding. Resetting --spacing is not viable (it would delete the scale shadcn is built on), so Organic's steps moved out of the namespace to --space-*, addressed explicitly as p-(--space-4). Re-verified: size-4 is now calc(var(--spacing)*4) = 16px, every numeric utility is on one grid, and all six Organic steps still emit.

2. MEDIUM — the ghost button's tighter padding was dead code. cva emits all  entries before any compound one, and within variants the size group comes after the variant group, so ghost's px-(--space-1) was always overridden by the size's px-*. Verified with cva directly, then moved to a compoundVariant scoped to the text sizes (the icon sizes are fixed squares with p-0 that inline padding would stretch). Measured after the fix: ghost padding-inline 4.4px vs 15.84px default.

3. MEDIUM — cn() silently failed to honour caller overrides for the custom theme keys. tailwind-merge's default config does not know 'pill'/'container' are radius values or h1..h6 font sizes, so both classes survived the merge and stylesheet order decided the winner — which was the component's, not the caller's. Verified: <Button className='rounded-md'> stayed a pill (.rounded-pill at offset 14854 vs .rounded-md at 14811) and <DialogTitle className='text-lg'> was ignored. Fixed with extendTailwindMerge registering both groups; re-verified last-wins in both directions and that it does not over-merge (rounded-pill + rounded-b-container and text-h4 + text-accent-700 both correctly survive). Colours needed no entry — tailwind-merge handles unknown colour values generically.

4. LOW, partly wrong as reported — the review said a function className is 'silently ignored with no compile-time signal' across Button, Badge and the Dialog wrappers. Checked each: Badge, Input and DialogContent already reject it at compile time. Button genuinely does not (it routes className through cva, whose props type is looser) and the Dialog wrappers accept a correctly-typed Base UI state callback that cn() then drops. Narrowed className to string on those via a StringClassName<T> helper, so misuse is a compile error rather than a no-op.

5-8. LOW — removed the dead 'cn-toast' class (defined nowhere, not in shadcn's stylesheet), removed the unused next-themes dependency, and moved the shadcn CLI to devDependencies since it is only needed at build time to resolve the CSS import.

Also fixed while in badge.tsx: the neutral variant used bg-neutral-100, which the Spinnerly override collapses to #ffffff — byte-identical to --color-surface, so the chip was invisible on every card, dialog and popover. Organic's own neutral-100 sits 1.22:1 against its surface; moved to the 200 step, which restores roughly that separation (1.13:1 on white). Same class of problem as the shadow tokens in TASK-3: a literal port loses the intent when the ramp step shifts.

CORRECTION to the AC #4 note above: the claim that keying the inert release to open state made Escape restore focus was based on a single passing trial and was wrong. Re-tested on a fresh load and it failed — focus went to <body>. Base UI restores focus synchronously on keydown, before React can run any cleanup, so no amount of release-ordering fixes it. Replaced with an explicit fallback: the hook now takes the trigger via a ref threaded through DialogTrigger, and after releasing inert it restores focus on a microtask, but only when focus actually fell to <body>, so it never fights a restore that worked. Re-verified across Escape (3 trials), the close button, and backdrop click — all restore to the trigger, and backdrop click now restores where it previously did not.

Re-verified after all fixes: containment still reaches zero real page controls over 10 tabs; main inert while open with overlay, guards and popup untouched; no stale inert on page content; ghost padding, badge visibility and hover states measured in the browser. Suite green — lint, typecheck, format:check, test (20 pass), production build.

Typo repair for the note above: item 2 should read 'cva emits all variants entries before any compound one'. The word was lost to shell substitution when the note was written.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 09:07
---
shadcn defaults changed since this task was written. As of July 2026 `shadcn init` defaults to Base UI, not Radix. Radix is NOT deprecated and remains fully supported via `shadcn init -b radix`, but take the default here.

Reasoning: Base UI is from the same people who built Radix, so the accessibility argument for adopting shadcn at all is unchanged. Our footprint is five components and only one of them is a real primitive — sonner is a standalone library either way, input and badge are plain markup, button is a styled element plus a render prop, and dialog is the only thing actually consuming the primitive layer. There is no migration risk worth spending a decision on.

The one API difference that will bite: Radix `asChild` is Base UI `render`. This matters for button, and for any Radix-era snippet copied off the web or out of an older tutorial. Component pages on ui.shadcn.com now open on the Base UI tab with Radix as the secondary tab, so make sure any reference being followed is on the right tab.

Base UI also ships primitives Radix never had (Combobox, Autocomplete, Number Field, Checkbox Group). None are needed for v1, but Combobox is the obvious candidate if the option list ever wants typeahead.
---

author: @claude
created: 2026-08-07 09:44
---
From TASK-3's review: the radius, elevation and neutral namespaces are now reset with '*: initial' before being redefined, so Tailwind's default steps outside Organic's scale no longer exist. Missing on purpose: rounded-xs/xl/2xl/3xl/4xl, shadow-2xs/xs/xl/2xl, neutral-50/950.

This matters here because shadcn primitives reach for exactly those — shadow-xs is its default for buttons and inputs, and rounded-xl is common in newer blocks. Pasted unchanged they will produce no border-radius or no shadow at all rather than a wrong-looking one. Map them onto Organic's three steps as part of the retune.

The reset is deliberate: before it, --radius-xl survived at 12px, so rounded-xl rendered a smaller corner than rounded-md at 16px. A silently-absent utility is recoverable; a silently-inverted scale is not.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Installed button, input, dialog, badge and sonner from shadcn on Base UI 1.7.0, themed from the Organic ramp rather than shadcn's defaults.

Most of what shadcn init generates was rejected. It rewrites globals.css and layout.tsx on the assumption that it owns the theme, and one change was actively harmful: it emits a --color-accent binding that lands after theme.css, so Organic's coral silently became a near-white grey and took the focus ring, link hover and selection tint with it. app/shadcn-tokens.css is hand-written instead, mapping every semantic name onto an Organic token through var() with no hex literals, and rebinding the dark variant to an explicit .dark ancestor so the dark: utilities baked into every shadcn component cannot fire on a design that has no dark mode.

Components are retuned to Organic's .btn, .input, .tag and .dialog rules, with the shadcn focus ring removed in favour of the global :focus-visible outline, the display face restored on buttons, and the radius and shadow steps that TASK-3's namespace resets removed mapped back onto Organic's scale.

Two accessibility problems were found and fixed beyond the retune. Base UI's modal dialog leaves the background in the tab order (mui/base-ui#4678, open upstream, fix PR stalled since June 2026), so tabbing behind an open dialog reached real page controls; lib/base-ui-inert.ts mirrors the upstream fix from the outside and deletes cleanly when it lands. And Organic's space scale was defined in Tailwind's --spacing-* namespace, which rebinds numeric sizing utilities as well as spacing — button icons were rendering 10% oversized — so it moved to --space-*.

Verified in a browser against a running dev server rather than only by inspection: focus containment reaches zero real page controls over ten tabs; Escape, close button and backdrop click all close, release inert and the scroll lock, and restore focus to the trigger; primary hover computes to accent-600 and secondary to text at 7%, matching the prototype exactly. Suite green throughout — lint, typecheck, format:check, test (20 pass), production build.

app/kitchen-sink is a dev-only route rendering every primitive, variant, size and state for visual review. Merged to main as 354c667.
<!-- SECTION:FINAL_SUMMARY:END -->
