import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  assertEditor,
  createWheel,
  EditorAuthError,
  isShareId,
  WHEEL_SECRETS,
  WHEELS,
} from './store'
import { hashEditToken, mintEditToken } from './tokens'

/**
 * Firestore-backed tests for the editor guard. Run with
 * `npm run test:emulator`, which starts the Firebase Emulator Suite around
 * them; they are a separate Vitest project so the fast suite keeps needing
 * neither Java nor a running emulator.
 *
 * These cover TASK-7 acceptance criteria 4, 5 and 6 — the ones that are only
 * meaningful against a real database, because what they are testing is which
 * document gets read.
 *
 * The app is built here rather than through `getAdminDb()` so the tests own
 * their lifecycle and can shut it down; every function under test takes the
 * Firestore handle as its last parameter for exactly this reason.
 */

let app: App
let db: Firestore

/** A request carrying whatever Authorization header the test wants. */
function requestWith(header?: string | null): Request {
  return new Request('https://example.test/api/wheels/x', {
    headers: header == null ? {} : { authorization: header },
  })
}

/** The status and code an `assertEditor` call rejects with, or null if it resolved. */
async function refusal(
  shareId: string,
  request: Request,
): Promise<{ status: number; code: string } | null> {
  try {
    await assertEditor(shareId, request, db)
    return null
  } catch (error) {
    expect(
      error,
      `expected an EditorAuthError, got ${String(error)}`,
    ).toBeInstanceOf(EditorAuthError)
    const authError = error as EditorAuthError
    return { status: authError.status, code: authError.code }
  }
}

