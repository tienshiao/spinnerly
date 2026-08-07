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
