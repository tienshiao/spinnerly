import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  acceptSuggestion,
  createWheel,
  submitSuggestion,
  SUGGESTIONS,
  WHEEL_SECRETS,
  WHEELS,
} from '@/lib/wheels/store'
import { PENDING_SUGGESTIONS_MAX } from '@/lib/wheels/validation'
import { POST as submit } from '../route'
import { DELETE } from './route'

/**
 * DELETE /api/wheels/{shareId}/suggestions/{suggestionId}, against a live
 * Firestore. Run with `npm run test:emulator`.
 *
 * Everything for this route is here, with no unit-project counterpart:
 * authorization reads a secret document before anything else happens.
 *
 * The assertion this file exists to make is that the document is *gone*. Design
 * doc section 4 rejects a `status: "rejected"` flip because the queue is visible
 * to every participant, so a flip would leave spam on display to everyone until
 * someone built a filter for it — and a flip is the change a future refactor is
 * most likely to make, since it looks like the tidier one.
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

function request(shareId: string, suggestionId: string, token?: string) {
  return new Request(
    `https://example.test/api/wheels/${shareId}/suggestions/${suggestionId}`,
    {
      method: 'DELETE',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    },
  )
}

function context(shareId: string, suggestionId: string) {
  return {
    params: Promise.resolve({ shareId, suggestionId }),
  } as RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]'>
}

async function run(shareId: string, suggestionId: string, token?: string) {
  const response = await DELETE(
    request(shareId, suggestionId, token),
    context(shareId, suggestionId),
  )
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as { error?: string }),
  }
}

/** A wheel with one pending suggestion on it. */
async function seed() {
  const { shareId, editToken } = await createWheel(
    { title: 'Lunch Friday' },
    db,
  )
  const { suggestion } = await submitSuggestion(shareId, { label: 'Tacos' }, db)

  return { shareId, editToken, suggestionId: suggestion.id }
}

/** Write `count` pending suggestions straight into the subcollection. */
async function seedSuggestions(shareId: string, count: number) {
  const suggestions = db.collection(WHEELS).doc(shareId).collection(SUGGESTIONS)
  const batch = db.batch()
  for (let index = 0; index < count; index += 1) {
    batch.set(suggestions.doc(), {
      label: `Seeded ${index}`,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
    })
  }
  await batch.commit()
}

async function readSuggestions(shareId: string) {
  const snapshot = await db
    .collection(WHEELS)
    .doc(shareId)
    .collection(SUGGESTIONS)
    .get()
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    status: doc.get('status') as string,
  }))
}

async function readWheel(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    options: (snapshot.get('options') ?? []) as { label: string }[],
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

describe('authorization', () => {
  it.each([
    { label: 'no Authorization header', token: undefined, status: 401 },
    { label: 'a token that is not this wheel’s', token: 'wrong', status: 403 },
  ])('refuses $label with $status', async ({ token, status }) => {
    const { shareId, suggestionId } = await seed()

    expect(await run(shareId, suggestionId, token)).toMatchObject({ status })
    expect(
      await readSuggestions(shareId),
      'the suggestion was deleted despite the refusal',
    ).toHaveLength(1)
  })

  it('refuses an editor of another wheel with 403', async () => {
    // The confused-deputy case design doc section 6 calls out explicitly.
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, target.suggestionId, other.editToken),
    ).toMatchObject({ status: 403 })
    expect(await readSuggestions(target.shareId)).toHaveLength(1)
  })

  it('refuses an unknown wheel with 404', async () => {
    const { editToken, suggestionId } = await seed()

    expect(
      await run('a1b2c3d4e5f6g7h8i9j0', suggestionId, editToken),
    ).toMatchObject({ status: 404 })
  })
})