const NOT_EDITOR = { status: 403, code: 'not_editor' }
const NO_SUCH_WHEEL = { status: 404, code: 'no_such_wheel' }
const MISSING_TOKEN = { status: 401, code: 'missing_token' }

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`. ' +
      'Without it the Admin SDK would resolve real credentials and these tests ' +
      'would write to a live project.',
  ).toBeTruthy()

  app = initializeApp(
    {
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-spinnerly',
    },
    `task-7-tests-${process.pid}`,
  )
  db = getFirestore(app)
})

afterAll(async () => {
  // Guarded because `app` is only assigned after the env-var check above. When
  // that check fails — someone ran this without the emulator — an unguarded
  // `deleteApp(undefined)` throws "Invalid app argument" and that second
  // failure buries the first, which is the one carrying the instructions.
  if (app) await deleteApp(app)
})

describe('createWheel', () => {
  it('returns a shareId that is a Firestore auto-ID', async () => {
    const { shareId } = await createWheel({ title: 'Lunch' }, db)
    expect(isShareId(shareId), `${shareId} is not a well-formed share ID`).toBe(
      true,
    )
  })

  it('persists only the hash, never the raw token', async () => {
    const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)

    const secret = await db.collection(WHEEL_SECRETS).doc(shareId).get()
    expect(secret.get('editTokenHash')).toBe(hashEditToken(editToken))

    // The raw token must appear nowhere in either document, under any field.
    const wheel = await db.collection(WHEELS).doc(shareId).get()
    expect(JSON.stringify(secret.data())).not.toContain(editToken)
    expect(JSON.stringify(wheel.data())).not.toContain(editToken)
  })

  it('mints tokens independently of the shareId', async () => {
    // A derived token (hash(shareId + pepper) and friends) is what design doc
    // section 4 forbids. Two wheels created back to back must not produce
    // tokens with any relationship to their IDs.
    const a = await createWheel({ title: 'A' }, db)
    const b = await createWheel({ title: 'B' }, db)
    expect(a.editToken).not.toBe(b.editToken)
    expect(a.editToken).not.toContain(a.shareId)
    expect(hashEditToken(a.shareId).startsWith(a.editToken.slice(0, 8))).toBe(
      false,
    )
  })

  it('writes the wheel and its secret together', async () => {
    const { shareId } = await createWheel({ title: 'Lunch' }, db)
    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
    ])
    expect(wheel.exists, 'wheel document missing').toBe(true)
    expect(secret.exists, 'secret document missing').toBe(true)
  })

  it('expires the wheel and its secret together', async () => {
    // Both documents carry the expiry so the TTL policy reaps the pair. If only
    // the wheel had one, the secret would outlive it forever and assertEditor
    // would keep succeeding for a wheel that no longer exists.
    const { shareId } = await createWheel({ title: 'Lunch' }, db)
    const [wheel, secret] = await Promise.all([
      db.collection(WHEELS).doc(shareId).get(),
      db.collection(WHEEL_SECRETS).doc(shareId).get(),
    ])

    for (const snapshot of [wheel, secret]) {
      const days =
        (snapshot.get('expiresAt').toDate().getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29)
      expect(days).toBeLessThan(31)
    }
  })
})

describe('assertEditor', () => {
  let wheelA: { shareId: string; editToken: string }
  let wheelB: { shareId: string; editToken: string }

  beforeAll(async () => {
    wheelA = await createWheel({ title: 'Wheel A' }, db)
    wheelB = await createWheel({ title: 'Wheel B' }, db)
  })

  // AC 4
  it('accepts the correct token for its own wheel', async () => {
    await expect(
      refusal(wheelA.shareId, requestWith(`Bearer ${wheelA.editToken}`)),
    ).resolves.toBeNull()
  })

  // AC 5 — the confused-deputy case. This is the test design doc section 6 asks
  // for by name. Run in both directions so a pass cannot come from the fixtures
  // happening to be ordered conveniently.
  it('refuses an editor of wheel A on wheel B with 403', async () => {
    await expect(
      refusal(wheelB.shareId, requestWith(`Bearer ${wheelA.editToken}`)),
    ).resolves.toEqual(NOT_EDITOR)

    await expect(
      refusal(wheelA.shareId, requestWith(`Bearer ${wheelB.editToken}`)),
    ).resolves.toEqual(NOT_EDITOR)
  })

  // AC 6. Headers are built lazily because the fixtures do not exist yet when
  // `it.each` evaluates its table — `beforeAll` has not run at collection time.
  it.each([
    { label: 'no Authorization header', header: () => undefined },
    { label: 'an empty header', header: () => '' },
    { label: 'a scheme with no value', header: () => 'Bearer' },
    { label: 'a scheme with only whitespace', header: () => 'Bearer ' },
    { label: 'the wrong scheme', header: () => `Basic ${wheelA.editToken}` },
    { label: 'a bare token with no scheme', header: () => wheelA.editToken },
  ])('refuses $label with 401', async ({ header }) => {
    await expect(
      refusal(wheelA.shareId, requestWith(header())),
    ).resolves.toEqual(MISSING_TOKEN)
  })

  it('refuses an unknown shareId with 404', async () => {
    // Well-formed but never created.
    await expect(
      refusal(
        'a1b2c3d4e5f6g7h8i9j0',
        requestWith(`Bearer ${wheelA.editToken}`),
      ),
    ).resolves.toEqual(NO_SUCH_WHEEL)
  })

  // Both `db.doc(path)` and `collection.doc(id)` treat slashes as path
  // separators, so an unvalidated shareId lets the caller name the document
  // being checked. These must be refused on shape, before any lookup.
  it.each([
    { label: 'an empty string', shareId: '' },
    { label: 'too short', shareId: 'short' },
    { label: 'too long', shareId: 'a1b2c3d4e5f6g7h8i9j0toolong' },
    { label: 'path segments', shareId: 'has/slash/segments' },
    { label: 'a traversal attempt', shareId: '../../wheelSecrets/other' },
    { label: 'spaces and punctuation', shareId: 'has spaces in it!!!!' },
    { label: 'a prototype key', shareId: '__proto__' },
  ])('refuses $label as a shareId with 404', async ({ shareId }) => {
    await expect(
      refusal(shareId, requestWith(`Bearer ${wheelA.editToken}`)),
    ).resolves.toEqual(NO_SUCH_WHEEL)
  })

  // A corrupt secret must deny, not 500. `timingSafeEqual` throws on mismatched
  // buffer lengths, so this is the path that would otherwise take an endpoint
  // down for one wheel.
  it.each([
    { label: 'an empty string', editTokenHash: '' },
    { label: 'a short hex string', editTokenHash: 'deadbeef' },
    { label: 'the right length but not hex', editTokenHash: 'z'.repeat(64) },
    { label: 'a number', editTokenHash: 42 },
    { label: 'null', editTokenHash: null },
  ])(
    'refuses with 403 when the stored hash is $label',
    async ({ editTokenHash }) => {
      const { shareId, editToken } = await createWheel({ title: 'Corrupt' }, db)
      await db.collection(WHEEL_SECRETS).doc(shareId).set({ editTokenHash })

      await expect(
        refusal(shareId, requestWith(`Bearer ${editToken}`)),
      ).resolves.toEqual(NOT_EDITOR)
    },
  )

  it('refuses a token that is the stored hash', async () => {
    // Anyone who reads the database holds hashes. Presenting one must not work.
    const stored = hashEditToken(wheelA.editToken)
    await expect(
      refusal(wheelA.shareId, requestWith(`Bearer ${stored}`)),
    ).resolves.toEqual(NOT_EDITOR)
  })

  it('refuses a freshly minted token that belongs to no wheel', async () => {
    await expect(
      refusal(wheelA.shareId, requestWith(`Bearer ${mintEditToken()}`)),
    ).resolves.toEqual(NOT_EDITOR)
  })
})

describe('EditorAuthError', () => {
  it('renders a response carrying its own status and code', async () => {
    const response = new EditorAuthError(403, 'not_editor', 'nope').toResponse()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'not_editor',
      message: 'nope',
    })
  })

  it('never puts the presented token in the body', async () => {
    // The token must not reach a log line or a response, which is why the
    // message is a constant rather than anything derived from the request.
    const token = mintEditToken()
    const result = await refusal(
      'a1b2c3d4e5f6g7h8i9j0',
      requestWith(`Bearer ${token}`),
    )
    expect(result).not.toBeNull()

    const body = await new EditorAuthError(
      result!.status,
      result!.code,
      'No wheel with that ID.',
    )
      .toResponse()
      .text()
    expect(body).not.toContain(token)
  })
})
