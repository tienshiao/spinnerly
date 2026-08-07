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
      {
        filename: LIB,
        code: `import { getAdminDb } from '@/lib/firebase/admin'\nexport const db = getAdminDb()`,
      },
      {
        filename: PAGE,
        code: `import { getAdminDb } from '@/lib/firebase/admin'\nexport const runtime = 'nodejs'\nexport default function P() { return getAdminDb() ? null : null }`,
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
      // The wrapper is the *intended* spelling, so recognising only the raw
      // package would exempt every segment that does the right thing. These
      // two are the server-read segments the design doc plans for.
      {
        filename: PAGE,
        code: `import { getAdminDb } from '@/lib/firebase/admin'\nexport default function P() { return getAdminDb() ? null : null }`,
        errors: [{ messageId: 'missing' }],
      },
      {
        filename: '/repo/app/w/[shareId]/opengraph-image.tsx',
        code: `import { getAdminDb } from '../../../lib/firebase/admin'\nexport default function I() { return getAdminDb() }`,
        errors: [{ messageId: 'missing' }],
      },
    ],
  },
)

const COMPONENT = '/repo/components/wheel.tsx'

ruleTester.run(
  'no-client-firestore-writes',
  plugin.rules['no-client-firestore-writes'],
  {
    valid: [
      // Reads are the entire point of having the client SDK.
      {
        filename: COMPONENT,
        code: `import { doc, onSnapshot, getDoc } from 'firebase/firestore'\nexport const x = [doc, onSnapshot, getDoc]`,
      },
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nexport const x = fs.onSnapshot`,
      },
      // The server SDK writes. That is its job.
      {
        filename: LIB,
        code: `import { FieldValue } from 'firebase-admin/firestore'\nexport const x = FieldValue.arrayUnion`,
      },
      // A local function that merely shares a name with a Firestore write.
      {
        filename: COMPONENT,
        code: `function increment(n) { return n + 1 }\nexport const x = increment(1)`,
      },
      // A namespace binding that is shadowed before use.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nexport function f(fs) { return fs.setDoc }\nexport const x = fs.doc`,
      },
      // Re-exporting reads by name is fine — it is the writes that must not
      // acquire a local alias.
      {
        filename: LIB,
        code: `export { doc, onSnapshot } from 'firebase/firestore'`,
      },
      // A namespace alias chain that only ever touches reads.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nconst g = fs\nexport const x = g.getDoc`,
      },
    ],
    invalid: [
      {
        filename: COMPONENT,
        code: `import { setDoc } from 'firebase/firestore'\nexport const x = setDoc`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // Aliasing renames the binding, not the import.
      {
        filename: COMPONENT,
        code: `import { updateDoc as touch } from 'firebase/firestore'\nexport const x = touch`,
        errors: [{ messageId: 'write', data: { name: 'updateDoc' } }],
      },
      {
        filename: COMPONENT,
        code: `import { addDoc, deleteDoc } from 'firebase/firestore'\nexport const x = [addDoc, deleteDoc]`,
        errors: [{ messageId: 'write' }, { messageId: 'write' }],
      },
      // The field transforms are the tell that a write is being assembled.
      {
        filename: COMPONENT,
        code: `import { arrayUnion } from 'firebase/firestore'\nexport const x = arrayUnion`,
        errors: [{ messageId: 'write', data: { name: 'arrayUnion' } }],
      },
      // Namespace import, used as a member.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nexport const x = fs.writeBatch()`,
        errors: [{ messageId: 'write', data: { name: 'writeBatch' } }],
      },
      // ...and the computed spelling of the same thing.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nexport const x = fs['runTransaction']`,
        errors: [{ messageId: 'write', data: { name: 'runTransaction' } }],
      },
      // Namespace import, destructured later.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nconst { setDoc } = fs\nexport const x = setDoc`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // Dynamic import, destructured.
      {
        filename: COMPONENT,
        code: `export async function f() { const { deleteDoc } = await import('firebase/firestore'); return deleteDoc }`,
        errors: [{ messageId: 'write', data: { name: 'deleteDoc' } }],
      },
      // Dynamic import, bound whole, then used.
      {
        filename: COMPONENT,
        code: `export async function f() { const fs = await import('firebase/firestore'); return fs.addDoc }`,
        errors: [{ messageId: 'write', data: { name: 'addDoc' } }],
      },
      // Dynamic import with no binding at all.
      {
        filename: COMPONENT,
        code: `export async function f() { return (await import('firebase/firestore')).increment(1) }`,
        errors: [{ messageId: 'write', data: { name: 'increment' } }],
      },
      {
        filename: COMPONENT,
        code: `const { serverTimestamp } = require('firebase/firestore')\nexport const x = serverTimestamp`,
        errors: [{ messageId: 'write', data: { name: 'serverTimestamp' } }],
      },
      // The lite SDK is the same write surface.
      {
        filename: COMPONENT,
        code: `import { setDoc } from 'firebase/firestore/lite'\nexport const x = setDoc`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // A dynamic import takes an expression, so the source can be a template
      // literal — a naive `node.type === 'Literal'` check misses this one.
      {
        filename: COMPONENT,
        code: 'export async function f() { const { updateDoc } = await import(`firebase/firestore`); return updateDoc }',
        errors: [{ messageId: 'write', data: { name: 'updateDoc' } }],
      },
      // The internal scoped name is the same code and resolves, so it is a
      // live bypass rather than a hypothetical one.
      {
        filename: COMPONENT,
        code: `import { setDoc } from '@firebase/firestore'\nexport const x = setDoc`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // A local barrel: consumers import the write from here, so nothing
      // downstream ever mentions firebase/firestore again.
      {
        filename: LIB,
        code: `export { setDoc, updateDoc } from 'firebase/firestore'`,
        errors: [{ messageId: 'write' }, { messageId: 'write' }],
      },
      // ...including when the barrel renames it on the way out.
      {
        filename: LIB,
        code: `export { setDoc as save } from 'firebase/firestore'`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // `export *` re-exports every write there is and names none of them.
      {
        filename: LIB,
        code: `export * from 'firebase/firestore'`,
        errors: [{ messageId: 'reExportAll' }],
      },
      // A namespace laundered through one local const...
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nconst g = fs\nexport const x = g.setDoc`,
        errors: [{ messageId: 'write', data: { name: 'setDoc' } }],
      },
      // ...and through two, to prove the chain is followed rather than a
      // single hop being special-cased.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nconst g = fs\nconst h = g\nexport const x = h.runTransaction`,
        errors: [{ messageId: 'write', data: { name: 'runTransaction' } }],
      },
      // Destructuring off a laundered namespace.
      {
        filename: COMPONENT,
        code: `import * as fs from 'firebase/firestore'\nconst g = fs\nconst { deleteDoc } = g\nexport const x = deleteDoc`,
        errors: [{ messageId: 'write', data: { name: 'deleteDoc' } }],
      },
    ],
  },
)
