<!-- BACKLOG.MD GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Use the detailed guides when needed:

- `backlog instructions task-creation` for creating or splitting tasks
- `backlog instructions task-execution` for planning and implementation workflow
- `backlog instructions task-finalization` for completion and handoff

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

@AGENTS.md

## Project conventions

**Package manager is npm.** Some task descriptions written before this was
settled say `pnpm`; read them as `npm`.

**TypeScript is pinned to 6 on purpose — do not bump it to 7.** TS 7 is the
native port and does not ship the JavaScript compiler API (`typescript` resolves
to a version stub; the real surface is `typescript/unstable/*`), so anything
doing `require('typescript')` breaks — typed ESLint rules, ts-morph, codemods,
API extractors. TS 6 is the last JavaScript-based line and is stable. Revisit
only when the tools this project depends on have shipped TS 7 support.

**shadcn/ui is on Base UI, not Radix** (Base UI became the `shadcn init` default
in July 2026). Radix `asChild` is Base UI `render` — watch for this when copying
snippets from older tutorials, and check which tab a ui.shadcn.com example is on.

**Read `docs/spin-the-wheel-design.md` before changing anything architectural.**
Its §10 decisions table is binding. Where the Claude Design prototype in
`docs/spin-the-wheel-editor/` disagrees with that doc, the doc wins — the
prototype is a visual reference, not a specification.

### Commands

| Command                 | What                                            |
| ----------------------- | ----------------------------------------------- |
| `npm run dev`           | Dev server                                      |
| `npm run build`         | Production build; fails on type errors          |
| `npm run typecheck`     | `tsc --noEmit`                                  |
| `npm run lint`          | ESLint, including the local `spinnerly/*` rules |
| `npm run format`        | Prettier write                                  |
| `npm run format:check`  | Prettier check                                  |
| `npm test`              | Vitest `unit` project — runs on a bare install  |
| `npm run test:watch`    | Same, in watch mode                             |
| `npm run test:emulator` | Vitest `emulator` project, against Firestore    |
| `npm run test:all`      | Both                                            |

**The runner is Vitest**, configured in `vitest.config.mts` as two projects.
Tests are split by what they _need_, not by what they cover:

- `*.test.ts` — the default. No external dependencies, so `npm test` stays
  runnable with nothing but `npm install`: no Java, no emulator. Name a test
  this way unless it needs Firestore.
- `*.emulator.test.ts` — opts out of the default project and into one that
  `npm run test:emulator` runs under `firebase emulators:exec`.

The direction is deliberate: `unit` takes everything and the emulator suffix
opts out. Were it the other way round — `unit` opting in on a `*.unit.test.ts`
suffix — an ordinary `foo.test.ts` would match neither project and be run by
nothing at all, giving a green `npm test` that silently skipped a file. As it
stands the worst a misnamed file can do is run in `unit` and fail loudly for
want of an emulator.

Two config details that look optional and are not.

`server-only` is **aliased** to the package's own empty entry, because
`lib/wheels/store.ts` imports it and the default entry throws by design. Do not
"fix" this by setting `resolve.conditions: ['react-server']` instead — that key
_replaces_ Vite's default condition list rather than extending it, and applies
to every dependency in both projects. React then resolves to its
`react.react-server` build where every hook is `undefined`, so the first
component test anyone writes fails with "useState is not a function" and reads
as a React version problem rather than a config one.

And the config is `.mts` because this package is not `"type": "module"`, so a
`.ts` config gets loaded as CommonJS and warns.

**A test needing a DOM declares `// @vitest-environment jsdom` on its first
line.** There is no third project for it, and adding one would be a mistake: the
split above is by what a test needs from _outside_ the install — Java, a running
emulator — and jsdom is just a devDependency. A file keeps whichever project its
name puts it in, so `lib/wheels/use-wheel.test.ts` runs under `npm test` and
`lib/wheels/use-wheel.emulator.test.ts` under `npm run test:emulator`, both in
jsdom. React component and hook tests use `@testing-library/react`.

Two things that are true and surprising: the Firebase **client** SDK works
inside jsdom against the emulator, which is what
`lib/wheels/use-wheel.emulator.test.ts` relies on; and `firebase emulators:exec`
does not load `.env.development`, so that test derives the `NEXT_PUBLIC_*`
values the client SDK needs from `FIRESTORE_EMULATOR_HOST`, which
`emulators:exec` does set. Derive rather than hard-code — the emulator does not
always come up on the port you expect.