describe('rejecting', () => {
  it('deletes the document rather than flipping its status', async () => {
    const { shareId, editToken, suggestionId } = await seed()

    expect(await run(shareId, suggestionId, editToken)).toEqual({
      status: 204,
      body: null,
    })
    expect(
      await readSuggestions(shareId),
      'a rejected suggestion is still on a queue every participant can read',
    ).toEqual([])
  })

  it('leaves the wheel’s other suggestions alone', async () => {
    const { shareId, editToken, suggestionId } = await seed()
    const { suggestion: keep } = await submitSuggestion(
      shareId,
      { label: 'Ramen' },
      db,
    )

    await run(shareId, suggestionId, editToken)

    expect(await readSuggestions(shareId)).toEqual([
      { id: keep.id, status: 'pending' },
    ])
  })

  it('answers 204 again for one that is already gone', async () => {
    // A retried request, or two editors clearing the same spam. A 404 would
    // show an error for an operation that did exactly what was asked.
    const { shareId, editToken, suggestionId } = await seed()

    await run(shareId, suggestionId, editToken)

    expect(await run(shareId, suggestionId, editToken)).toMatchObject({
      status: 204,
    })
  })

  it('clears an accepted suggestion without touching the option it made', async () => {
    // `fromSuggestion` is provenance and nothing dereferences it, so the row can
    // be tidied out of a public queue while the option stays on the wheel.
    const { shareId, editToken, suggestionId } = await seed()
    await acceptSuggestion(shareId, suggestionId, db)

    expect(await run(shareId, suggestionId, editToken)).toMatchObject({
      status: 204,
    })
    expect(await readSuggestions(shareId)).toEqual([])
    expect((await readWheel(shareId)).options.map((o) => o.label)).toEqual([
      'Tacos',
    ])
  })

  it('frees room in a full queue', async () => {
    // The two endpoints in one arc: the cap is what bounds a brigaded wheel, and
    // rejecting is how an editor gets out from under one.
    const { shareId, editToken, suggestionId } = await seed()
    await seedSuggestions(shareId, PENDING_SUGGESTIONS_MAX - 1)

    const blocked = await submit(
      new Request(`https://example.test/api/wheels/${shareId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Turned away' }),
      }),
      {
        params: Promise.resolve({ shareId }),
      } as RouteContext<'/api/wheels/[shareId]/suggestions'>,
    )
    expect(blocked.status).toBe(409)

    await run(shareId, suggestionId, editToken)

    const allowed = await submit(
      new Request(`https://example.test/api/wheels/${shareId}/suggestions`, {
        method: 'POST',
        body: JSON.stringify({ label: 'Let in' }),
      }),
      {
        params: Promise.resolve({ shareId }),
      } as RouteContext<'/api/wheels/[shareId]/suggestions'>,
    )
    expect(allowed.status).toBe(201)
  })
})

describe('suggestions that cannot be rejected', () => {
  it.each([
    { label: 'an unknown suggestion', id: 'a1b2c3d4e5f6g7h8i9j0', status: 204 },
    { label: 'a malformed suggestion ID', id: 'nope', status: 404 },
    {
      // The reason `isSuggestionId` exists: this ID reaches a document path, so
      // an unvalidated one walks out of the subcollection and names a document
      // of the caller's choosing — here, another wheel entirely.
      label: 'a path traversal attempt',
      id: '../../../wheels',
      status: 404,
    },
  ])('answers $status for $label', async ({ id, status }) => {
    // The unknown-but-well-formed ID is a 204 rather than a 404 on purpose: it
    // is indistinguishable from a retry of a delete that already happened.
    const { shareId, editToken } = await seed()

    expect(await run(shareId, id, editToken)).toMatchObject({ status })
  })

  it('cannot reach a suggestion on another wheel', async () => {
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, other.suggestionId, target.editToken),
    ).toMatchObject({ status: 204 })
    expect(
      await readSuggestions(other.shareId),
      'an editor deleted a suggestion on a wheel they hold no token for',
    ).toHaveLength(1)
  })
})

describe('sliding expiry', () => {
  it('slides the wheel and its secret on a reject', async () => {
    // Curating the queue is activity like any other (design doc section 8).
    const { shareId, editToken, suggestionId } = await seed()
    const before = await readWheel(shareId)
    const secretBefore = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    const at = Date.now()
    await run(shareId, suggestionId, editToken)

    const after = await readWheel(shareId)
    const secretAfter = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.expiresAt).toBeGreaterThanOrEqual(at + THIRTY_DAYS_MS)
    expect(
      secretAfter.get('expiresAt').toDate().getTime(),
      'the secret will be reaped before the wheel it unlocks',
    ).toBeGreaterThan(secretBefore.get('expiresAt').toDate().getTime())
  })
})
