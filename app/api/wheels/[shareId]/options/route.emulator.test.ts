import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { createWheel, WHEEL_SECRETS, WHEELS } from '@/lib/wheels/store'
import { OPTIONS_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * POST /api/wheels/{shareId}/options, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * Everything for this route is here, with no unit-project counterpart, for the
 * same reason as the PATCH route next door: authorization runs before the body
 * is read, so every request this route refuses has already read a secret
 * document. There is no path to test without Firestore.
 *
 * The concurrency and cap cases are the point of this file. Both are properties
 * of what Firestore does with `arrayUnion` and with a transaction retry, and
 * neither can be observed against a mock that has already decided the answer.
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

/** A POST request for `shareId`, optionally bearing `token`. */
function post(shareId: string, body: unknown, token?: string): Request {
  return new Request(`https://example.test/api/wheels/${shareId}/options`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

/** The Next.js route context for a given shareId. */
function context(shareId: string) {
  return {
    params: Promise.resolve({ shareId }),
  } as RouteContext<'/api/wheels/[shareId]/options'>
}

type Body = {
  error?: string
  id?: string
  label?: string
  addedAt?: string
  fromSuggestion?: string | null
}

/** Run the handler and return its status and parsed body. */
async function run(shareId: string, body: unknown, token?: string) {
  const response = await POST(post(shareId, body, token), context(shareId))
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as Body),
  }
}

/** A fresh wheel with `count` options already on it, plus its editor token. */
async function seed(count = 0) {
  const { shareId, editToken } = await createWheel(
    {
      title: 'Lunch Friday',
      options: Array.from({ length: count }, (_, index) => ({
        id: `seeded-${index}`,
        label: `Seeded ${index}`,
      })),
    },
    db,
  )
  return { shareId, editToken }
}

type StoredOption = {
  id: string
  label: string
  addedAt: { toDate(): Date }
  fromSuggestion: string | null
}

/** The current stored state of a wheel. */
async function read(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    title: snapshot.get('title') as string,
    options: snapshot.get('options') as StoredOption[],
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

describe('authorization', () => {
  it('adds an option with a valid editor token', async () => {
    const { shareId, editToken } = await seed()

    const { status } = await run(shareId, { label: 'Tacos' }, editToken)

    expect(status).toBe(201)
    expect((await read(shareId)).options.map((o) => o.label)).toEqual(['Tacos'])
  })

  it.each([
    { label: 'no Authorization header', token: undefined, status: 401 },
    { label: 'a token that is not this wheel’s', token: 'wrong', status: 403 },
  ])('refuses $label with $status', async ({ token, status }) => {
    const { shareId } = await seed()

    expect(await run(shareId, { label: 'Tacos' }, token)).toMatchObject({
      status,
    })
    expect(
      (await read(shareId)).options,
      'the option was written despite the refusal',
    ).toEqual([])
  })

  it('refuses an editor of another wheel with 403', async () => {
    // The confused-deputy case design doc section 6 calls out explicitly: a
    // token that is valid somewhere must not be valid here.
    const target = await seed()
    const other = await seed()

    expect(
      await run(target.shareId, { label: 'Hijacked' }, other.editToken),
    ).toMatchObject({ status: 403 })
    expect((await read(target.shareId)).options).toEqual([])
  })

  it('refuses an unknown wheel with 404', async () => {
    const { editToken } = await seed()

    expect(
      await run('a1b2c3d4e5f6g7h8i9j0', { label: 'Tacos' }, editToken),
    ).toMatchObject({ status: 404 })
  })

  it('checks authorization before the body', async () => {
    // An unauthenticated caller must not learn whether their body was well
    // formed. This body is independently a 400, so a 401 here is only possible
    // if the token was checked first.
    const { shareId } = await seed()

    expect(await run(shareId, { label: 'x'.repeat(500) })).toMatchObject({
      status: 401,
    })
  })
})

describe('the created option', () => {
  it('is returned with a generated id', async () => {
    const { shareId, editToken } = await seed()

    const { body } = await run(shareId, { label: 'Tacos' }, editToken)

    expect(body?.id).toEqual(expect.any(String))
    expect(body?.id?.length).toBeGreaterThan(0)
    expect(body?.label).toBe('Tacos')
    expect(body?.fromSuggestion).toBeNull()
    expect(Date.parse(body?.addedAt ?? '')).not.toBeNaN()
  })

  it('is returned with the id it was stored under', async () => {
    // The client keys its animations on this id and addresses the DELETE
    // endpoint with it. A response id that did not match the stored one would
    // leave every option undeletable until a reload.
    const { shareId, editToken } = await seed()

    const { body } = await run(shareId, { label: 'Tacos' }, editToken)

    expect((await read(shareId)).options[0].id).toBe(body?.id)
  })

  it('gets a different id each time, for the same label', async () => {
    const { shareId, editToken } = await seed()

    const first = await run(shareId, { label: 'Tacos' }, editToken)
    const second = await run(shareId, { label: 'Tacos' }, editToken)

    expect(first.body?.id).not.toBe(second.body?.id)
    expect((await read(shareId)).options).toHaveLength(2)
  })

  it('stores the sanitised label', async () => {
    const { shareId, editToken } = await seed()

    const { body } = await run(
      shareId,
      { label: '  Thai\t\tGreen Curry ' },
      editToken,
    )

    expect(body?.label).toBe('Thai Green Curry')
    expect((await read(shareId)).options[0].label).toBe('Thai Green Curry')
  })

  it('appends rather than prepending, so insertion order is display order', async () => {
    const { shareId, editToken } = await seed()

    await run(shareId, { label: 'First' }, editToken)
    await run(shareId, { label: 'Second' }, editToken)
    await run(shareId, { label: 'Third' }, editToken)

    expect((await read(shareId)).options.map((o) => o.label)).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })
})

describe('rejected bodies', () => {
  it.each([
    { label: 'an absent body', body: undefined, code: 'invalid_label' },
    { label: 'an empty body', body: {}, code: 'invalid_label' },
    { label: 'a null label', body: { label: null }, code: 'invalid_label' },
    {
      label: 'a non-string label',
      body: { label: 42 },
      code: 'invalid_label',
    },
    { label: 'an empty label', body: { label: '   ' }, code: 'empty_label' },
    {
      // Escapes rather than the characters themselves, for the reason
      // ZERO_WIDTH_SPACE gives in lib/wheels/validation.ts: a literal U+200B is
      // invisible to every reader and fair game for any editor to eat. This is
      // the case where that would fail open — strip the two and the label is
      // '', which is still `empty_label`, so the test would keep passing while
      // no longer testing zero-width spaces at all.
      label: 'a label of zero-width spaces',
      body: { label: '\u200b\u200b' },
      code: 'empty_label',
    },
    {
      label: 'an over-length label',
      body: { label: 'x'.repeat(61) },
      code: 'label_too_long',
    },
    {
      label: 'a label with a control character',
      body: { label: 'Tac\u0007os' },
      code: 'invalid_label',
    },
    {
      label: 'an unknown key',
      body: { label: 'Tacos', colour: 'red' },
      code: 'invalid_body',
    },
    {
      label: 'a client-supplied id',
      body: { label: 'Tacos', id: 'mine' },
      code: 'id_not_settable',
    },
    {
      label: 'a fromSuggestion',
      body: { label: 'Tacos', fromSuggestion: 'made-up' },
      code: 'invalid_body',
    },
  ])('refuses $label with 400 $code', async ({ body, code }) => {
    const { shareId, editToken } = await seed()

    expect(await run(shareId, body, editToken)).toEqual({
      status: 400,
      body: expect.objectContaining({ error: code }),
    })
  })

  it('writes nothing when the body is refused', async () => {
    const { shareId, editToken } = await seed()
    const before = await read(shareId)

    await run(shareId, { label: 'x'.repeat(500) }, editToken)

    const after = await read(shareId)
    expect(after.options).toEqual([])
    expect(after.updatedAt).toBe(before.updatedAt)
    expect(after.expiresAt).toBe(before.expiresAt)
  })
})

describe('the option cap', () => {
  it('accepts the option that fills the wheel', async () => {
    const { shareId, editToken } = await seed(OPTIONS_MAX - 1)

    expect(await run(shareId, { label: 'Last' }, editToken)).toMatchObject({
      status: 201,
    })
    expect((await read(shareId)).options).toHaveLength(OPTIONS_MAX)
  })

  it('refuses the one after that with 409 options_full', async () => {
    const { shareId, editToken } = await seed(OPTIONS_MAX)

    expect(await run(shareId, { label: 'One too many' }, editToken)).toEqual({
      status: 409,
      body: expect.objectContaining({ error: 'options_full' }),
    })
    expect((await read(shareId)).options).toHaveLength(OPTIONS_MAX)
  })

  it('counts against the wheel rather than against the request', async () => {
    // The cap is read inside the transaction that writes, so a client cannot
    // walk past it by adding one at a time.
    const { shareId, editToken } = await seed(OPTIONS_MAX - 2)

    await run(shareId, { label: 'Penultimate' }, editToken)
    await run(shareId, { label: 'Last' }, editToken)
    const overflow = await run(shareId, { label: 'Too many' }, editToken)

    expect(overflow.status).toBe(409)
    expect((await read(shareId)).options).toHaveLength(OPTIONS_MAX)
  })
})

describe('concurrent editors', () => {
  // Timed out for the reason spelled out on the five-way case below, and note
  // that two racers cost the same as five: every contended case in this suite
  // runs around three seconds on an idle machine, because the price is one
  // backoff cycle rather than one per racer. Vitest's 5s default leaves that
  // barely any headroom while every uncontended test here finishes in under a
  // tenth of a second, so the default is not a budget any of these can rely on.
  it('lands both of two simultaneous adds', { timeout: 20_000 }, async () => {
    // The lost-update bug the granular endpoints exist to prevent: the edit URL
    // is transferable (design doc section 2), so two editors adding at the same
    // moment is a normal case, and a whole-array write would have the second
    // erase the first.
    const { shareId, editToken } = await seed()

    const [first, second] = await Promise.all([
      run(shareId, { label: 'Tacos' }, editToken),
      run(shareId, { label: 'Ramen' }, editToken),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const labels = (await read(shareId)).options.map((o) => o.label)
    expect(labels, 'one of two concurrent adds was lost').toHaveLength(2)
    expect(labels.toSorted()).toEqual(['Ramen', 'Tacos'])
  })

  // Slow on purpose, and the timeout says so rather than hiding it. The cap has
  // to be read inside the transaction that writes, so simultaneous adds to one
  // document serialise and each loser backs off for around a second before
  // retrying. That latency is what an exact cap costs, and it is paid only by
  // editors racing each other on the same wheel.
  //
  // Five, not fifty: the Admin SDK gives a transaction five attempts, and a
  // request that spent them all would be a 500 rather than a lost write. Sizing
  // this at a table of people all adding at once keeps it a test of the
  // property — nothing is lost — rather than a measurement of the retry budget.
  it('lands all of five simultaneous adds', { timeout: 20_000 }, async () => {
    const { shareId, editToken } = await seed()
    const labels = Array.from({ length: 5 }, (_, index) => `Option ${index}`)

    const results = await Promise.all(
      labels.map((label) => run(shareId, { label }, editToken)),
    )

    expect(results.map((r) => r.status)).toEqual(labels.map(() => 201))

    const stored = (await read(shareId)).options
    expect(stored.map((o) => o.label).toSorted()).toEqual(labels.toSorted())
    expect(
      new Set(stored.map((o) => o.id)).size,
      'two options were written with the same id',
    ).toBe(labels.length)
  })

  // Timed out for the same reason again, with a fixture that adds to it: seeding
  // one short of the cap writes 49 options before the race even starts.
  it(
    'does not overrun the cap under concurrency',
    { timeout: 20_000 },
    async () => {
      // Two adds racing against the last free slot. Whichever order they resolve
      // in, the wheel must not end up holding more than the cap.
      const { shareId, editToken } = await seed(OPTIONS_MAX - 1)

      const results = await Promise.all([
        run(shareId, { label: 'Racer one' }, editToken),
        run(shareId, { label: 'Racer two' }, editToken),
      ])

      expect(results.map((r) => r.status).toSorted()).toEqual([201, 409])
      expect((await read(shareId)).options).toHaveLength(OPTIONS_MAX)
    },
  )
})

describe('sliding expiry', () => {
  it('refreshes updatedAt and expiresAt on a successful add', async () => {
    const { shareId, editToken } = await seed()
    const before = await read(shareId)

    const at = Date.now()
    await run(shareId, { label: 'Tacos' }, editToken)

    const after = await read(shareId)
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.expiresAt).toBeGreaterThanOrEqual(at + THIRTY_DAYS_MS)
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt)
  })

  it('slides the secret’s expiry with the wheel’s', async () => {
    // Sliding only the wheel is the half-measure that leaves the secret reaped
    // at its original 30 days while an actively edited wheel lives on — a wheel
    // nobody can edit again, with no way to reissue the token.
    const { shareId, editToken } = await seed()
    const before = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    await run(shareId, { label: 'Tacos' }, editToken)

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

  it('does not slide expiry for a refused add', async () => {
    const { shareId, editToken } = await seed(OPTIONS_MAX)
    const before = await read(shareId)

    await run(shareId, { label: 'One too many' }, editToken)

    expect((await read(shareId)).expiresAt).toBe(before.expiresAt)
  })
})
