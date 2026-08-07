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
