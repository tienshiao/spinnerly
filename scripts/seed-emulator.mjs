/**
 * Seed the Firestore emulator with one wheel to look at.
 *
 * Emulator data is in-memory and discarded on exit, so a fresh `npm run
 * emulator` starts empty every time. Rather than reach for `--export-on-exit`
 * and carry a snapshot of throwaway data in the repo, this script rebuilds the
 * same fixture from scratch in about a second.
 *
 * Everything it writes uses fixed IDs, so re-running it against a live emulator
 * is idempotent and the dev URLs below never change. That is the opposite of
 * production, where `shareId` is an unguessable auto-ID and the edit token is a
 * CSPRNG value (design doc sections 2 and 4) — a readable ID is only safe here
 * because the `demo-` project prefix means this data cannot leave the machine.
 *
 * Usage: npm run seed  (with the emulator already running)
 */

import { createHash } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

// Refuse to run against anything but the emulator. Without this guard a stray
// GOOGLE_APPLICATION_CREDENTIALS in the environment would be enough to write
// fixture data into a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'FIRESTORE_EMULATOR_HOST is not set, so this would target a real Firestore. Refusing to run.\n' +
      'Start the emulator with `npm run emulator`, or use `npm run dev:emulator`, which does both.',
  )
  process.exit(1)
}

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-spinnerly'

if (!PROJECT_ID.startsWith('demo-')) {
  console.error(
    `Project ID "${PROJECT_ID}" does not start with "demo-". That prefix is what makes the emulator\n` +
      'refuse to contact Google, so seeding without it is not safe. Refusing to run.',
  )
  process.exit(1)
}

const SHARE_ID = 'seedwheel000000000000'
const EDIT_TOKEN = 'seed-edit-token'
const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3000'

// Sliding 30-day expiry (design doc decision 4). The TTL policy that acts on
// this field is TASK-14; the field exists from the start so the policy has
// something to attach to.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const app = initializeApp({ projectId: PROJECT_ID })
const db = getFirestore(app)

const now = Timestamp.now()
const expiresAt = Timestamp.fromMillis(now.toMillis() + THIRTY_DAYS_MS)

const options = [
  'Thai on 4th',
  'The ramen place',
  'Tacos',
  'That new pizza spot',
  'Sushi',
].map((label, index) => ({
  id: `seed-option-${index + 1}`,
  label,
  addedAt: now,
  fromSuggestion: null,
}))

const wheel = db.doc(`wheels/${SHARE_ID}`)

await wheel.set({
  title: 'Lunch Friday',
  options,
  suggestionsOpen: true,
  createdAt: now,
  updatedAt: now,
  expiresAt,
})

// Only ever `pending` or `accepted` — reject is a hard delete (design doc
// decision 11), so there is no rejected row to seed.
const suggestions = [
  { id: 'seed-suggestion-1', label: 'Korean BBQ', status: 'pending' },
  { id: 'seed-suggestion-2', label: 'The bahn mi cart', status: 'pending' },
]

await Promise.all(
  suggestions.map(({ id, label, status }) =>
    wheel.collection('suggestions').doc(id).set({
      label,
      status,
      createdAt: now,
      clientHint: 'seed',
    }),
  ),
)

// The stored value is a hash, never the token itself, so that a database leak
// does not hand out edit rights (design doc section 4).
await db.doc(`wheelSecrets/${SHARE_ID}`).set({
  editTokenHash: createHash('sha256').update(EDIT_TOKEN).digest('hex'),
  createdAt: now,
})

console.log(`Seeded ${PROJECT_ID} at ${process.env.FIRESTORE_EMULATOR_HOST}\n`)
console.log(`  Share view:  ${BASE_URL}/w/${SHARE_ID}`)
console.log(`  Editor view: ${BASE_URL}/w/${SHARE_ID}#e=${EDIT_TOKEN}`)
console.log(`  Emulator UI: http://127.0.0.1:4001/firestore`)

process.exit(0)
