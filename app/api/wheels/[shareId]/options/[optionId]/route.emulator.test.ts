import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { createWheel, WHEEL_SECRETS, WHEELS } from '@/lib/wheels/store'
import { POST as ADD } from '../route'
import { DELETE } from './route'

/**
 * DELETE /api/wheels/{shareId}/options/{optionId}, against a live Firestore.
 * Run with `npm run test:emulator`.
 *
 * No unit-project counterpart, for the same reason as its siblings:
 * authorization runs first, so every request this route refuses has already read
 * a secret document.
 *
 * The add route is imported rather than reimplemented so the ids under test are
 * the ids a client would actually hold — a fixture that minted its own would
 * pass while the two halves of the API disagreed about what an option ID is.
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

/** A DELETE request, optionally bearing `token`. */
function del(shareId: string, optionId: string, token?: string): Request {
  return new Request(
    `https://example.test/api/wheels/${shareId}/options/${optionId}`,
    {
      method: 'DELETE',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    },
  )
}

/** Run the handler and return its status and parsed error body, if any. */
async function run(shareId: string, optionId: string, token?: string) {
  const response = await DELETE(del(shareId, optionId, token), {
    params: Promise.resolve({ shareId, optionId }),
  } as RouteContext<'/api/wheels/[shareId]/options/[optionId]'>)
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as { error?: string }),
  }
}

/** Add an option through the real route and return its id. */
async function add(
  shareId: string,
  label: string,
  token: string,
): Promise<string> {
  const response = await ADD(
    new Request(`https://example.test/api/wheels/${shareId}/options`, {
      method: 'POST',
      body: JSON.stringify({ label }),
      headers: { authorization: `Bearer ${token}` },
    }),
    {
      params: Promise.resolve({ shareId }),
    } as RouteContext<'/api/wheels/[shareId]/options'>,
  )
  expect(response.status, `adding "${label}" failed`).toBe(201)
  const { id } = (await response.json()) as { id: string }
  return id
}

/** A wheel carrying `labels`, with the id of each, plus its editor token. */
async function seed(labels: string[] = ['Tacos']) {
  const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)
  const ids: Record<string, string> = {}
  for (const label of labels) {
    // Sequential rather than concurrent: the ids are what the test asserts on,
    // so the order they were added in should be the order they are stored in.
    ids[label] = await add(shareId, label, editToken)
  }
  return { shareId, editToken, ids }
}

type StoredOption = { id: string; label: string }

/** The current stored state of a wheel. */
async function read(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    options: snapshot.get('options') as StoredOption[],
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

/** The labels currently on a wheel, in stored order. */
async function labelsOn(shareId: string): Promise<string[]> {
  return (await read(shareId)).options.map((option) => option.label)
}

describe('authorization', () => {
  it('removes the option with a valid editor token', async () => {
    const { shareId, editToken, ids } = await seed()

    const { status } = await run(shareId, ids.Tacos, editToken)

    expect(status).toBe(204)
    expect(await labelsOn(shareId)).toEqual([])
  })

  it.each([
    { label: 'no Authorization header', token: undefined, status: 401 },
    { label: 'a token that is not this wheel’s', token: 'wrong', status: 403 },
  ])('refuses $label with $status', async ({ token, status }) => {
    const { shareId, ids } = await seed()

    expect(await run(shareId, ids.Tacos, token)).toMatchObject({ status })
    expect(
      await labelsOn(shareId),
      'the option was removed despite the refusal',
    ).toEqual(['Tacos'])
  })

  it('refuses an editor of another wheel with 403', async () => {
    // The confused-deputy case design doc section 6 calls out explicitly. It
    // matters more here than anywhere: a token that validated globally would let
    // anyone with any wheel empty everybody else's.
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, target.ids.Tacos, other.editToken),
    ).toMatchObject({ status: 403 })
    expect(await labelsOn(target.shareId)).toEqual(['Tacos'])
  })

  it('refuses an unknown wheel with 404', async () => {
    const { editToken, ids } = await seed()

    expect(
      await run('a1b2c3d4e5f6g7h8i9j0', ids.Tacos, editToken),
    ).toMatchObject({ status: 404 })
  })

  it('refuses an over-long optionId with 400', async () => {
    const { shareId, editToken } = await seed()

    expect(await run(shareId, 'x'.repeat(500), editToken)).toEqual({
      status: 400,
      body: expect.objectContaining({ error: 'invalid_option_id' }),
    })
  })
})

describe('removing exactly one option', () => {
  it('leaves the others in place and in order', async () => {
    const { shareId, editToken, ids } = await seed([
      'Tacos',
      'Ramen',
      'Pizza',
      'Curry',
    ])

    await run(shareId, ids.Ramen, editToken)

    expect(await labelsOn(shareId)).toEqual(['Tacos', 'Pizza', 'Curry'])
  })

  it('removes only the named one when two share a label', async () => {
    // `arrayRemove` matches whole elements by deep equality, so this is the case
    // that would go wrong if the stored elements were not distinguished by id
    // and addedAt: both duplicates would vanish on one request.
    const { shareId, editToken } = await seed()
    const first = await add(shareId, 'Ramen', editToken)
    const second = await add(shareId, 'Ramen', editToken)

    await run(shareId, first, editToken)

    const options = (await read(shareId)).options
    expect(options.map((o) => o.label)).toEqual(['Tacos', 'Ramen'])
    expect(options.map((o) => o.id)).toEqual([expect.any(String), second])
  })

  it('empties a wheel one option at a time', async () => {
    const { shareId, editToken, ids } = await seed(['Tacos', 'Ramen'])

    await run(shareId, ids.Tacos, editToken)
    await run(shareId, ids.Ramen, editToken)

    expect(await labelsOn(shareId)).toEqual([])
  })
})

