import { type Firestore } from 'firebase-admin/firestore'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  assertEditor,
  createWheel,
  EditorAuthError,
  isShareId,
  SUGGESTIONS,
  WHEEL_SECRETS,
  WHEELS,
} from '@/lib/wheels/store'
import { hashEditToken } from '@/lib/wheels/tokens'
import { DEFAULT_TITLE, OPTIONS_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * POST /api/wheels/{shareId}/duplicate, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * Everything for this route is here, with no unit-project counterpart — unlike
 * POST /suggestions next door, which is also unauthenticated and does have one.
 * The difference is that that route parses a body before it reads anything, so
 * its rejections are reachable without a database. This one has no body at all:
 * the first thing every request does is call `duplicateWheel`, whose `db`
 * default parameter evaluates `getAdminDb()` before the function body runs. Even
 * the malformed-shareId 404 therefore needs an emulator to reach.
 *
 * What this file is really for is the negative space. A fork is defined as much
 * by what it does not carry across — the source's suggestions, its spins, its
 * edit token, its timestamps, its `fromSuggestion` provenance — as by the title
 * and options it does, and none of that can be observed except by looking at two
 * documents that actually got written.
 */

let db: Firestore

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Nothing in the codebase writes spins yet, so there is no constant to import.
 * Design doc section 4 names the subcollection, and a fork must not carry one
 * across whenever it does start being written — so the fixture below seeds it by
 * name rather than waiting for the feature.
 */
const SPINS = 'spins'

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  db = getAdminDb()
})

/**
 * A POST request to fork `shareId`.
 *
 * No Authorization header is ever attached, by any test in this file. That is
 * the point of the endpoint rather than an omission in the fixture: the escape
 * hatch exists for people who do not have the token.
 */
function post(shareId: string): Request {
  return new Request(`https://example.test/api/wheels/${shareId}/duplicate`, {
    method: 'POST',
  })
}

function context(shareId: string) {
  return {
    params: Promise.resolve({ shareId }),
  } as RouteContext<'/api/wheels/[shareId]/duplicate'>
}

type Body = {
  error?: string
  message?: string
  shareId?: string
  editToken?: string
}

/** Fork through the route and return the response and parsed body. */
async function fork(shareId: string) {
  const response = await POST(post(shareId), context(shareId))
  const text = await response.text()
  return {
    response,
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as Body),
  }
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
    exists: snapshot.exists,
    title: snapshot.get('title') as string,
    options: (snapshot.get('options') ?? []) as StoredOption[],
    suggestionsOpen: snapshot.get('suggestionsOpen') as boolean,
    createdAt: snapshot.get('createdAt')?.toDate().getTime() as number,
    expiresAt: snapshot.get('expiresAt')?.toDate().getTime() as number,
  }
}

/**
 * A source wheel with `count` options, a pending suggestion and a recorded spin.
 *
 * The subcollections are seeded on every fixture rather than only where a test
 * names them, so that "the fork has none" is asserted against a source that
 * definitely had some.
 */
async function seed(
  count = 2,
  title = 'Lunch Friday',
): Promise<{ shareId: string; editToken: string }> {
  const created = await createWheel(
    {
      title,
      options: Array.from({ length: count }, (_, index) => ({
        id: `seeded-${index}`,
        label: `Seeded ${index}`,
      })),
    },
    db,
  )

  const wheel = db.collection(WHEELS).doc(created.shareId)
  await Promise.all([
    wheel
      .collection(SUGGESTIONS)
      .doc()
      .set({
        label: 'Ramen',
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
      }),
    wheel.collection(SPINS).doc().set({
      winnerOptionId: 'seeded-0',
      spunAt: new Date(),
    }),
  ])

  return created
}

/** How many documents a wheel's subcollection holds. */
async function countIn(shareId: string, subcollection: string) {
  const snapshot = await db
    .collection(WHEELS)
    .doc(shareId)
    .collection(subcollection)
    .count()
    .get()
  return snapshot.data().count
}

