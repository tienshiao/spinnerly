import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import spinnerly from './eslint-rules/index.mjs'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    plugins: { spinnerly },
    rules: {
      'spinnerly/no-edge-runtime': 'error',
      'spinnerly/require-nodejs-runtime': 'error',
      'spinnerly/no-client-firestore-writes': 'error',
      'spinnerly/no-wheel-secret-queries': 'error',
    },
  },

  {
    // The security-rules suite is the one place in this repo where writing the
    // forbidden shape is the point: it asserts that the shape is refused. Both
    // rules below fire on it, and in both cases the rule is working.
    //
    //   - `no-client-firestore-writes` — proving `allow write: if false` means
    //     importing setDoc, addDoc, updateDoc and deleteDoc and calling each
    //     one inside assertFails.
    //   - `no-wheel-secret-queries` — the guard it exists for is a *server*
    //     query across wheelSecrets, which validates an edit token globally
    //     (design doc section 6). The suite has no Admin SDK and no token: it
    //     lists the collection from an ordinary browser client to show the
    //     listing is denied, which is the opposite of the bug.
    //
    // Scoped to the file rather than handled with eslint-disable comments:
    // there is one assertion per verb per collection, so the disables would
    // outnumber the assertions and every new case would need its own.
    files: ['firestore.rules.emulator.test.ts'],
    rules: {
      'spinnerly/no-client-firestore-writes': 'off',
      'spinnerly/no-wheel-secret-queries': 'off',
    },
  },

  // Must come last: turns off stylistic rules that would fight Prettier.
  prettier,

  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Backlog.md task data is generated and managed by the CLI.
    'backlog/**',
    // Claude Design handoff bundle — prototypes, not our source.
    'docs/spin-the-wheel-editor/**',
  ]),
])

export default eslintConfig