**Assertions are Vitest's `expect`.** Not `node:assert` — keep new tests
consistent with the existing suites. Three conventions worth following:

- `expect(value, 'why this matters')` takes a message as its second argument.
  Use it where the matcher's own output would not say enough.
- **Table-driven cases use `it.each` rather than a `for` loop.** Each row
  becomes its own named test, so a failure names the case instead of the loop.
  Prefer the object form with a `label` and `'... $label'` in the title.
- If a table needs a fixture built in `beforeAll`, wrap the value in a thunk.
  `it.each` evaluates its table at collection time, before any hook has run, so
  referencing the fixture directly gets `undefined`. See the 401 cases in
  `lib/wheels/store.emulator.test.ts`.

### The runtime invariant

The Firebase Admin SDK uses gRPC over native bindings and cannot run on the Edge
Runtime. Next.js 16 already defaults to `nodejs` and deprecates `edge`, but the
constraint is load-bearing enough to be enforced rather than assumed:

- `spinnerly/no-edge-runtime` — an exported `runtime = 'edge'` is an error anywhere.
- `spinnerly/require-nodejs-runtime` — every route segment under `app/api`, plus
  any route segment importing `firebase-admin` directly, must declare
  `export const runtime = 'nodejs'`.

Both live in `eslint-rules/index.mjs`, with tests in `index.test.mjs`. If you
change either rule, run `npm test`. Both handle `as const`, template literals,
`export { runtime }`, dynamic `import()` and `require()` — a naive
`node.type === 'Literal'` check silently misses all of them.

### The authorization invariant

Editor auth answers **"is this THIS wheel's token?"**, never "is this A valid
token?". The secret is fetched by document ID — `wheelSecrets/{shareId}`, with
`shareId` taken from the request path and nowhere else. A query across
`wheelSecrets` filtering on `editTokenHash` validates a token globally and hands
an editor of wheel A write access to wheel B. Design doc §6 calls it out as easy
to reintroduce when refactoring auth into shared middleware, so
`spinnerly/no-wheel-secret-queries` fails lint on that shape.

`lib/wheels/store.ts` is the only module that should ever touch `wheelSecrets`.
Route handlers call `assertEditor`, which throws `EditorAuthError` — deliberately
throwing rather than returning a result, so that forgetting to check it produces
a 500 and no write, rather than an unauthorised write.

### The client data path

Eight modules in `lib/wheels`, and the dependency direction is the guard rail:

| Module                                    | Runs   | Holds                                        |
| ----------------------------------------- | ------ | -------------------------------------------- |
| `model.ts`                                | both   | shared shapes, ID guards, collection names   |
| `snapshot.ts`                             | client | Firestore document → those shapes            |
| `api-client.ts`                           | client | one typed method per route handler           |
| `optimistic.ts`                           | client | the reconciliation. Pure, React-free         |
| `use-wheel.ts`, `use-suggestions.ts`      | client | the two `onSnapshot` listeners               |
| `use-edit-token.ts`, `use-editor-role.ts` | client | the fragment, and what the server says of it |
| `use-wheel-session.ts`                    | client | all of the above, assembled for a page       |

**`model.ts` must never import `store.ts`.** It is the module both halves share,
so anything it pulls in reaches a browser bundle. The direction being one-way is
what makes a mistake loud: a client component reaching for `store.ts` gets
`server-only`'s build error rather than the Admin SDK quietly shipped to a
browser. `store.ts` re-exports everything in `model.ts`, so server code keeps
importing from the module it already imports from. `wheelSecrets` is the one
collection name deliberately left out of `model.ts`.

**Three rules the optimistic layer rests on, all easy to undo by accident:**

- **An entry retires on the snapshot, never on the HTTP response.** Retiring on
  the response is the flicker — the row vanishes on the 201 and returns when the
  snapshot lands. Design doc §3 has the per-mutation table; decision 22.
- **Every mutating route reports the version it wrote**, in the
  `x-wheel-updated-at` header, and that value has to equal the `updatedAt` it
  stored. A header running ahead of the field describes a version no snapshot
  ever carries, so every optimistic row on that wheel waits forever — and the
  symptom is rows that never clear, not anything that looks like a timestamp
  bug. This is why `updatedAt` is a route-computed `Date` rather than
  `FieldValue.serverTimestamp()`: a sentinel resolves during the commit and
  leaves the route nothing to report. Asserted across all six routes in
  `app/api/wheels/expiry.emulator.test.ts`.
