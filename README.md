# Spinnerly

A lightweight web app for group decision-making. One person creates a wheel of
options, shares a link, friends suggest additions, the creator curates the list
and spins.

Canonical use case: a group deciding where to eat.

**Status:** scaffolded. The design is settled and the app skeleton runs; no
feature is implemented yet.

---

## Design principles

- **No accounts.** Creating a wheel takes one click. Access is by URL, not login.
- **Small surface area.** Edit the list, spin the wheel. Everything else is
  phase 2 or never.
- **Ephemeral by default.** Wheels are disposable artifacts, not saved documents.
- **Responsive, mobile-first for participants.** The share link gets pasted into
  a group chat, so most participants arrive on a phone.

## Roles

There is no identity. Your role is entirely determined by which URL you hold.

| Role            | Has                        | Can                                                 |
| --------------- | -------------------------- | --------------------------------------------------- |
| **Editor**      | Edit URL (contains secret) | Read, edit options, accept/reject suggestions, spin |
| **Participant** | Share URL                  | Read, submit suggestions, watch                     |

```
Edit:   https://spinnerly.app/w/{shareId}#e={editToken}
Share:  https://spinnerly.app/w/{shareId}
```

The edit token lives in the **URL fragment**, never the path or query. Fragments
are not sent to servers, so the token stays out of `Referer` headers, access
logs, analytics, and any error reporter added later. It also means the edit
view cannot be server-rendered — see [the design doc](docs/spin-the-wheel-design.md#the-edit-page-cannot-be-server-rendered)
before you try to "fix" that.

The edit URL is a transferable bearer capability, so **two concurrent editors is
a supported case, not an edge case.** Every option mutation is granular and
commutes; the `options` array is never written wholesale.

---

## Stack

| Layer     | Choice                  | Why                                                                  |
| --------- | ----------------------- | -------------------------------------------------------------------- |
| Framework | Next.js (App Router)    | Server-rendered OG metadata — sharing is the product                 |
| Styling   | Tailwind v4 + shadcn/ui | Design tokens as theme variables; shadcn for a handful of primitives |
| Database  | Firestore               | Live reads via `onSnapshot`, no websocket layer to build             |
| Hosting   | Vercel                  | Zero-config deploys, `nodejs` runtime by default, free previews      |

### The core architectural decision

**Writes go through an API. Reads go direct to Firestore.**

```
                  ┌──────────────────────────┐
                  │        Browser           │
                  └───────┬──────────┬───────┘
                          │          │
              writes      │          │   reads (onSnapshot)
       (HTTPS + Bearer)   │          │   direct, live
                          ▼          │
              ┌──────────────────┐   │
              │  Next.js         │   │
              │  route handlers  │   │
              │  Admin SDK       │   │
              └────────┬─────────┘   │
                       │             │
                       ▼             ▼
              ┌──────────────────────────┐
              │        Firestore         │
              │  client writes: DENIED   │
              │  client reads:  get only │
              └──────────────────────────┘
```

Every client write is denied at the rules layer. Writes hit a route handler
using the Admin SDK, which bypasses rules and does its own authorization
against the edit token. This buys everything security rules cannot express:
suggestion dedupe, length filtering, atomic accept-and-remove, and a
server-side RNG for phase-2 spins.

It costs **latency compensation**. Firestore normally echoes a client's own
write to its local cache before the round trip; routing through an API makes the
path client → API → Firestore → snapshot back. The editor UI must hold
optimistic local state or editing will feel laggy. This is the single most
likely "why does this feel bad" regression in the whole project.

### Two constraints worth memorising

- **`runtime = 'nodejs'` on every route that touches Firestore.** The Firebase
  Admin SDK uses gRPC over native bindings and does not run on edge. Nothing
  here moves to edge later.
- **`allow list: if false` is the entire security model.** Rules are not
  filters. With `list` permitted, anyone can enumerate the whole `wheels`
  collection, secret IDs included. Denying `list` is what makes an unguessable
  ID an actual secret.

---

## Design system

The UI is built from **Organic**, a warm rounded design system shipped in the
Claude Design handoff bundle, retuned to a cooler Spinnerly palette. Every page
in the prototype overrides Organic's cream-and-terracotta defaults, so **the
override is the shipped palette**, not the Organic base.

- Ground `#f7f6fb`, ink `#26252c`, accent coral `#f2545b`, second accent blue `#3fa7d6`
- Full 100–900 tonal ramps for neutral, accent and accent-2, generated in OKLCH
  on one shared lightness scale
- **Caprasimo** for headings, **Figtree** for body
- Over-rounded: `--radius-lg` (28px) for containers, `999px` for buttons,
  inputs and tags
- The ten-color wheel slice palette is separate from the theme ramps and lives
  with the wheel component

Source of truth: `docs/spin-the-wheel-editor/project/_ds/organic-*/styles.css`
and its `readme.md`. Take colors, spacing, radii and shadows from the token
variables; never hard-code a value a token already carries.

### On shadcn/ui

Adopted, but **selectively**. The design does not stray far from what shadcn can
express — pill radii and custom fonts are token-level changes, and shadcn is
designed to be rethemed exactly that way. Install `button`, `input`, `dialog`,
`badge` and `sonner`, map shadcn's flat semantic variables (`--primary`,
`--background`, `--radius`) onto the Organic ramp so the ramp stays the single
source of truth, and stop there.

