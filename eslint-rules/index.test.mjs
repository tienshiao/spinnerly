import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import plugin from './index.mjs'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
})

const ROUTE = '/repo/app/api/wheels/route.ts'
const PAGE = '/repo/app/w/[shareId]/page.tsx'
const LIB = '/repo/lib/firestore.ts'

const GET = 'export async function GET() { return Response.json({}) }'

ruleTester.run('no-edge-runtime', plugin.rules['no-edge-runtime'], {
  valid: [
    { filename: ROUTE, code: `export const runtime = 'nodejs'\n${GET}` },
    {
      filename: ROUTE,
      code: `export const runtime = 'nodejs' as const\n${GET}`,
    },
    { filename: ROUTE, code: GET },
    // Declared but never exported: inert, so not our business.
    {
      filename: LIB,
      code: `const runtime = 'edge'\nexport default runtime.length`,
    },
  ],
  invalid: [
    {
      filename: ROUTE,
      code: `export const runtime = 'edge'\n${GET}`,
      errors: [{ messageId: 'edge' }],
    },
    // The regression the review caught: `as const` is the idiomatic spelling
    // for Next route-segment config and used to slip straight through.
    {
      filename: ROUTE,
      code: `export const runtime = 'edge' as const\n${GET}`,
      errors: [{ messageId: 'edge' }],
    },
    {
      filename: ROUTE,
      code: 'export const runtime = `edge`\n' + GET,
      errors: [{ messageId: 'edge' }],
    },
    {
      filename: ROUTE,
      code: `const runtime = 'edge'\nexport { runtime }\n${GET}`,
      errors: [{ messageId: 'edge' }],
    },
    // Not a route segment, but an exported edge runtime is still wrong.
    {
      filename: LIB,
      code: `export const runtime = 'edge'`,
      errors: [{ messageId: 'edge' }],
    },
  ],
})

ruleTester.run(
  'require-nodejs-runtime',
  plugin.rules['require-nodejs-runtime'],
  {
    valid: [
      { filename: ROUTE, code: `export const runtime = 'nodejs'\n${GET}` },
      {
        filename: ROUTE,
        code: `export const runtime = 'nodejs' as const\n${GET}`,
      },
      {
        filename: ROUTE,
        code: `const runtime = 'nodejs'\nexport { runtime }\n${GET}`,
      },
      // A page that never touches Firestore needs no pin.
      { filename: PAGE, code: 'export default function P() { return null }' },
      // Library modules are exempt: Next ignores the export outside a segment.
      {
        filename: LIB,
        code: `import { getFirestore } from 'firebase-admin/firestore'\nexport const db = getFirestore()`,
      },
    ],
    invalid: [
      // Every app/api route reaches Firestore in this app.
      {
        filename: ROUTE,
        code: GET,
        errors: [{ messageId: 'missing' }],
      },
      {
        filename: ROUTE,
        code: `export const runtime = 'edge'\n${GET}`,
        errors: [{ messageId: 'wrongValue' }],
      },
      // A non-API segment that imports the Admin SDK directly.
      {
        filename: PAGE,
        code: `import 'firebase-admin/firestore'\nexport default function P() { return null }`,
        errors: [{ messageId: 'missing' }],
      },
      {
        filename: PAGE,
        code: `const admin = await import('firebase-admin/app')\nexport default function P() { return admin ? null : null }`,
        errors: [{ messageId: 'missing' }],
      },
      {
        filename: PAGE,
        code: `const admin = require('firebase-admin')\nexport default function P() { return admin ? null : null }`,
        errors: [{ messageId: 'missing' }],
      },
      // Declared but not exported does not count.
      {
        filename: ROUTE,
        code: `const runtime = 'nodejs'\n${GET}`,
        errors: [{ messageId: 'missing' }],
      },
    ],
  },
)