- **`project()` is pure and takes no clock.** It runs during render, where
  `Date.now()` is impure and `react-hooks/purity` fails lint on it. The slow
  threshold is crossed by a timer in `use-wheel-session.ts` that sets a flag on
  the entry. If you find yourself wanting the current time in `optimistic.ts`,
  that is the sign to add another flag rather than another argument.

Two more things worth knowing before touching any of it. The version is the
**wheel's**, even on the suggestion routes, which works only **because TASK-14
slides `expiresAt` on every mutating route** — one field versions the whole
wheel, subcollection included. And it says nothing about the queue listener,
which is a separate subscription, so the three suggestion mutations additionally
wait for a queue delivery. Drop that and an optimistic suggestion row vanishes
the moment the wheel catches up and reappears when the queue arrives.

### The unfurl

`app/og/` and the two `opengraph-image.tsx` routes. This is the reason the
project uses a framework at all (design doc §3): crawlers don't run JavaScript,
so an SPA gives every wheel the same preview.

**Everything here is read from a cache, possibly long after it stopped being
true.** Slack and X keep an unfurl against the share URL — the string people
paste — and never re-fetch, so there is no cache-busting move and no way to
correct a card once it is out.

The card names the options anyway (§11 Q1 answered the other way round from its
own leaning, at the user's call). What staleness rules out is not the list but
any phrasing that claims to be current or complete: `optionCountLine` describes
rather than promises; and `og:description` deliberately stays a count, since it
is quoted verbatim into a chat message where a stale list of specific things
reads worse than a stale number.

**A card may go stale; it may never contradict itself.** Those are different
failures and only the second is a bug. `optionPills` counts its overflow off the
wheel's own `optionCount` rather than off the labels it was handed — so pills
plus "+N more" always equals the number in the line underneath, whatever the
filter dropped and whatever a future reader chooses to truncate. Overflow is
genuinely `0` when the card is showing every option, and that is right rather
than a gap: the list really was complete when the image was made, the count line
says the same number, and "+0 more" is not a thing the card could render. What
would be wrong is a fifth option going unmentioned.

Five things that bite:

- **Satori is not a browser, and its SVG support is narrower still.** No grid, no
  `conic-gradient`, no stylesheet, no CSS custom properties, no `filter`. Worse,
  inside an `<svg>` it does not invoke function components, renders only the
  first child of a fragment, and drops a second level of `<g>`. Every one of
  those failures is a silently empty picture on a card already in Slack's cache.
  `components/wheel/disc.tsx` is shaped around them — read the note there before
  changing its structure, and re-render a card after you do.
- **One wheel and one mark, each drawn once.** The landing hero, the wheel page
  and both cards render `WheelDisc`; the two headers, both cards and the favicon
  render `WheelMark`. They used to be separate drawings — conic gradients, SVG
  arcs, three hub sizes, two different fourth quarters on the mark — which is
  what drift looks like when nothing is wrong with any one of them. Proportions
  live in `components/wheel/geometry.ts`, the palette sequences in
  `app/wheel-palette.ts`. Colours reach the cards as literals because Satori has
  no `var()`; everything else they share with the app. **The wedges meet edge to
  edge** — no white divider — which is what makes the wheel and the mark read as
  the same object; `app/icon.tsx` is that mark, so a favicon with a seam in it
  means somebody put the stroke back.
- **The OG route cannot use the app's fonts.** `next/font/google` self-hosts
  woff2, which Satori does not parse, under content-hashed paths. Hence the
  committed ttf files in `assets/fonts/` and the `outputFileTracingIncludes`
  entry in `next.config.ts` — a font missing from the deployment bundle is a
  card in a fallback face, cached that way, not a build error.
- **`openGraph` and `twitter` replace the layout's, field group by field group,
  rather than merging.** A page that sets `twitter: { title }` drops the root's
  `card: 'summary_large_image'` and X renders the card as a small square. Nothing
  type-checks or lints this. Restate what you need.
- **A wheel that cannot be read is never an error here.** `readWheelPreview`
  answers `null`, both routes fall back to the generic card and generic copy, and
  the client half of the page is what tells a visitor the wheel is gone. A throw
  in the image route is a 500 cached as a broken image against a live share link.

`app/og/preview.ts` is the pure half — the wording, the count line, the pills,
the slice list, the title size ramp — and it is shared by the image and by
`generateMetadata` so a card cannot claim six options beside a description
claiming five. Those are read by different programs; nothing local would catch
the mismatch. A pill's dot is its option's **position** in the palette, which is
what pairs it with its own wedge; sorting or filtering that list would leave the
card disagreeing with its own picture.

**`app/robots.ts` is part of this, not housekeeping.** A share URL is the
capability, so `/w/` is disallowed to keep wheels out of search results — but
the unfurlers honour robots.txt exactly like an indexer, so the file names them
in their own group to except them. Delete that group and every preview stops,
with no error anywhere. And do not replace the disallow with a `noindex` meta
tag: it is the stronger measure, and several unfurlers decline a card on a
noindexed page.

### Resolving a role

The role is the URL and nothing else (design doc §2), and there is no way to
check the URL locally: the fragment never reaches a server, and §5's rules deny
the client every read of `wheelSecrets`. So `use-editor-role.ts` asks
`GET /api/wheels/{shareId}/editor` — decision 23 — and two of its rules are easy
to undo:

- **A three-state token, not a falsy one.** `use-edit-token.ts` returns
  `undefined` for "not read yet" and `null` for "read, and there is none".
  Collapsing them makes "no token" the answer during the server render and the
  hydrating render, so every editor's page is built as a participant's first and
  visibly rebuilt a moment later.
- **Only `401` and `403` demote.** Everything else — a dropped connection, a
  timeout, a `502`, a `404` — is no evidence, and the editor view stays.
  Demoting on a network blip silently strips the role from someone holding a
  good edit link, on a page that then looks like an ordinary share view. Nothing
  is risked by trusting it: every write is still authorised on its own merits.

The page waits for the role AND the first snapshot before rendering either. They
race, so the cost is the slower one rather than the sum.

### Validating a request body

Three layers, and every write route uses all three the same way. Put a new check
in the layer that owns it rather than wherever it is convenient.

| Layer     | Owns                                      | Lives in                   |
| --------- | ----------------------------------------- | -------------------------- |
| Transport | body size, JSON syntax, "is it an object" | `lib/wheels/request.ts`    |
| Shape     | which fields exist, what type each is     | a Zod schema in the route  |
| Domain    | the caps, sanitisation, capacity          | `lib/wheels/validation.ts` |

A route reads:

```ts
const CreateWheelBody = z.object({
  title: z.unknown().optional().transform(domainCheck(validateNewWheelTitle)),
})

const { title } = await parseBody(request, CreateWheelBody)
```

`parseBody` reads the body and runs the schema, raising **one** `ValidationError`
whichever layer refused — so a handler has a single `catch`, not three shapes of
failure.

Four things about this that are not obvious:

- **Fields are `z.unknown()`, not `z.string()`.** The type check belongs to the
  validator that reports it. A `z.string()` in the schema would put "what may a
  title be" in two places, and Zod's message would replace ours.
- **`domainCheck` carries our error code through Zod.** Clients branch on `code`
  (`title_too_long`, `options_full`), which are facts about this application and
  have no Zod equivalent. The domain error rides on the issue's `params` and is
  unpacked by `parseBody`. A Zod-native issue — wrong type on a `z.boolean()`,
  say — becomes a 400 `invalid_body` carrying Zod's own message.
- **`.optional()` before `.transform()` still runs the transform** when the key
  is absent, which is what lets `validateNewWheelTitle` see its `undefined` and
  apply the default. Without it, an absent key is rejected before the validator
  is consulted and one-click creation breaks.
- **Absent and explicitly-`undefined` stay distinguishable.** Zod 4 leaves the
  key off the output for an absent field and present for `{ title: undefined }`,
  so a PATCH can tell "don't touch the title" from "set it to nothing" with
  `'title' in body`. Do not collapse the two — that distinction is what stops the
  suggestions kill switch from silently renaming a wheel.

Caps and sanitisation stay in `lib/wheels/validation.ts` and are never restated
in a schema. In particular a Zod `.max()` on a string counts UTF-16 units, which
is the measure that module exists to argue against.

### Do not reformat

`backlog/` and `docs/spin-the-wheel-editor/` are excluded from Prettier and
ESLint. The first is CLI-managed; the second is an exported bundle that would
lose its diff against a future re-export.
