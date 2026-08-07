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

| Command                | What                                            |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Dev server                                      |
| `npm run build`        | Production build; fails on type errors          |
| `npm run typecheck`    | `tsc --noEmit`                                  |
| `npm run lint`         | ESLint, including the local `spinnerly/*` rules |
| `npm run format`       | Prettier write                                  |
| `npm run format:check` | Prettier check                                  |
| `npm test`             | Vitest `unit` project — runs on a bare install  |
| `npm run test:watch`   | Same, in watch mode                             |

**The runner is Vitest**, configured in `vitest.config.mts`. Tests are split by
what they _need_, not by what they cover:

- `*.test.ts` — the default. No external dependencies, so `npm test` stays
  runnable with nothing but `npm install`: no Java, no emulator. Name a test
  this way unless it needs Firestore.
- `*.emulator.test.ts` — opts out of the default project. The project that
  runs these under `firebase emulators:exec` arrives with the first such test.

The direction is deliberate: `unit` takes everything and the emulator suffix
opts out. Were it the other way round — `unit` opting in on a `*.unit.test.ts`
suffix — an ordinary `foo.test.ts` would match neither project and be run by
nothing at all, giving a green `npm test` that silently skipped a file. As it
stands the worst a misnamed file can do is run in `unit` and fail loudly for
want of an emulator.

Two config details that look optional and are not.

`server-only` is **aliased** to the package's own empty entry, because server
modules import it and its default entry throws by design. Do not
"fix" this by setting `resolve.conditions: ['react-server']` instead — that key
_replaces_ Vite's default condition list rather than extending it, and applies
to every dependency in both projects. React then resolves to its
`react.react-server` build where every hook is `undefined`, so the first
component test anyone writes fails with "useState is not a function" and reads
as a React version problem rather than a config one.

And the config is `.mts` because this package is not `"type": "module"`, so a
`.ts` config gets loaded as CommonJS and warns.

**Assertions are Vitest's `expect`.** Not `node:assert` — keep new tests
consistent with the existing suites. Three conventions worth following:

- `expect(value, 'why this matters')` takes a message as its second argument.
  Use it where the matcher's own output would not say enough.
- **Table-driven cases use `it.each` rather than a `for` loop.** Each row
  becomes its own named test, so a failure names the case instead of the loop.
  Prefer the object form with a `label` and `'... $label'` in the title.
- If a table needs a fixture built in `beforeAll`, wrap the value in a thunk.
  `it.each` evaluates its table at collection time, before any hook has run, so
  referencing the fixture directly gets `undefined`.

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

### Do not reformat

`backlog/` and `docs/spin-the-wheel-editor/` are excluded from Prettier and
ESLint. The first is CLI-managed; the second is an exported bundle that would
lose its diff against a future re-export.
