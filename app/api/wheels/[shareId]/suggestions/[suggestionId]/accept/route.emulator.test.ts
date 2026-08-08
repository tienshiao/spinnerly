import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  createWheel,
  submitSuggestion,
  SUGGESTIONS,
  WHEEL_SECRETS,
  WHEELS,
} from '@/lib/wheels/store'
import { OPTIONS_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * POST /api/wheels/{shareId}/suggestions/{suggestionId}/accept, against a live
 * Firestore. Run with `npm run test:emulator`.
 *
 * Everything for this route is here, with no unit-project counterpart:
 * authorization reads a secret document before anything else happens, so there
 * is no path through this handler that does not touch Firestore.
 *
 * The concurrency case is the point of the file. Design doc section 4 requires
 * the `arrayUnion` and the status flip to be one transaction precisely so that a
 * double-click cannot duplicate an option, and that is a property of what
 * Firestore does with two transactions racing over one document — not something
 * a mock can be asked to confirm.
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

function post(shareId: string, suggestionId: string, token?: string): Request {
  return new Request(
    `https://example.test/api/wheels/${shareId}/suggestions/${suggestionId}/accept`,
    {
      method: 'POST',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    },
  )
}

function context(shareId: string, suggestionId: string) {
  return {
    params: Promise.resolve({ shareId, suggestionId }),
  } as RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]/accept'>
}

async function run(shareId: string, suggestionId: string, token?: string) {
  const response = await POST(
    post(shareId, suggestionId, token),
    context(shareId, suggestionId),
  )
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as { error?: string }),
  }
}

/** A wheel with `options` options already on it, and one pending suggestion. */
async function seed(options = 0) {
  const { shareId, editToken } = await createWheel(
    {
      title: 'Lunch Friday',
      options: Array.from({ length: options }, (_, index) => ({
        id: `seeded-${index}`,
        label: `Seeded ${index}`,
      })),
    },
    db,
  )

  const suggestion = await submitSuggestion(shareId, { label: 'Tacos' }, db)

  return { shareId, editToken, suggestionId: suggestion.id }
}

type StoredOption = {
  id: string
  label: string
  fromSuggestion: string | null
}

async function readWheel(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    options: (snapshot.get('options') ?? []) as StoredOption[],
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

async function readSuggestion(shareId: string, suggestionId: string) {
  const snapshot = await db
    .collection(WHEELS)
    .doc(shareId)
    .collection(SUGGESTIONS)
    .doc(suggestionId)
    .get()
  return { exists: snapshot.exists, status: snapshot.get('status') as string }
}

describe('authorization', () => {
  it.each([
    { label: 'no Authorization header', token: undefined, status: 401 },
    { label: 'a token that is not this wheel’s', token: 'wrong', status: 403 },
  ])('refuses $label with $status', async ({ token, status }) => {
    const { shareId, suggestionId } = await seed()

    expect(await run(shareId, suggestionId, token)).toMatchObject({ status })
    expect((await readWheel(shareId)).options).toEqual([])
    expect((await readSuggestion(shareId, suggestionId)).status).toBe('pending')
  })

  it('refuses an editor of another wheel with 403', async () => {
    // The confused-deputy case design doc section 6 calls out explicitly. It
    // bites harder here than on the option routes: accepting is how text
    // someone else submitted gets onto a wheel, so a token valid anywhere would
    // let an outsider curate a stranger's list.
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, target.suggestionId, other.editToken),
    ).toMatchObject({ status: 403 })
    expect((await readWheel(target.shareId)).options).toEqual([])
  })

  it('refuses an unknown wheel with 404', async () => {
    const { editToken, suggestionId } = await seed()

    expect(
      await run('a1b2c3d4e5f6g7h8i9j0', suggestionId, editToken),
    ).toMatchObject({ status: 404 })
  })
})

describe('accepting', () => {
  it('appends the option and flips the suggestion', async () => {
    const { shareId, editToken, suggestionId } = await seed()

    expect(await run(shareId, suggestionId, editToken)).toEqual({
      status: 204,
      body: null,
    })

    const { options } = await readWheel(shareId)
    expect(options).toHaveLength(1)
    expect(options[0].label).toBe('Tacos')
    expect(await readSuggestion(shareId, suggestionId)).toEqual({
      exists: true,
      status: 'accepted',
    })
  })

  it('records where the option came from', async () => {
    // `fromSuggestion` is the provenance design doc section 4 asks for, and it
    // is the one thing distinguishing an accepted option from a typed one.
    const { shareId, editToken, suggestionId } = await seed()

    await run(shareId, suggestionId, editToken)

    expect((await readWheel(shareId)).options[0].fromSuggestion).toBe(
      suggestionId,
    )
  })

  it('appends after the options already there', async () => {
    const { shareId, editToken, suggestionId } = await seed(2)

    await run(shareId, suggestionId, editToken)

    expect((await readWheel(shareId)).options.map((o) => o.label)).toEqual([
      'Seeded 0',
      'Seeded 1',
      'Tacos',
    ])
  })
})

