---
id: TASK-2
title: Scaffold the Next.js App Router project
status: Done
assignee: []
created_date: '2026-08-07 08:35'
updated_date: '2026-08-07 09:17'
labels: []
dependencies: []
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stand up the application skeleton. Next.js App Router with TypeScript and Tailwind v4, which is the framework decision recorded in design doc section 10 (server-rendered OG metadata is the deciding factor).

Routes to stub now so later tasks have somewhere to land:
- app/page.tsx (landing)
- app/w/[shareId]/page.tsx (wheel, viewer-renderable shell)
- app/api/... route handlers

Every route handler that touches Firestore must export runtime = "nodejs". The Firebase Admin SDK uses gRPC over native bindings and does not run on edge. This is not a thing to revisit later, so encode it from the start.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 TypeScript strict mode is on and the build fails on type errors
- [x] #2 Tailwind v4 is installed and a utility class applied in app/page.tsx takes effect
- [x] #3 ESLint and Prettier run clean via a documented script
- [x] #4 A lint rule or a documented convention requires runtime = "nodejs" on any route handler importing firebase-admin
- [x] #5 npm run dev serves the app locally and npm run build succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Scaffold create-next-app (Next 16.3, React 19.2, TS, Tailwind v4, ESLint, App Router, no src dir) into a temp dir and merge in, preserving the existing README.md and CLAUDE.md.
2. Project identity: package.json name and scripts, root layout metadata.
3. Stub the three route shapes later tasks land on: app/page.tsx, app/w/[shareId]/page.tsx, app/api/wheels/route.ts.
4. Add Prettier, wire eslint-config-prettier so the two do not fight, and add lint / format / typecheck scripts.
5. Add a local ESLint plugin enforcing the runtime invariant, and verify it by linting a deliberate violation.
6. Verify: typecheck, lint, format check, production build, dev server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Scaffolded with create-next-app: Next 16.3.0, React 19.2.8, TypeScript strict, Tailwind v4, ESLint 9 flat config, App Router, no src dir, import alias @/*. Generated into a temp dir and merged in so the existing README.md and CLAUDE.md survived.

Added: Prettier (no semicolons, single quotes, trailing commas, 80 col) with prettier-plugin-tailwindcss and eslint-config-prettier last in the flat config; scripts for lint, lint:fix, format, format:check, typecheck.

Stubs: app/page.tsx (landing, TASK-22), app/w/[shareId]/page.tsx (wheel shell, TASK-17), app/api/wheels/route.ts (returns 501, TASK-9).

Local ESLint plugin at eslint-rules/index.mjs with two rules, wired as spinnerly/no-edge-runtime and spinnerly/require-nodejs-runtime.

Verified: npm run build passes and fails correctly on a deliberate type error; lint clean; format:check clean; typecheck clean; dev server serves / with Tailwind utilities present in the compiled CSS, /w/abc123 renders the shareId, POST /api/wheels returns 501. Both lint rules verified against a deliberate violation file that was then deleted.

Prettier reformatted README.md, CLAUDE.md and docs/spin-the-wheel-design.md (markdown tables and emphasis markers only; prose line wrapping preserved). backlog/ and docs/spin-the-wheel-editor/ are excluded from both Prettier and ESLint.

TypeScript pinned to ^6.0.3 (user decision, 2026-08-07) rather than the create-next-app default of ^5 or the npm latest of 7.x.

TS 7 is the native port and does not ship the JavaScript compiler API: its package exports map resolves the "typescript" entry to ./lib/version.cjs, a version stub, with the real surface behind typescript/unstable/*. Anything calling require("typescript") breaks until it migrates — typed ESLint rules, ts-morph, codemod tooling, API extractors. TS 6 is the last release of the JavaScript-based line and is stable at 6.0.3, not a beta despite 6.0.0-beta still holding the npm beta tag.

Next 16.3 supports both. next build shells out to the project-local tsc CLI by default (experimental.useTypeScriptCli, on by default), which is what makes either version work; setting it false while on TS 7 makes next build exit outright. Verified: build, typecheck, lint and format:check all pass on 6.0.3.

Post-review fix (code review on the untracked working tree). The first draft of the ESLint rules was substantially broken; all seven findings addressed and the rules rewritten.

Root cause of findings 1, 2 and 6: findRuntimeExport recognised exactly one AST shape (node.init.type === "Literal"). Fixed by normalising through unwrap() for TSAsExpression / TSSatisfiesExpression / TSTypeAssertion / TSNonNullExpression and staticString() for single-quasi template literals, plus tracking export { runtime } specifiers separately from inline export declarations.

- Finding 1 (high): export const runtime = "edge" as const lint clean. Confirmed independently before fixing. This is the idiomatic TS spelling for Next route-segment config, so the rule missed the exact case it existed to catch.
- Finding 2: the mirror false positive, runtime = "nodejs" as const reported as missing.
- Finding 3: the rule keyed on a direct firebase-admin import, which forces a meaningless runtime export into lib modules (Next ignores it outside a route segment) while missing the route handler that imports the wrapper. Re-scoped: applies only to route-segment files, triggered by being under app/api (every endpoint in this app reaches Firestore per design doc section 3) or by a direct firebase-admin import in a segment.
- Finding 4: the docblock in app/api/wheels/route.ts claimed enforcement that did not apply to that file. Now genuinely enforced via the app/api trigger; verified that deleting the pin fails lint.
- Finding 5: dynamic import() and require() were invisible. Both now detected.
- Finding 7: the ?? program fallback was dead. It is now reachable by design, since the app/api trigger fires with no adminImport node to point at.

Added eslint-rules/index.test.mjs with 20 RuleTester cases over node:test, and an npm test script. Regression cases for as const, template literals, export { runtime }, dynamic import, require, lib-module exemption, and non-API pages.

Verified after rewrite: npm test 20/20, lint, format:check, typecheck and build all clean. Behaviour re-verified against the real project files rather than fixtures only.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:56
---
Package manager is npm, not pnpm (user decision, 2026-08-07). Acceptance criterion 1 updated. Any later task referring to pnpm should be read as npm.
---

created: 2026-08-07 09:09
---
Two upstream facts discovered after this task was written, both recorded in CLAUDE.md so later tasks inherit them:

1. TypeScript is pinned to ^6 deliberately. Do not bump to 7 — see implementation notes.
2. shadcn/ui defaults to Base UI as of July 2026, not Radix. TASK-4 has the detail.
---

created: 2026-08-07 09:17
---
Worth knowing for later tasks: a lint rule asserting an invariant is worthless until a test proves it fires. These two rules passed a manual spot-check on the naive `runtime = "edge"` spelling and were still bypassable by the idiomatic `as const` form. TASK-7 (editor authorization) has the same shape of risk — the acceptance criterion "editor of wheel A receives 403 on wheel B" needs to be a real test, not a code read.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Next.js 16.3 App Router skeleton on React 19.2, TypeScript strict, Tailwind v4 and ESLint 9 flat config, merged into the existing repo so README.md, CLAUDE.md, docs/ and backlog/ survived. Stub routes for the landing page, /w/[shareId] and POST /api/wheels give every later task a place to land. Prettier added and wired so it and ESLint do not fight; backlog/ and the Claude Design bundle are excluded from both.

The runtime invariant from design doc section 3 is enforced by a local ESLint plugin rather than left as a convention: spinnerly/no-edge-runtime bans the Edge Runtime outright, and spinnerly/require-nodejs-runtime requires an explicit nodejs pin in any module importing firebase-admin. Both were verified against a deliberate violation.

Verified: build passes and fails correctly on an injected type error; lint, format:check and typecheck clean; dev server serves the landing page with Tailwind utilities in the compiled CSS, renders the dynamic shareId route, and returns 501 from the stubbed API route.
<!-- SECTION:FINAL_SUMMARY:END -->