The value is the accessible primitive layer underneath: focus trapping, Escape
handling and toast announcement are the parts that are genuinely expensive to
hand-roll correctly. The wheel, the option rows, the suggestion cards and the
confetti are bespoke — don't force them through shadcn, and don't pull in
components the app doesn't use.

**Base UI, not Radix.** As of July 2026 `shadcn init` defaults to Base UI; Radix
is still fully supported and reachable with `-b radix`, but there's no reason to
opt out here. Base UI is from the people who built Radix, so the accessibility
argument above is unchanged, and our footprint is tiny enough that the choice
barely matters: `sonner` is a standalone library either way, `input` and `badge`
are plain markup, and `dialog` is the only real primitive we consume. The one
API difference that will bite is that Radix's `asChild` is Base UI's `render` —
relevant to `button`, and to any Radix-era snippet copied off the web.

Where shadcn does strain against this design: Organic's per-role 100–900 ramps
carry more structure than shadcn's flat `primary`/`secondary`/`muted` tokens. Map
onto the ramp rather than flattening it.

---

## Repository layout

```
app/
  page.tsx                        Landing (TASK-22)
  w/[shareId]/page.tsx            Wheel page (TASK-17)
  api/                            Route handlers — Node runtime, Admin SDK
lib/firebase/
  admin.ts                        Admin SDK — server-only, the write path
  client.ts                       Client SDK — client-only, reads only
scripts/
  seed-emulator.mjs               Fixture data for a fresh emulator
firebase.json, .firebaserc        Emulator config; demo-spinnerly is local-only
eslint-rules/                     Local lint rules enforcing design invariants
docs/
  spin-the-wheel-design.md        The design doc. Read this first.
  spin-the-wheel-editor/          Claude Design handoff bundle
    README.md                     Handoff instructions
    project/
      Home.dc.html                Landing page prototype
      Wheel.dc.html               The primary design — wheel page, both roles
      OG Image.dc.html            Marketing unfurl card (1200x630)
      OG Image - Shared Wheel...  Per-wheel unfurl card (1200x630)
      _ds/organic-*/              Design system: tokens, components, guidance
backlog/                          Backlog.md tasks, decisions and docs
```

The prototypes are **HTML/CSS/JS mockups, not production code**. Recreate their
visual output in React; don't port their internal structure.

---

## Getting started

Requires Node 22+, npm, and a JDK 11+ for the Firestore emulator.

