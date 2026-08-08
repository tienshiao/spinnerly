import { type Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { isShareId, WHEEL_SECRETS, WHEELS } from '@/lib/wheels/store'
import { hashEditToken } from '@/lib/wheels/tokens'
import { DEFAULT_TITLE } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * The success path of POST /api/wheels, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * The rejection paths are in ./route.test.ts and run in the fast project,
 * because they never reach the database. What is here is everything that can
 * only be proved by looking at what was actually written.
 *
 * Reads go through `getAdminDb()` — the same handle the route itself uses —
 * rather than through an app this file initialises, which is what
 * ./../../../lib/wheels/store.emulator.test.ts does. The difference is that
 * those tests pass their handle to the function under test, so they own it. Here
 * the route calls `createWheel()` with no handle at all, so the app belongs to
 * lib/firebase/admin.ts.
 *
 * A second app is not merely redundant, it is actively wrong: `createApp()`
 * returns `getApps()[0]` if any app already exists, so an app initialised in
 * `beforeAll` is the one the route ends up using — and tearing it down in
 * `afterAll` would delete the handle cached in the admin module's globalThis
 * cache, breaking any later file that called `getAdminDb()`. Nothing is torn
 * down here for the same reason: the cache is process-wide by design, and the
 * process is about to exit.
 */

let db: Firestore

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function post(body?: BodyInit): Request {
  return new Request('https://example.test/api/wheels', {
    method: 'POST',
    body,
  })
}

/** Create a wheel through the route and return the response and parsed body. */
async function create(body?: BodyInit) {
  const response = await POST(post(body))
  const parsed = (await response.clone().json()) as {
    shareId: string
    editToken: string
  }
  return { response, ...parsed }
}

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`. ' +
      'Without it the Admin SDK would resolve real credentials and these tests ' +
      'would write to a live project.',
  ).toBeTruthy()

  // Checked before this line rather than after, because `getAdminDb()` is what
  // would go looking for real credentials.
  db = getAdminDb()
})

describe('POST /api/wheels', () => {
  it('returns 201 with a share ID and a raw edit token', async () => {
    const { response, shareId, editToken } = await create()

    expect(response.status).toBe(201)
    expect(isShareId(shareId), `${shareId} is not a well-formed share ID`).toBe(
      true,
    )
    // 32 bytes base64url-encodes to 43 characters with no padding.
    expect(editToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('writes the wheel and its secret together', async () => {
    // A wheel that committed without its secret has no valid edit token and no
    // way to acquire one: a live, publicly readable wheel nobody can edit or
    // shut off. `createWheel` writes both in one batch; this asserts the route
    // actually gets that pairing rather than only the wheel.
    const { shareId } = await create()

    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
    ])

    expect(wheel.exists, 'the wheel document is missing').toBe(true)
    expect(secret.exists, 'the secret document is missing').toBe(true)
  })

  it('stores only the hash of the edit token', async () => {
    const { shareId, editToken } = await create()

    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
    ])

    expect(secret.get('editTokenHash')).toBe(hashEditToken(editToken))

    // The raw token must appear nowhere in either document, under any field.
    expect(JSON.stringify(secret.data())).not.toContain(editToken)
    expect(JSON.stringify(wheel.data())).not.toContain(editToken)
  })

  it('creates the wheel in the shape the data model describes', async () => {
    const { shareId } = await create(JSON.stringify({ title: 'Lunch Friday' }))

    const wheel = await db.collection(WHEELS).doc(shareId).get()

    expect(wheel.get('title')).toBe('Lunch Friday')
    expect(wheel.get('options')).toEqual([])
    expect(wheel.get('suggestionsOpen')).toBe(true)
    expect(wheel.get('createdAt')).toBeTruthy()
    expect(wheel.get('updatedAt')).toBeTruthy()
  })

  it('sets the wheel to expire 30 days out', async () => {
    const before = Date.now()
    const { shareId } = await create()
    const after = Date.now()

    const wheel = await db.collection(WHEELS).doc(shareId).get()
    const expiresAt = wheel.get('expiresAt').toDate().getTime()

    expect(expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS)
    expect(expiresAt).toBeLessThanOrEqual(after + THIRTY_DAYS_MS)
  })

  it('sets the secret to outlive the wheel', async () => {
    // Not the same instant, deliberately. The two are reaped by independent
    // per-collection TTL jobs with no ordering guarantee between them, and one
    // order is harmless while the other leaves a live, publicly writable wheel
    // whose owner has permanently lost the kill switch. See
    // SECRET_EXPIRY_MARGIN_DAYS.
    const { shareId } = await create()

    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
    ])

    expect(
      secret.get('expiresAt').toDate().getTime(),
      'the secret is reapable before the wheel it unlocks',
    ).toBeGreaterThan(wheel.get('expiresAt').toDate().getTime())
  })

  it.each([
    { label: 'no body at all', body: undefined },
    { label: 'an empty object', body: '{}' },
    { label: 'an explicit null title', body: JSON.stringify({ title: null }) },
  ])('defaults the title given $label', async ({ body }) => {
    const { shareId } = await create(body)

    const wheel = await db.collection(WHEELS).doc(shareId).get()
    expect(wheel.get('title')).toBe(DEFAULT_TITLE)
  })

  it('stores the sanitised title, not the raw one', async () => {
    const { shareId } = await create(
      JSON.stringify({ title: '  Lunch\t\tFriday \n' }),
    )

    const wheel = await db.collection(WHEELS).doc(shareId).get()
    expect(wheel.get('title')).toBe('Lunch Friday')
  })

  it('mints a fresh share ID and token on every call', async () => {
    const first = await create()
    const second = await create()

    expect(first.shareId).not.toBe(second.shareId)
    expect(first.editToken).not.toBe(second.editToken)
  })

  it('marks the response no-store', async () => {
    // The body is a bearer capability, and this is the one response that carries
    // one. It must not land in any shared cache between here and the browser.
    const { response } = await create()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
})

describe('the raw edit token', () => {
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reaches the response body and no console output', async () => {
    // Design doc section 6: the token must never land in a log line, because
    // Cloud Logging and load-balancer logs are exactly where it would outlive
    // the request. The handler logs nothing at all on the success path, and this
    // is what holds that true when someone later adds a debug line.
    const written: string[] = []
    for (const method of CONSOLE_METHODS) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map((arg) => String(arg)).join(' '))
      })
    }

    const { response, editToken } = await create(
      JSON.stringify({ title: 'Lunch Friday' }),
    )

    expect(await response.text(), 'the token belongs in the body').toContain(
      editToken,
    )
    expect(
      written.filter((line) => line.includes(editToken)),
      'the raw edit token was written to the console',
    ).toEqual([])
  })
})