describe('idempotency', () => {
  it('answers 204 when the option is already gone', async () => {
    // A client that never saw the first response must be able to retry without
    // being shown an error for an operation that succeeded.
    const { shareId, editToken, ids } = await seed()
    await run(shareId, ids.Tacos, editToken)

    expect(await run(shareId, ids.Tacos, editToken)).toMatchObject({
      status: 204,
    })
    expect(await labelsOn(shareId)).toEqual([])
  })

  it('answers 204 for an id that never existed', async () => {
    const { shareId, editToken } = await seed()

    expect(await run(shareId, 'never-existed', editToken)).toMatchObject({
      status: 204,
    })
    expect(
      await labelsOn(shareId),
      'an unmatched id removed something',
    ).toEqual(['Tacos'])
  })

  it('answers 204 for an option belonging to another wheel', async () => {
    // Ids are unique per option rather than per wheel, but an editor of A must
    // not be able to probe for B's ids by watching the status code either way.
    const target = await seed()
    const other = await seed(['Ramen'])

    expect(
      await run(target.shareId, other.ids.Ramen, target.editToken),
    ).toMatchObject({ status: 204 })
    expect(await labelsOn(other.shareId)).toEqual(['Ramen'])
    expect(await labelsOn(target.shareId)).toEqual(['Tacos'])
  })

  it('runs twice concurrently without failing either request', async () => {
    const { shareId, editToken, ids } = await seed(['Tacos', 'Ramen'])

    const results = await Promise.all([
      run(shareId, ids.Tacos, editToken),
      run(shareId, ids.Tacos, editToken),
    ])

    expect(results.map((r) => r.status)).toEqual([204, 204])
    expect(await labelsOn(shareId)).toEqual(['Ramen'])
  })
})

describe('concurrent editors', () => {
  it('does not lose an add that lands during a remove', async () => {
    // The two mutations commute (design doc section 6): a remove of one option
    // and an add of another do not interact. A whole-array write on either side
    // would break that.
    const { shareId, editToken, ids } = await seed(['Tacos', 'Ramen'])

    const [removed, added] = await Promise.all([
      run(shareId, ids.Tacos, editToken),
      add(shareId, 'Pizza', editToken),
    ])

    expect(removed.status).toBe(204)

    const options = (await read(shareId)).options
    expect(
      options.map((o) => o.label).toSorted(),
      'the add and the remove overwrote each other',
    ).toEqual(['Pizza', 'Ramen'])
    expect(options.some((o) => o.id === added)).toBe(true)
  })

  it('removes two different options at once', async () => {
    const { shareId, editToken, ids } = await seed(['Tacos', 'Ramen', 'Pizza'])

    await Promise.all([
      run(shareId, ids.Tacos, editToken),
      run(shareId, ids.Pizza, editToken),
    ])

    expect(await labelsOn(shareId)).toEqual(['Ramen'])
  })
})

describe('sliding expiry', () => {
  it('refreshes updatedAt and expiresAt on a successful remove', async () => {
    const { shareId, editToken, ids } = await seed()
    const before = await read(shareId)

    const at = Date.now()
    await run(shareId, ids.Tacos, editToken)

    const after = await read(shareId)
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.expiresAt).toBeGreaterThanOrEqual(at + THIRTY_DAYS_MS)
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt)
  })

  it('slides the secret’s expiry with the wheel’s', async () => {
    const { shareId, editToken, ids } = await seed()
    const before = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    await run(shareId, ids.Tacos, editToken)

    const after = await db.collection(WHEEL_SECRETS).doc(shareId).get()
    const wheel = await read(shareId)

    expect(
      after.get('expiresAt').toDate().getTime(),
      'the secret will be reaped before the wheel it unlocks',
    ).toBeGreaterThan(before.get('expiresAt').toDate().getTime())
    expect(
      after.get('expiresAt').toDate().getTime(),
      'the slide collapsed the secret’s margin over the wheel',
    ).toBeGreaterThan(wheel.expiresAt)
  })

  it('slides expiry even when nothing matched', async () => {
    // Deliberate: a retried delete is ordinary editor activity, and a wheel's
    // lifetime should not depend on whether a client's first attempt got its
    // response back.
    const { shareId, editToken } = await seed()
    const before = await read(shareId)

    await run(shareId, 'never-existed', editToken)

    expect((await read(shareId)).expiresAt).toBeGreaterThan(before.expiresAt)
  })

  it('does not slide expiry for a refused remove', async () => {
    const { shareId, ids } = await seed()
    const before = await read(shareId)

    await run(shareId, ids.Tacos, 'wrong')

    expect((await read(shareId)).expiresAt).toBe(before.expiresAt)
  })
})