```bash
npm install
npm run dev:emulator
```

That starts the Firestore emulator, seeds it with a wheel, and runs the dev
server against it. **There is no setup step and no secret to obtain** — see
below.

| Command                 | What                                             |
| ----------------------- | ------------------------------------------------ |
| `npm run dev:emulator`  | Emulator + seed + dev server, one command        |
| `npm run dev`           | Dev server only (expects an emulator already up) |
| `npm run emulator`      | Emulator only, left running across restarts      |
| `npm run seed`          | Reseed a running emulator                        |
| `npm run build`         | Production build; fails on type errors           |
| `npm run typecheck`     | `tsc --noEmit`                                   |
| `npm run lint`          | ESLint, including the local `spinnerly/*` rules  |
| `npm test`              | Vitest `unit` project — runs on a bare install   |
| `npm run test:emulator` | Vitest `emulator` project, against Firestore     |
| `npm run test:all`      | Both                                             |
| `npm run format`        | Prettier write                                   |
| `npm run format:check`  | Prettier check                                   |

Two more exist for deployed environments only, and neither is part of any local
workflow — see [§8](docs/spin-the-wheel-design.md#the-ttl-policy-resolved):

| Command                                   | What                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm run ttl:check -- --project <id>`     | Report TTL policy state; non-zero if any collection group is uncovered |
| `npm run ttl:configure -- --project <id>` | Apply the missing policies                                             |

Next.js 16 with the App Router, React 19, Tailwind v4, TypeScript 6 in strict
mode.

### Local development runs on the emulator

There is **no local Firebase project and no service account on your machine**
(design doc decision 19). Local work runs entirely against the Firebase Emulator
Suite; the cloud projects exist only for deployed environments.

This is a credential-blast-radius decision. With `FIRESTORE_EMULATOR_HOST` set,
the Admin SDK skips credential resolution entirely — there is nothing to
authenticate against — so the service account private key lives in exactly one
place, the Vercel dashboard, and never touches a laptop. It also makes the
security rules unit-testable rather than pokeable-by-hand, which matters when
`allow list: if false` is the entire security model.

Everything the emulator needs is committed in `.env.development`, because none
of it is a secret. `.env.example` documents the full set, including the
deployed-only variables you will never need locally.

- **The `demo-` project ID prefix is load-bearing.** The emulator treats
  `demo-spinnerly` as strictly local and refuses to contact Google, so a
  misconfigured client cannot reach a real project — and the client needs no
  real API key. Do not "fix" the project ID in `.firebaserc`.
- **Emulator data is discarded on exit.** `npm run seed` rebuilds the fixture in
  about a second, which is why there is no exported snapshot in the repo. The
  seeded wheel's share and edit URLs are printed when it runs.
- The emulator UI is at <http://127.0.0.1:4001>. Not Firebase's default 4000 —
  that port is commonly taken by other dev tooling, and the emulator treats the
  clash as a hard startup failure rather than falling back.
- `firebase-tools` is a pinned devDependency, not a global install, so CI gets
  the same version. Run it via `npm run`, or `npx firebase` for anything else.
- Security rules are not wired into `firebase.json` yet, so the emulator runs
  open and says so on startup. TASK-6 adds `firestore.rules` and the
  `@firebase/rules-unit-testing` suite.

#### `firebase-tools` is pinned to 14.18.0, and that is a Java decision

14.19.0 raised the emulator's Java floor from 11 to 21 —
`MIN_SUPPORTED_JAVA_MAJOR_VERSION` in `lib/emulator/commandUtils.js`, enforced
as a hard throw before any emulator starts. The
[install-and-configure docs](https://firebase.google.com/docs/emulator-suite/install_and_configure)
still say Java 11+, which was true until October 2025 and has been wrong since.

14.18.0 is the last release that runs on a JDK 17, which is what this project
targets. Bumping past it is not a version bump — it is a "everyone installs a
new JDK, and CI grows a `setup-java` step" bump. Do it deliberately, together
with TASK-6's rules-test job, not incidentally.

### The two SDK modules

The read/write split from the design doc is two modules, and each one is fenced
off from the other side:

| Module                   | SDK              | Guard                                                    |
| ------------------------ | ---------------- | -------------------------------------------------------- |
| `lib/firebase/admin.ts`  | `firebase-admin` | `server-only` — importing it client-side fails the build |
| `lib/firebase/client.ts` | `firebase`       | `client-only` — importing it server-side fails the build |

Both initialise lazily and cache on `globalThis`. That is not tidiness: `next
dev` re-evaluates modules while the process lives on, so `initializeApp` at
module scope throws "The default Firebase app already exists" on the second hot
reload. The same cache is what lets a warm lambda reuse its gRPC channel.

`lib/firebase/client.ts` exports a Firestore handle and nothing that writes, and
`connectFirestoreEmulator` runs inside the same lazy init that creates the
instance — it throws if it runs after any other call on that instance, so there
must be no window in which a caller can obtain an unconnected handle.

### The client has no write path, and it is linted

`spinnerly/no-client-firestore-writes` errors on any write function imported
from `firebase/firestore` — `setDoc`, `addDoc`, `updateDoc`, `deleteDoc`,
`writeBatch`, `runTransaction`, and the `arrayUnion`/`increment`/
`serverTimestamp` field transforms, which are the tell that a write is being
assembled even when the call that sends it is elsewhere.

The rule exists because the runtime symptom is uninformative rather than loud.
A client write is denied at the rules layer, asynchronously, inside a promise
nobody awaited — the UI just quietly stops updating. Lint turns that into a
message naming the endpoint to use instead.

Like the runtime rules it handles the forms a naive check misses: aliased
imports (`updateDoc as touch`), namespace imports and their computed member
access, destructuring off a namespace, a namespace laundered through a chain of
local consts, `await import()` with no binding at all, `require()`, the internal
`@firebase/firestore` spelling, and re-export barrels — both
`export { setDoc } from …` and `export *`, which are the nastiest case because
they put a write one import away while ensuring nothing downstream ever mentions
`firebase/firestore` again.

### TypeScript is pinned to 6, deliberately

TypeScript 7 is `latest` on npm and Next.js 16 supports it, so this looks like
being out of date. It isn't. **TS 7 is the native port and does not ship the
JavaScript compiler API** — its package `exports` map resolves `typescript` to a
version stub, with the real surface behind `typescript/unstable/*`. Any tool that
does `require('typescript')` breaks until it migrates: typed ESLint rules,
ts-morph, codemod tooling, API extractors.

TS 6 is the last release of the JavaScript-based line and is stable (6.0.3), not
a beta. It gets us current language features while every tool in the ecosystem
still works.

Revisit when the tools we actually depend on have shipped TS 7 support — not
when 7 merely goes stable. `next build` supports both: it shells out to the
project-local `tsc` by default, which is what makes either version work.

`backlog/` and `docs/spin-the-wheel-editor/` are excluded from both Prettier and
ESLint — the first is CLI-managed, the second is an exported bundle that would
lose its diff against a future re-export.

### The runtime invariant is linted, not assumed

The Firebase Admin SDK uses gRPC over native bindings and cannot run on the Edge
Runtime. Next.js 16 already defaults to `nodejs` and deprecates `edge`, so this
is belt-and-braces — but it's cheap and the failure mode is a deploy-time
surprise:

- `spinnerly/no-edge-runtime` — an exported `runtime = 'edge'` errors anywhere.
- `spinnerly/require-nodejs-runtime` — every route segment under `app/api`, plus
  any route segment reaching the Admin SDK, must declare
  `export const runtime = 'nodejs'`.
- `spinnerly/no-client-firestore-writes` — see
  [The client has no write path](#the-client-has-no-write-path-and-it-is-linted).

The second rule is scoped to **route segments** (`route.ts`, `page.tsx`,
`opengraph-image.tsx`, …) because that is the only place Next.js reads the
export — requiring it in `lib/firebase/admin.ts` would be cargo cult.

"Reaching the Admin SDK" counts `lib/firebase/admin` as well as `firebase-admin`
itself, and that distinction is load-bearing. The wrapper is the _intended_
spelling, so a rule that only recognised the raw package would have exempted
every segment that followed the convention — including `page.tsx` and
`opengraph-image.tsx` under `app/w/[shareId]`, which are exactly the
server-reading segments the design doc plans for.

Both rules are defined in `eslint-rules/index.mjs` and covered by
`eslint-rules/index.test.mjs` (`npm test`). The tests are not optional decoration:
the first draft of these rules was bypassed by `export const runtime = 'edge' as
const`, which is the _idiomatic_ spelling for Next route config, so the rule
missed the exact case it existed to catch.

---

## Working on this

This project uses [Backlog.md](https://backlog.md) for task management. Run
`backlog task list --plain` to see the work, and `backlog task view TASK-n
--plain` to read one. Do not edit files under `backlog/` by hand — use the CLI
so metadata and history stay consistent.

**Where the prototype and the design doc disagree, the doc wins.** The prototype
is a visual reference, not a specification. All seven known conflicts are settled
as decisions 10–16 in [§10](docs/spin-the-wheel-design.md):

|                            | Decision                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Option labels              | Not editable in place — remove and re-add. Keeps every mutation commutative                                 |
| Rejected suggestions       | Hard delete, no tombstone, no "Declined" chip                                                               |
| Suggestion attribution     | None in v1 — identity arrives deliberately with chat in phase 2                                             |
| Participants seeing a spin | No in v1, and the copy must not imply otherwise                                                             |
| Mobile                     | Responsive throughout, participant view mobile-first                                                        |
| "Picked" chip              | Local-only client state, gone on refresh, no schema                                                         |
| Editor affordances         | Title inline in the header, `suggestionsOpen` in the Suggestions panel, duplicate in a header overflow menu |
| Duplicate naming           | Title copied verbatim — no "(copy)" suffix. The URL is the identifier, not the title                        |

No task is blocked. `TASK-1` holds the two remaining open questions from §11 —
OG image content and whether to warn about expiry — and neither gates
implementation.

Rough order after that: scaffold and tokens (TASK-2 – TASK-4) → Firebase, rules
and the auth library (TASK-5 – TASK-8) → API routes (TASK-9 – TASK-14) →
client (TASK-15 – TASK-22) → sharing and launch (TASK-23 – TASK-26).

### Before launch — non-negotiable

Three items in the design doc are cheap now and expensive or impossible later:

1. **App Check** (TASK-24). Trivial config on day one, a lockstep client
   migration afterwards. With rate limiting deferred out of v1, this is the
   primary abuse defense, not a secondary one.
2. **The Firestore TTL policies** (TASK-14). Trivial at creation time and
   impossible to retrofit onto data users have already been told we would keep.
   Configured by `npm run ttl:configure -- --project <id>`, once per
   environment, and **verified** by `npm run ttl:check` reporting `ACTIVE` for
   all three collection groups — `wheels`, `wheelSecrets` and `suggestions`.
   Three, because a TTL delete does not cascade to subcollections and because a
   secret outliving its wheel is a wheel nobody can ever shut off. Nothing in
   the app depends on a policy existing, so a missing one fails silently: wheels
   keep working and simply never go away.
3. **A Firestore budget alert** (TASK-25). Public write is a billing surface.
   This is the tripwire that tells us the rate-limiting deferral has stopped
   being safe.

---

## Not in v1

User accounts, profiles, wheel history, weighted options, elimination mode,
multi-round tournaments. Synchronized live spins and chat are phase 2 — see
[design doc §9](docs/spin-the-wheel-design.md).