/** Whether `token` opens `shareId`, via the same guard every write route uses. */
async function opens(shareId: string, token: string): Promise<boolean> {
  const request = new Request('https://example.test/', {
    headers: { authorization: `Bearer ${token}` },
  })

  try {
    await assertEditor(shareId, request, db)
    return true
  } catch (error) {
    if (error instanceof EditorAuthError) return false
    throw error
  }
}

describe('POST /api/wheels/[shareId]/duplicate', () => {
  it('forks with no Authorization header at all', async () => {
    // AC 1, and the reason this endpoint exists: the people who need it are
    // precisely the ones without a token (design doc section 8).
    const { shareId } = await seed()

    const { status, body } = await fork(shareId)

    expect(status).toBe(201)
    expect(
      isShareId(body?.shareId),
      `${body?.shareId} is not a well-formed share ID`,
    ).toBe(true)
    // 32 bytes base64url-encodes to 43 characters with no padding.
    expect(body?.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('returns a share ID that is not the source one', async () => {
    const { shareId } = await seed()

    const { body } = await fork(shareId)

    expect(body?.shareId).not.toBe(shareId)
  })

  it('marks the response no-store', async () => {
    // The body carries a raw edit token, as `POST /wheels` does. This is the
    // only other response in the API that does.
    const { shareId } = await seed()

    const { response } = await fork(shareId)

    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it.each([
    {
      label: 'an unknown but well-formed share ID',
      id: 'a1b2c3d4e5f6g7h8i9j0',
    },
    { label: 'a share ID of the wrong length', id: 'tooshort' },
    { label: 'a share ID with a path separator', id: 'wheels/someone-elses' },
    { label: 'a traversal attempt', id: '../../wheelSecrets/abc' },
  ])('answers 404 for $label', async ({ id }) => {
    // One answer for both a wheel that is not there and an ID that could not
    // name one, so a prober cannot learn which of their guesses were at least
    // well formed. The traversal cases are the load-bearing ones: `doc()`
    // resolves slashes as path separators, and this route has no `assertEditor`
    // in front of it to have rejected them first.
    const { status, body } = await fork(id)

    expect(status).toBe(404)
    expect(body?.error).toBe('no_such_wheel')
  })
})

describe('what the fork carries across', () => {
  it('copies the title and the options', async () => {
    // AC 2.
    const { shareId } = await seed(3)

    const { body } = await fork(shareId)
    const forked = await read(body!.shareId!)

    expect(forked.title).toBe('Lunch Friday')
    expect(forked.options.map((option) => option.label)).toEqual([
      'Seeded 0',
      'Seeded 1',
      'Seeded 2',
    ])
  })

  it('preserves option order', async () => {
    // Firestore preserves array order and decision 6 makes insertion order the
    // display order, so a fork that reordered the list would be a visible
    // change to a wheel the forker expected to be the same one.
    const { shareId } = await seed(5)

    const { body } = await fork(shareId)

    expect((await read(body!.shareId!)).options.map((o) => o.id)).toEqual([
      'seeded-0',
      'seeded-1',
      'seeded-2',
      'seeded-3',
      'seeded-4',
    ])
  })

  it('gives the fork no suggestions and no spins', async () => {
    // AC 2. The fixture seeds one of each on the source, so this is a fork that
    // dropped them rather than a source that never had any.
    const { shareId } = await seed()

    expect(await countIn(shareId, SUGGESTIONS)).toBe(1)
    expect(await countIn(shareId, SPINS)).toBe(1)

    const { body } = await fork(shareId)

    expect(await countIn(body!.shareId!, SUGGESTIONS)).toBe(0)
    expect(await countIn(body!.shareId!, SPINS)).toBe(0)
  })

  it('clears fromSuggestion on every copied option', async () => {
    // Provenance names a document in the SOURCE wheel's suggestions
    // subcollection. The fork does not have that subcollection and never will,
    // so carrying the field across would point the fork's provenance at another
    // wheel's queue.
    const { shareId } = await createWheel(
      {
        title: 'Lunch Friday',
        options: [{ id: 'from-a-suggestion', label: 'Ramen' }],
      },
      db,
    )
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({
        options: [
          {
            id: 'from-a-suggestion',
            label: 'Ramen',
            addedAt: new Date(),
            fromSuggestion: 'sugg1234567890123456',
          },
        ],
      })

    const { body } = await fork(shareId)

    expect(
      (await read(body!.shareId!)).options.map((o) => o.fromSuggestion),
    ).toEqual([null])
  })

  it('stamps the copied options with a fresh addedAt', async () => {
    const before = Date.now()
    const { shareId } = await createWheel(
      {
        title: 'Lunch Friday',
        options: [{ id: 'old', label: 'Tacos' }],
      },
      db,
    )
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({
        options: [
          {
            id: 'old',
            label: 'Tacos',
            addedAt: new Date(before - 365 * 24 * 60 * 60 * 1000),
            fromSuggestion: null,
          },
        ],
      })

    const { body } = await fork(shareId)
    const [option] = (await read(body!.shareId!)).options

    expect(option.addedAt.toDate().getTime()).toBeGreaterThanOrEqual(before)
  })

  it('opens suggestions on the fork even when the source had them closed', async () => {
    // The kill switch was the source editor's decision about the source's
    // audience, usually taken because of the source's spam. The fork has a new
    // editor and a URL nobody has pasted anywhere, so it starts at the default
    // rather than inheriting someone else's moderation state.
    const { shareId } = await seed()
    await db.collection(WHEELS).doc(shareId).update({ suggestionsOpen: false })

    const { body } = await fork(shareId)

    expect((await read(body!.shareId!)).suggestionsOpen).toBe(true)
  })

  it('gives the fork its own timestamps and a full 30 days', async () => {
    const { shareId } = await seed()
    // Age the source so an inherited timestamp would be unmistakable.
    const longAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({ createdAt: longAgo, expiresAt: new Date(Date.now() + 1000) })

    const before = Date.now()
    const { body } = await fork(shareId)
    const forked = await read(body!.shareId!)

    expect(forked.createdAt).toBeGreaterThanOrEqual(before)
    expect(forked.expiresAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS)
  })

  it('forks a wheel that is already past its own expiry', async () => {
    // Firestore TTL deletes "typically within 24 hours", so an expired wheel is
    // readable for a while yet — and that window is exactly when someone reaches
    // for the escape hatch.
    const { shareId } = await seed()
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({ expiresAt: new Date(Date.now() - THIRTY_DAYS_MS) })

    const { status, body } = await fork(shareId)

    expect(status).toBe(201)
    expect((await read(body!.shareId!)).title).toBe('Lunch Friday')
  })

  it('forks an empty wheel', async () => {
    const { shareId } = await seed(0)

    const { status, body } = await fork(shareId)

    expect(status).toBe(201)
    expect((await read(body!.shareId!)).options).toEqual([])
  })

  it('forks a fork', async () => {
    const { shareId } = await seed(2)

    const first = await fork(shareId)
    const second = await fork(first.body!.shareId!)

    expect(second.status).toBe(201)
    const twiceForked = await read(second.body!.shareId!)
    expect(twiceForked.options.map((o) => o.label)).toEqual([
      'Seeded 0',
      'Seeded 1',
    ])
  })
})

describe('the title', () => {
  it.each([
    { label: 'plain', title: 'Lunch Friday' },
    { label: 'already ending in (copy)', title: 'Lunch Friday (copy)' },
    { label: 'trailing whitespace inside it', title: 'Lunch  Friday' },
    { label: 'emoji', title: '🎡 Lunch 🌮' },
    { label: 'right-to-left text', title: 'عجلة الغداء' },
  ])('copies a $label title byte for byte', async ({ title }) => {
    // AC 5 and 6, from decision 17: verbatim, no suffix, no marker, no
    // disambiguation of any kind. The URL is the identifier.
    //
    // The `(copy)` case is the one that would catch a well-meaning suffix, and
    // the others catch a title re-run through the sanitiser on the way past —
    // which would rewrite a string the forker never typed and cannot see us
    // edit.
    const { shareId } = await createWheel({ title }, db)

    const { body } = await fork(shareId)

    expect((await read(body!.shareId!)).title).toBe(title)
  })

  it('falls back to the default title for a source that has none', async () => {
    // Unreachable through this API — every write path validates a title into a
    // string. A fork that reads as untitled beats an escape hatch that refuses
    // to open.
    const { shareId } = await seed()
    await db.collection(WHEELS).doc(shareId).update({ title: 42 })

    const { status, body } = await fork(shareId)

    expect(status).toBe(201)
    expect((await read(body!.shareId!)).title).toBe(DEFAULT_TITLE)
  })
})

describe('the fork’s edit token', () => {
  it('is independently generated', async () => {
    // AC 3. Not derived from the source's, which is not even recoverable — only
    // its hash is stored.
    const { shareId, editToken } = await seed()

    const { body } = await fork(shareId)

    expect(body?.editToken).not.toBe(editToken)

    const [sourceSecret, forkSecret] = await Promise.all([
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(body!.shareId!).get(),
    ])
    expect(forkSecret.get('editTokenHash')).not.toBe(
      sourceSecret.get('editTokenHash'),
    )
    expect(forkSecret.get('editTokenHash')).toBe(
      hashEditToken(body!.editToken!),
    )
  })

  it('opens the fork, and the source token does not', async () => {
    // AC 3 stated as the property that matters. Editor auth answers "is this
    // THIS wheel's token?", so a fork whose secret were shared with its source
    // would hand every past editor of the source write access to it.
    const { shareId, editToken } = await seed()

    const { body } = await fork(shareId)
    const forkId = body!.shareId!

    expect(await opens(forkId, body!.editToken!)).toBe(true)
    expect(
      await opens(forkId, editToken),
      'the source token opens the fork',
    ).toBe(false)
    expect(
      await opens(shareId, body!.editToken!),
      'the fork token opens the source',
    ).toBe(false)
  })

  it('writes the fork a secret that outlives it', async () => {
    const { shareId } = await seed()

    const { body } = await fork(shareId)

    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(body!.shareId!).get(),
      db.collection(WHEEL_SECRETS).doc(body!.shareId!).get(),
    ])

    expect(
      secret.get('expiresAt').toDate().getTime(),
      'the fork’s secret is reapable before the wheel it unlocks',
    ).toBeGreaterThan(wheel.get('expiresAt').toDate().getTime())
  })
})

describe('the source wheel', () => {
  it('is left byte-for-byte unmodified', async () => {
    // AC 4. Every other write in the store slides `updatedAt` and `expiresAt`;
    // this one deliberately does not, so the whole document is compared rather
    // than a field at a time.
    const { shareId } = await seed(3)

    const before = await db.collection(WHEELS).doc(shareId).get()
    await fork(shareId)
    const after = await db.collection(WHEELS).doc(shareId).get()

    expect(after.data()).toEqual(before.data())
  })

  it('keeps its secret unmodified too', async () => {
    const { shareId } = await seed()

    const before = await db.collection(WHEEL_SECRETS).doc(shareId).get()
    await fork(shareId)
    const after = await db.collection(WHEEL_SECRETS).doc(shareId).get()

    expect(after.data()).toEqual(before.data())
  })

  it('does not have its expiry slid forward by a fork', async () => {
    // Stated on its own because it is the security-relevant half of AC 4. This
    // route reaches a wheel with no credential, so a slide here would let anyone
    // who once saw a share URL keep that wheel alive forever by calling this on
    // a timer — defeating the bounded lifetime of a leaked link, which design
    // doc section 8 lists as expiry's first reason for existing.
    const { shareId } = await seed()
    const pinned = new Date(Date.now() + 1000)
    await db.collection(WHEELS).doc(shareId).update({ expiresAt: pinned })

    await fork(shareId)

    expect((await read(shareId)).expiresAt).toBe(pinned.getTime())
  })

  it('keeps its own suggestions', async () => {
    const { shareId } = await seed()

    await fork(shareId)

    expect(await countIn(shareId, SUGGESTIONS)).toBe(1)
  })
})

describe('capacity', () => {
  it('forks a wheel holding the maximum number of options', async () => {
    const { shareId } = await seed(OPTIONS_MAX)

    const { status, body } = await fork(shareId)

    expect(status).toBe(201)
    expect((await read(body!.shareId!)).options).toHaveLength(OPTIONS_MAX)
  })

  it('refuses a source holding more options than the cap allows', async () => {
    // Unreachable today, since every path that writes an option checks the cap.
    // It becomes reachable the moment `OPTIONS_MAX` is lowered, and the point of
    // the check is that the answer is this 409 rather than Firestore refusing an
    // oversized document as a 500.
    const { shareId } = await createWheel(
      {
        title: 'Lunch Friday',
        options: Array.from({ length: OPTIONS_MAX + 1 }, (_, index) => ({
          id: `over-${index}`,
          label: `Over ${index}`,
        })),
      },
      db,
    )

    const { status, body } = await fork(shareId)

    expect(status).toBe(409)
    expect(body?.error).toBe('options_full')
    // The count in the message has to be the source's real one. It comes from
    // `assertOptionCapacity`'s `current`, so passing the array length as
    // `adding` instead would answer "this one has 0" for a wheel holding 51 —
    // the same 409 with both of its numbers wrong, on the one message a forker
    // ever sees.
    expect(body?.message).toContain(String(OPTIONS_MAX + 1))
    expect(body?.message, 'the message reports a count of zero').not.toContain(
      'has 0',
    )
  })

  it.each([
    { label: 'not a string', stored: 42 },
    { label: 'absent', stored: undefined },
    // A string, so a `typeof` guard alone lets it through — and a copied label
    // is deliberately never re-validated, which makes this function the only
    // thing between a stored empty label and a blank slice on the fork.
    { label: 'the empty string', stored: '' },
  ])(
    'drops an option whose label is $label, keeping the rest',
    async ({ stored }) => {
      // All unreachable through this API. A fork missing one corrupt row beats an
      // escape hatch that refuses to open because of it.
      const { shareId } = await seed(0)
      await db
        .collection(WHEELS)
        .doc(shareId)
        .update({
          options: [
            {
              id: 'good',
              label: 'Tacos',
              addedAt: new Date(),
              fromSuggestion: null,
            },
            {
              id: 'bad',
              ...(stored === undefined ? {} : { label: stored }),
              addedAt: new Date(),
              fromSuggestion: null,
            },
          ],
        })

      const { status, body } = await fork(shareId)

      expect(status).toBe(201)
      expect((await read(body!.shareId!)).options.map((o) => o.label)).toEqual([
        'Tacos',
      ])
    },
  )

  it('mints a fresh id for a copied option whose id is unusably long', async () => {
    // `assertOptionId` refuses an id past OPTION_ID_MAX, so copying one verbatim
    // would give the fork an option that `DELETE .../options/{id}` can never
    // name — a wheel with an undeletable row on it.
    const { shareId } = await seed(0)
    await db
      .collection(WHEELS)
      .doc(shareId)
      .update({
        options: [
          {
            id: 'x'.repeat(500),
            label: 'Tacos',
            addedAt: new Date(),
            fromSuggestion: null,
          },
        ],
      })

    const { body } = await fork(shareId)
    const [option] = (await read(body!.shareId!)).options

    expect(option.label).toBe('Tacos')
    expect(option.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })
})

describe('the raw edit token', () => {
  const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reaches the response body and no console output', async () => {
    // The same invariant `POST /wheels` holds, asserted separately because this
    // is the second and last handler that ever has a raw token in scope. Design
    // doc section 6: Cloud Logging is exactly where one would outlive the
    // request.
    const { shareId } = await seed()

    const written: string[] = []
    for (const method of CONSOLE_METHODS) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map((arg) => String(arg)).join(' '))
      })
    }

    const { body } = await fork(shareId)

    expect(body?.editToken, 'the token belongs in the body').toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    )
    expect(
      written.filter((line) => line.includes(body!.editToken!)),
      'the raw edit token was written to the console',
    ).toEqual([])
  })
})
