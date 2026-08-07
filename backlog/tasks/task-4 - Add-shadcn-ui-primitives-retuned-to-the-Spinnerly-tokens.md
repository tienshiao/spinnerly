---
id: TASK-4
title: Add shadcn/ui primitives retuned to the Spinnerly tokens
status: To Do
assignee: []
created_date: '2026-08-07 08:35'
updated_date: '2026-08-07 09:44'
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
- [ ] #1 shadcn is initialised against Tailwind v4 with components under a project-local path
- [ ] #2 shadcn semantic variables are defined in terms of the Organic ramp variables, with no duplicated hex literals
- [ ] #3 Button primary and secondary render identically to the prototype btn-primary and btn-secondary including hover and active states
- [ ] #4 Dialog traps focus, closes on Escape and on backdrop click, and restores focus to the trigger
- [ ] #5 A rendered sample of each installed primitive is checkable in the app or in a scratch route
- [ ] #6 shadcn is initialised on Base UI (the current default), and no Radix-era asChild usage remains
<!-- AC:END -->

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
