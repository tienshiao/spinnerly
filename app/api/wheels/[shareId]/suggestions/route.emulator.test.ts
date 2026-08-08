import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  createWheel,
  SUGGESTIONS,
  updateWheel,
  WHEEL_SECRETS,
  WHEELS,
} from '@/lib/wheels/store'
import { PENDING_SUGGESTIONS_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * POST /api/wheels/{shareId}/suggestions, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * The body rejections are in ./route.test.ts, which needs no emulator. What is
 * here is everything that can only be seen in the data: the kill switch, the
 * pending cap, the stored fields, and the expiry slide across three documents.
 */

let db: Firestore

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  db = getAdminDb()
})

/**
 * A POST for `shareId`. No Authorization header anywhere in this file — the
 * absence is the point of the endpoint.
 */
function post(
  shareId: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://example.test/api/wheels/${shareId}/suggestions`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
  })
}

function context(shareId: string) {
  return {
    params: Promise.resolve({ shareId }),
  } as RouteContext<'/api/wheels/[shareId]/suggestions'>
}

type Body = {
  error?: string
  id?: string
  label?: string
  status?: string
  createdAt?: unknown
}

async function run(
  shareId: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const response = await POST(post(shareId, body, headers), context(shareId))
  const text = await response.text()
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    body: text === '' ? null : (JSON.parse(text) as Body),
  }
}

/** A fresh wheel taking suggestions. */
async function seed() {
  return createWheel({ title: 'Lunch Friday' }, db)
}

/**
 * Write `count` suggestions straight into the subcollection.
 *
 * Deliberately not routed through `submitSuggestion`: filling a wheel to the
 * 200-suggestion cap through the endpoint would be six hundred round trips to
 * set up a test about the six hundred and first. One batch is one.
 */
async function seedSuggestions(
  shareId: string,
  count: number,
  status: 'pending' | 'accepted' = 'pending',
) {
  const suggestions = db.collection(WHEELS).doc(shareId).collection(SUGGESTIONS)
  const batch = db.batch()
  for (let index = 0; index < count; index += 1) {
    batch.set(suggestions.doc(), {
      label: `Seeded ${index}`,
      status,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    })
  }
  await batch.commit()
}

/** The current stored state of a wheel. */
async function readWheel(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

/** Every suggestion on a wheel, ordered by nothing in particular. */
async function readSuggestions(shareId: string) {
  const snapshot = await db
    .collection(WHEELS)
    .doc(shareId)
    .collection(SUGGESTIONS)
    .get()
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    label: doc.get('label') as string,
    status: doc.get('status') as string,
    createdAt: doc.get('createdAt')?.toDate().getTime() as number,
    expiresAt: doc.get('expiresAt')?.toDate().getTime() as number,
  }))
}

describe('submitting without a credential', () => {
  it('accepts a suggestion from someone holding only the share URL', async () => {
    // The endpoint's whole reason for existing: a participant arrives from a
    // group chat with no account and nothing to sign in to.
    const { shareId } = await seed()

    const { status, body } = await run(shareId, { label: 'Tacos' })

    expect(status).toBe(201)
    expect(body?.status).toBe('pending')
    expect(await readSuggestions(shareId)).toMatchObject([
      { id: body?.id, label: 'Tacos', status: 'pending' },
    ])
  })

  it('stores the sanitised label', async () => {
    const { shareId } = await seed()

    const { body } = await run(shareId, { label: '  Thai\t\tGreen Curry ' })

    expect(body?.label).toBe('Thai Green Curry')
    expect((await readSuggestions(shareId))[0].label).toBe('Thai Green Curry')
  })

  it('keeps every submission rather than replacing the last', async () => {
    const { shareId } = await seed()

    await run(shareId, { label: 'Tacos' })
    await run(shareId, { label: 'Ramen' })
    await run(shareId, { label: 'Pho' })

    expect(
      (await readSuggestions(shareId)).map((s) => s.label).toSorted(),
    ).toEqual(['Pho', 'Ramen', 'Tacos'])
  })

  it('answers no-store', async () => {
    const { shareId } = await seed()

    expect((await run(shareId, { label: 'Tacos' })).cacheControl).toBe(
      'no-store',
    )
  })
})

describe('the stored suggestion', () => {
  it('carries a server timestamp and the wheel’s expiry', async () => {
    // Its own `expiresAt` because a TTL policy deletes the document it matches
    // and not that document's subcollections — without this field a reaped
    // wheel leaves its suggestions behind with nothing to reach them from.
    const { shareId } = await seed()
    const at = Date.now()

    await run(shareId, { label: 'Tacos' })

    const [stored] = await readSuggestions(shareId)
    const wheel = await readWheel(shareId)

    expect(stored.createdAt).toBeGreaterThanOrEqual(at - 60_000)
    expect(
      stored.expiresAt,
      'a suggestion that outlives its wheel is an orphan nothing can reach',
    ).toBe(wheel.expiresAt)
  })

  it('holds nothing that identifies the submitter', async () => {
    // Design doc section 5 makes this subcollection `allow get, list: if true`,
    // and rules cannot exclude a field — so anything stored here is readable by
    // every participant with the share URL. A per-submitter fingerprint would
    // let them group the queue by who sent what, which is decision 12's
    // attribution arriving by the back door. The assertion is on the whole
    // document rather than on the absence of one field name, so a differently
    // named one cannot be added without this failing.
    const { shareId } = await seed()

    await run(shareId, { label: 'Tacos' }, { 'x-forwarded-for': '203.0.113.7' })

    const snapshot = await db
      .collection(WHEELS)
      .doc(shareId)
      .collection(SUGGESTIONS)
      .get()

    expect(Object.keys(snapshot.docs[0].data()).toSorted()).toEqual([
      'createdAt',
      'expiresAt',
      'label',
      'status',
    ])
  })
})

