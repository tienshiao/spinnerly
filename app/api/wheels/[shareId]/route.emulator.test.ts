import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { createWheel, WHEEL_SECRETS, WHEELS } from '@/lib/wheels/store'
import { PATCH } from './route'

/**
 * PATCH /api/wheels/{shareId}, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * Everything for this route is here, with no unit-project counterpart — unlike
 * POST /api/wheels, where the rejection paths deliberately live in the fast
 * project to prove they never reach the database. That split does not apply
 * here: authorization runs before the body is read, so every request this route
 * refuses has already read a secret document. There is no path to test without
 * Firestore.
 *
 * Reads go through `getAdminDb()`, the same handle the route uses. See the note
 * in ../route.emulator.test.ts for why a second app would be actively wrong.
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

/** A PATCH request for `shareId`, optionally bearing `token`. */
function patch(shareId: string, body: unknown, token?: string): Request {
  return new Request(`https://example.test/api/wheels/${shareId}`, {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

/** The Next.js route context for a given shareId. */
function context(shareId: string) {
  return {
    params: Promise.resolve({ shareId }),
  } as RouteContext<'/api/wheels/[shareId]'>
}

/** Run the handler and return its status and parsed error body, if any. */
async function run(shareId: string, body: unknown, token?: string) {
  const response = await PATCH(patch(shareId, body, token), context(shareId))
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as { error?: string }),
  }
}

/** A fresh wheel with a known title, plus its editor token. */
async function seed(title = 'Lunch Friday') {
  const { shareId, editToken } = await createWheel({ title }, db)
  return { shareId, editToken }
}

/** The current stored state of a wheel. */
async function read(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    title: snapshot.get('title') as string,
    suggestionsOpen: snapshot.get('suggestionsOpen') as boolean,
    options: snapshot.get('options') as unknown[],
    updatedAt: snapshot.get('updatedAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

describe('authorization', () => {
  it('updates the wheel with a valid editor token', async () => {
    const { shareId, editToken } = await seed()

    const { status } = await run(shareId, { title: 'Dinner' }, editToken)

    expect(status).toBe(204)
    expect((await read(shareId)).title).toBe('Dinner')
  })

  it.each([
    { label: 'no Authorization header', token: undefined, status: 401 },
    { label: 'a token that is not this wheel’s', token: 'wrong', status: 403 },
  ])('refuses $label with $status', async ({ token, status }) => {
    const { shareId } = await seed()

    expect(await run(shareId, { title: 'Dinner' }, token)).toMatchObject({
      status,
    })
    expect(
      (await read(shareId)).title,
      'the wheel was written despite the refusal',
    ).toBe('Lunch Friday')
  })

  it('refuses an editor of another wheel with 403', async () => {
    // The confused-deputy case design doc section 6 calls out explicitly: a
    // token that is valid somewhere must not be valid here.
    const target = await seed('Target')
    const other = await seed('Other')

    expect(
      await run(target.shareId, { title: 'Hijacked' }, other.editToken),
    ).toMatchObject({ status: 403 })
    expect((await read(target.shareId)).title).toBe('Target')
  })

  it('refuses an unknown wheel with 404', async () => {
    const { editToken } = await seed()

    expect(
      await run('a1b2c3d4e5f6g7h8i9j0', { title: 'Dinner' }, editToken),
    ).toMatchObject({ status: 404 })
  })

  it.each([
    { label: 'an over-length title', body: { title: 'x'.repeat(500) } },
    { label: 'an unknown key', body: { colour: 'red' } },
    { label: 'an options key', body: { options: [] } },
  ])('checks authorization before the body, given $label', async ({ body }) => {
    // An unauthenticated caller must not learn whether their body was well
    // formed. Each of these bodies is independently a 400, so a 401 here is
    // only possible if the token was checked first.
    //
    // The body has to be one that would actually be refused: an absent or
    // empty body parses cleanly and comes back 401 under either ordering,
    // which makes it useless as evidence of the order.
    const { shareId } = await seed()

    expect(await run(shareId, body, undefined)).toMatchObject({ status: 401 })
  })
})

describe('partial updates', () => {
  it('updates title and suggestionsOpen together', async () => {
    const { shareId, editToken } = await seed()

    await run(shareId, { title: 'Dinner', suggestionsOpen: false }, editToken)

    const wheel = await read(shareId)
    expect(wheel.title).toBe('Dinner')
    expect(wheel.suggestionsOpen).toBe(false)
  })

  it('leaves suggestionsOpen untouched when only the title is sent', async () => {
    const { shareId, editToken } = await seed()
    await run(shareId, { suggestionsOpen: false }, editToken)

    await run(shareId, { title: 'Dinner' }, editToken)

    const wheel = await read(shareId)
    expect(wheel.title).toBe('Dinner')
    expect(
      wheel.suggestionsOpen,
      'a title-only patch reopened suggestions',
    ).toBe(false)
  })

  it('leaves the title untouched when only suggestionsOpen is sent', async () => {
    // The kill switch is reached from the Suggestions panel while a wheel is
    // being spammed. Renaming the wheel as a side effect of closing it would be
    // the worst possible moment for it.
    const { shareId, editToken } = await seed('Lunch Friday')

    await run(shareId, { suggestionsOpen: false }, editToken)

    const wheel = await read(shareId)
    expect(wheel.title, 'closing suggestions renamed the wheel').toBe(
      'Lunch Friday',
    )
    expect(wheel.suggestionsOpen).toBe(false)
  })

  it('reopens suggestions', async () => {
    const { shareId, editToken } = await seed()
    await run(shareId, { suggestionsOpen: false }, editToken)

    await run(shareId, { suggestionsOpen: true }, editToken)

    expect((await read(shareId)).suggestionsOpen).toBe(true)
  })

  it('stores the sanitised title', async () => {
    const { shareId, editToken } = await seed()

    await run(shareId, { title: '  Dinner\t\tTonight ' }, editToken)

    expect((await read(shareId)).title).toBe('Dinner Tonight')
  })
})

describe('the options key', () => {
  it('is rejected rather than ignored', async () => {
    // Silently dropping it would leave a client believing it had replaced the
    // option list. A whole-array write is the lost-update bug the granular
    // add and remove endpoints exist to avoid.
    const { shareId, editToken } = await seed()

    expect(
      await run(shareId, { options: [{ id: 'x', label: 'Tacos' }] }, editToken),
    ).toEqual({
      status: 400,
      body: expect.objectContaining({ error: 'options_not_patchable' }),
    })
  })

  it('is rejected even alongside a valid title', async () => {
    const { shareId, editToken } = await seed()

    const { status } = await run(
      shareId,
      { title: 'Dinner', options: [] },
      editToken,
    )

    expect(status).toBe(400)
    expect(
      (await read(shareId)).title,
      'the title was written despite the rejection',
    ).toBe('Lunch Friday')
  })

  it('leaves the stored options untouched', async () => {
    const { shareId, editToken } = await seed()

    await run(shareId, { options: [{ id: 'x', label: 'Tacos' }] }, editToken)

    expect((await read(shareId)).options).toEqual([])
  })
})

describe('rejected bodies', () => {
  it.each([
    { label: 'an empty patch', body: {}, code: 'empty_patch' },
    { label: 'an unknown key', body: { colour: 'red' }, code: 'invalid_body' },
    { label: 'a null title', body: { title: null }, code: 'invalid_title' },
    { label: 'an empty title', body: { title: '   ' }, code: 'empty_title' },
    {
      label: 'an over-length title',
      body: { title: 'x'.repeat(500) },
      code: 'title_too_long',
    },
    {
      label: 'a non-boolean suggestionsOpen',
      body: { suggestionsOpen: 'yes' },
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

    await run(shareId, { title: 'x'.repeat(500) }, editToken)

    const after = await read(shareId)
    expect(after.title).toBe(before.title)
    expect(after.updatedAt).toBe(before.updatedAt)
  })
})

describe('sliding expiry', () => {
  it('refreshes updatedAt and expiresAt on a successful patch', async () => {
    const { shareId, editToken } = await seed()
    const before = await read(shareId)

    const at = Date.now()
    await run(shareId, { title: 'Dinner' }, editToken)

    const after = await read(shareId)
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt)
    expect(after.expiresAt).toBeGreaterThanOrEqual(at + THIRTY_DAYS_MS)
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt)
  })

  it('slides the secret’s expiry with the wheel’s', async () => {
    // The half-measure that is a slow-acting bug: slide only the wheel and the
    // secret is reaped at its original 30 days while an actively used wheel
    // lives on, leaving it permanently uneditable. The two are created together
    // and must expire together.
    const { shareId, editToken } = await seed()
    const before = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    await run(shareId, { title: 'Dinner' }, editToken)

    const after = await db.collection(WHEEL_SECRETS).doc(shareId).get()
    const wheel = await read(shareId)

    expect(
      after.get('expiresAt').toDate().getTime(),
      'the secret will be reaped before the wheel it unlocks',
    ).toBeGreaterThan(before.get('expiresAt').toDate().getTime())

    // And it keeps its margin over the wheel across the slide, rather than the
    // two converging on the same instant after the first edit.
    expect(
      after.get('expiresAt').toDate().getTime(),
      'the slide collapsed the secret’s margin over the wheel',
    ).toBeGreaterThan(wheel.expiresAt)
  })

  it('does not slide expiry for a refused patch', async () => {
    const { shareId, editToken } = await seed()
    const before = await read(shareId)

    await run(shareId, {}, editToken)

    expect((await read(shareId)).expiresAt).toBe(before.expiresAt)
  })
})
