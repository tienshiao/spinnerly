import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Two projects, split by what the tests need rather than by what they cover.
 *
 * `unit` is the default and takes every test file. It must stay runnable with
 * nothing but `npm install` — no Java, no emulator — because it is what runs on
 * every change. A test that needs a live Firestore opts OUT of it by being
 * named `*.emulator.test.ts`, which `npm run test:emulator` runs under
 * `firebase emulators:exec`.
 *
 * The direction matters. If `unit` opted in on a `*.unit.test.ts` suffix
 * instead, an ordinary `foo.test.ts` would match neither project and be run by
 * nothing at all — a green `npm test` that silently skipped a file. Here the
 * worst a misnamed file can do is run in `unit` and fail loudly for want of an
 * emulator.
 *
 * **A test that needs a DOM does NOT get a third project.** It declares
 * `// @vitest-environment jsdom` on its first line, and it stays in whichever
 * of the two projects its name puts it in — the hook tests in lib/wheels are
 * split across both. The split above is by what a test needs from OUTSIDE the
 * install: Java, a running emulator, things `npm install` cannot provide and CI
 * has to arrange. jsdom is just a package, so a `dom` project would add a third
 * name to every command and a third way to misname a file, in exchange for
 * nothing. Both environments are set below rather than left to default, so the
 * per-file directive reads as an override of something stated rather than of
 * something assumed.
 *
 * `.mts` rather than `.ts`: this package has no `"type": "module"`, so Vite's
 * native config loader treats a `.ts` config as CommonJS and warns about the
 * ESM syntax in it. The explicit extension settles it without making the whole
 * package ESM, which would change how every other tool reads the `.js` files
 * in this repo.
 */

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

const EMULATOR_TESTS = '**/*.emulator.test.ts'

/**
 * `server-only` throws from its default entry point by design — that is the
 * entire purpose of the package, and `lib/wheels/store.ts` imports it. Left
 * alone, every test touching that module dies on the import itself rather than
 * on anything the test did.
 *
 * The fix is an alias to the package's OWN empty entry — the exact file Next
 * loads when it builds a server component — so this matches production
 * resolution rather than substituting a stub of our own.
 *
 * It deliberately is NOT `resolve.conditions: ['react-server']`, which is the
 * obvious-looking alternative and is a trap. That key REPLACES Vite's default
 * condition list rather than extending it, and applies to every dependency in
 * every test: React then resolves to its `react.react-server` build, where
 * `useState` and every other hook is simply undefined. The first component test
 * anyone writes fails with "useState is not a function" and reads as a React
 * version problem rather than a config one.
 */
const serverOnlyEmpty = require
  .resolve('server-only')
  .replace(/index\.js$/, 'empty.js')

if (!existsSync(serverOnlyEmpty)) {
  throw new Error(
    `Could not find server-only's empty entry at ${serverOnlyEmpty}. ` +
      'The package layout changed; update this alias rather than deleting it, ' +
      'or every test importing lib/wheels/store.ts will fail on the import.',
  )
}

const shared = {
  resolve: {
    alias: {
      // Mirrors the `@/*` path mapping in tsconfig.json. Done by hand rather
      // than with vite-tsconfig-paths: one alias is not worth a dependency, and
      // this stays honest about being a duplicate that has to track tsconfig.
      '@': root,
      'server-only': serverOnlyEmpty,
    },
  },
}

export default defineConfig({
  ...shared,
  test: {
    projects: [
      {
        ...shared,
        test: {
          name: 'unit',
          environment: 'node',
          // Vitest's own default include — every *.test.* file — minus the
          // emulator-backed ones. Spreading `configDefaults.exclude` rather
          // than listing node_modules by hand, since assigning `exclude`
          // replaces the defaults instead of adding to them.
          exclude: [...configDefaults.exclude, EMULATOR_TESTS],
        },
      },
      {
        ...shared,
        test: {
          name: 'emulator',
          environment: 'node',
          include: [EMULATOR_TESTS],
          // One shared database. Running these files concurrently is safe today
          // because every test creates its own wheels, but a suite that assumed
          // an empty collection would start flaking against whichever file
          // happened to run alongside it.
          fileParallelism: false,
        },
      },
    ],
  },
})