describe('accepting twice', () => {
  it('adds the option exactly once when clicked twice in a row', async () => {
    const { shareId, editToken, suggestionId } = await seed()

    const first = await run(shareId, suggestionId, editToken)
    const second = await run(shareId, suggestionId, editToken)

    expect(first.status).toBe(204)
    expect(
      second.status,
      'a retried accept must not read as a failure for an operation that succeeded',
    ).toBe(204)
    expect((await readWheel(shareId)).options).toHaveLength(1)
  })

  // Timed out explicitly, like the concurrency cases in the options suite, and
  // for the same reason: this test deliberately makes two transactions contend
  // on one document, so the loser backs off for around a second before retrying
  // and the Admin SDK allows it five attempts. That is seconds of latency by
  // design, and against Vitest's 5s default it is a test that passes on an idle
  // machine and fails on a busy one — which is what it did, once, in CI-like
  // conditions with a build running alongside it.
  //
  // Raising the budget rather than reducing the contention: the contention is
  // the property under test, and a flake here would read as the duplicate this
  // guards against rather than as a slow machine.
  it(
    'adds the option exactly once when two accepts race',
    { timeout: 20_000 },
    async () => {
      // The case the transaction exists for. Both requests read `pending` at the
      // same moment unless the read and the write are one atomic step.
      const { shareId, editToken, suggestionId } = await seed()

      const results = await Promise.all([
        run(shareId, suggestionId, editToken),
        run(shareId, suggestionId, editToken),
      ])

      expect(results.map((r) => r.status)).toEqual([204, 204])
      expect(
        (await readWheel(shareId)).options,
        'a double-click duplicated the option',
      ).toHaveLength(1)
    },
  )

  it('writes nothing at all on the second accept', async () => {
    // Not even the expiry slide. A second click is not activity, and sliding on
    // it would make a wheel's lifetime depend on how often its editor tapped.
    const { shareId, editToken, suggestionId } = await seed()
    await run(shareId, suggestionId, editToken)
    const before = await readWheel(shareId)

    await run(shareId, suggestionId, editToken)

    expect(await readWheel(shareId)).toMatchObject({
      updatedAt: before.updatedAt,
      expiresAt: before.expiresAt,
    })
  })
})

describe('suggestions that cannot be accepted', () => {
  it.each([
    { label: 'an unknown suggestion', id: 'a1b2c3d4e5f6g7h8i9j0' },
    { label: 'a malformed suggestion ID', id: 'nope' },
    {
      // The reason `isSuggestionId` exists: this ID reaches a document path, so
      // an unvalidated one walks out of the subcollection into a document of
      // the caller's choosing.
      label: 'a path traversal attempt',
      id: '..%2F..%2F..%2Fwheels',
    },
  ])('refuses $label with 404 no_such_suggestion', async ({ id }) => {
    const { shareId, editToken } = await seed()

    expect(await run(shareId, id, editToken)).toMatchObject({
      status: 404,
      body: { error: 'no_such_suggestion' },
    })
  })

  it('refuses a suggestion belonging to another wheel', async () => {
    // Suggestions are scoped by their parent path, so an editor cannot reach
    // across to one submitted somewhere else — even holding a valid token for
    // the wheel they are writing to.
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, other.suggestionId, target.editToken),
    ).toMatchObject({ status: 404, body: { error: 'no_such_suggestion' } })
    expect((await readWheel(target.shareId)).options).toEqual([])
    expect(
      (await readSuggestion(other.shareId, other.suggestionId)).status,
    ).toBe('pending')
  })

  it('refuses one that would take the wheel past the option cap', async () => {
    const { shareId, editToken, suggestionId } = await seed(OPTIONS_MAX)

    expect(await run(shareId, suggestionId, editToken)).toMatchObject({
      status: 409,
      body: { error: 'options_full' },
    })
    expect(
      (await readSuggestion(shareId, suggestionId)).status,
      'the suggestion was consumed by an accept that did not happen',
    ).toBe('pending')
    expect((await readWheel(shareId)).options).toHaveLength(OPTIONS_MAX)
  })

  it('accepts the one that fills the wheel', async () => {
    const { shareId, editToken, suggestionId } = await seed(OPTIONS_MAX - 1)

    expect(await run(shareId, suggestionId, editToken)).toMatchObject({
      status: 204,
    })
    expect((await readWheel(shareId)).options).toHaveLength(OPTIONS_MAX)
  })
})

describe('sliding expiry', () => {
  it('slides the wheel and its secret on a successful accept', async () => {
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

  it('does not slide expiry for a refused accept', async () => {
    const { shareId, editToken, suggestionId } = await seed(OPTIONS_MAX)
    const before = await readWheel(shareId)

    await run(shareId, suggestionId, editToken)

    expect((await readWheel(shareId)).expiresAt).toBe(before.expiresAt)
  })
})