describe('the response body', () => {
  it('withholds the client hint and the timestamp', async () => {
    // The hint is never displayed (design doc section 4); echoing it would hand
    // every submitter the fingerprint we hold for them. The timestamp is the
    // server's, and any value invented here would order the queue wrongly for
    // whoever trusted it.
    const { shareId } = await seed()

    const { body } = await run(shareId, { label: 'Tacos' })

    expect(body).toEqual({
      id: expect.any(String),
      label: 'Tacos',
      status: 'pending',
    })
  })
})

describe('the kill switch', () => {
  it('refuses a closed wheel with 403 suggestions_closed', async () => {
    // The editor's only tool while a wheel is being brigaded (design doc
    // section 7).
    const { shareId } = await seed()
    await updateWheel(shareId, { suggestionsOpen: false }, db)

    expect(await run(shareId, { label: 'Spam' })).toMatchObject({
      status: 403,
      body: { error: 'suggestions_closed' },
    })
    expect(await readSuggestions(shareId)).toEqual([])
  })

  it('does not slide expiry for a refused submission', async () => {
    // Otherwise closing suggestions on a brigaded wheel would still let the
    // brigade keep it alive indefinitely.
    const { shareId } = await seed()
    await updateWheel(shareId, { suggestionsOpen: false }, db)
    const before = await readWheel(shareId)

    await run(shareId, { label: 'Spam' })

    expect(await readWheel(shareId)).toMatchObject({
      expiresAt: before.expiresAt,
      updatedAt: before.updatedAt,
    })
  })

  it('accepts again once the editor reopens the wheel', async () => {
    const { shareId } = await seed()
    await updateWheel(shareId, { suggestionsOpen: false }, db)
    await updateWheel(shareId, { suggestionsOpen: true }, db)

    expect(await run(shareId, { label: 'Tacos' })).toMatchObject({
      status: 201,
    })
  })

  it('treats a wheel with no suggestionsOpen field as closed', async () => {
    // Failing closed is the safe direction on the one path with no credential:
    // the cost is that nobody can suggest to a malformed wheel, against
    // accepting public writes to a wheel whose kill switch we could not read.
    const { shareId } = await seed()
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({ suggestionsOpen: FieldValue.delete() })

    expect(await run(shareId, { label: 'Tacos' })).toMatchObject({
      status: 403,
      body: { error: 'suggestions_closed' },
    })
  })
})

describe('unknown wheels', () => {
  it.each([
    { label: 'a well-formed but unknown share ID', id: 'a1b2c3d4e5f6g7h8i9j0' },
    { label: 'a malformed share ID', id: 'nope' },
    { label: 'a path traversal attempt', id: '..%2F..%2Fwheels' },
  ])('refuses $label with 404 no_such_wheel', async ({ id }) => {
    expect(await run(id, { label: 'Tacos' })).toMatchObject({
      status: 404,
      body: { error: 'no_such_wheel' },
    })
  })
})

describe('the pending cap', () => {
  it('accepts the suggestion that fills the queue', async () => {
    const { shareId } = await seed()
    await seedSuggestions(shareId, PENDING_SUGGESTIONS_MAX - 1)

    expect(await run(shareId, { label: 'Last' })).toMatchObject({ status: 201 })
    expect(await readSuggestions(shareId)).toHaveLength(PENDING_SUGGESTIONS_MAX)
  })

  it('refuses the one after that with 409 suggestions_full', async () => {
    const { shareId } = await seed()
    await seedSuggestions(shareId, PENDING_SUGGESTIONS_MAX)

    expect(await run(shareId, { label: 'One too many' })).toMatchObject({
      status: 409,
      body: { error: 'suggestions_full' },
    })
    expect(await readSuggestions(shareId)).toHaveLength(PENDING_SUGGESTIONS_MAX)
  })

  it('counts pending suggestions only', async () => {
    // Accepted ones are bounded by OPTIONS_MAX instead, so counting them here
    // would let a wheel that had been curated properly stop taking suggestions.
    const { shareId } = await seed()
    await seedSuggestions(shareId, PENDING_SUGGESTIONS_MAX, 'accepted')

    expect(await run(shareId, { label: 'Still welcome' })).toMatchObject({
      status: 201,
    })
  })
})

describe('sliding expiry', () => {
  it('slides the wheel and its secret on a successful submission', async () => {
    // Design doc section 8 counts a suggestion as activity, which is what keeps
    // a wheel people are still using from being reaped under them.
    const { shareId } = await seed()
    const before = await readWheel(shareId)
    const secretBefore = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    const at = Date.now()
    await run(shareId, { label: 'Tacos' })

    const after = await readWheel(shareId)
    const secretAfter = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.expiresAt).toBeGreaterThanOrEqual(at + THIRTY_DAYS_MS)
    expect(
      secretAfter.get('expiresAt').toDate().getTime(),
      'the secret will be reaped before the wheel it unlocks',
    ).toBeGreaterThan(secretBefore.get('expiresAt').toDate().getTime())
    expect(secretAfter.get('expiresAt').toDate().getTime()).toBeGreaterThan(
      after.expiresAt,
    )
  })
})
