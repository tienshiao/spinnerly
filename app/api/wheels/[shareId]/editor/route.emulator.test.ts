import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { WHEEL_VERSION_HEADER } from '@/lib/wheels/model'
import { createWheel, WHEELS } from '@/lib/wheels/store'
import { GET } from './route'

/**
 * GET /api/wheels/{shareId}/editor, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * No unit-project counterpart. The route is nothing but `assertEditor`, which
 * reads a secret document before it can refuse anything, so every case here —
 * including the refusals — needs a database.
 *
 * Two properties carry the weight, and neither is about the happy path. This
 * endpoint answers an authorization question for a page that will then decide
 * what to render, so it has to refuse a token belonging to a DIFFERENT wheel;
 * and it is the one editor-authenticated route that must leave the wheel
 * exactly as it found it, because it runs on every editor page load.
 */

let db: Firestore

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  db = getAdminDb()
})

/** A GET carrying `authorization` verbatim, so malformed headers are testable. */
function get(shareId: string, authorization?: string): Request {
  return new Request(`https://example.test/api/wheels/${shareId}/editor`, {
    method: 'GET',
    headers: authorization === undefined ? {} : { authorization },
  })
}

async function run(shareId: string, authorization?: string) {
  const response = await GET(get(shareId, authorization), {
    params: Promise.resolve({ shareId }),
  } as RouteContext<'/api/wheels/[shareId]/editor'>)

  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? null : (JSON.parse(text) as { error?: string }),
    version: response.headers.get(WHEEL_VERSION_HEADER),
    cacheControl: response.headers.get('cache-control'),
  }
}

/** The stored fields a call to this route must not disturb. */
async function stateOf(shareId: string) {
  const snapshot = await db.collection(WHEELS).doc(shareId).get()
  return {
    updatedAt: snapshot.get('updatedAt')?.toMillis() as number,
    expiresAt: snapshot.get('expiresAt')?.toMillis() as number,
  }
}

describe('GET /api/wheels/[shareId]/editor', () => {
  it('answers 204 with no body for this wheel’s own token', async () => {
    const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)

    const result = await run(shareId, `Bearer ${editToken}`)

    expect(result.status).toBe(204)
    expect(result.body).toBeNull()
  })

  it('accepts the scheme case-insensitively, per RFC 7235', async () => {
    const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)

    expect((await run(shareId, `bearer ${editToken}`)).status).toBe(204)
  })

  /**
   * The reason this endpoint exists rather than a no-op PATCH.
   *
   * A wheel's `expiresAt` slides 30 days on every mutating write (design doc
   * section 8) and its `updatedAt` is what every other viewer's listener keys
   * on. If merely OPENING an edit link moved either, an editor who left a tab
   * open would keep a dead wheel alive forever and every one of their page
   * loads would arrive at other viewers as an edit nobody made.
   *
   * Asserted on the stored document rather than on the absence of a header,
   * because the two can disagree: a route can write and simply neglect to
   * report it, which is the failure this has to catch.
   */
  it('writes nothing — neither updatedAt nor expiresAt moves', async () => {
    const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)
    const before = await stateOf(shareId)

    expect((await run(shareId, `Bearer ${editToken}`)).status).toBe(204)

    expect(await stateOf(shareId)).toEqual(before)
  })

  /**
   * The version header is absent because there is no version: design doc
   * section 6 puts it on the six routes that write, and this one does not.
   * A header here would name a version this request did not produce, which
   * lib/wheels/optimistic.ts would then compare an unrelated pending entry
   * against.
   */
  it('reports no version header, having produced no version', async () => {
    const { shareId, editToken } = await createWheel({ title: 'Lunch' }, db)

    expect((await run(shareId, `Bearer ${editToken}`)).version).toBeNull()
  })

  /**
   * The one GET in app/api, and therefore the only route a cache would consider
   * storing at all. Both statuses matter: 204 and 404 are on RFC 9111 section
   * 4.2.2's heuristically-cacheable list, so either could be held with no
   * explicit freshness — and what would be held is an authorization decision
   * made from a token the URL does not mention.
   */
  it.each([
    { label: 'the 204', shareId: null, authorization: null, status: 204 },
    {
      label: 'a 403',
      shareId: null,
      authorization: 'Bearer wrong',
      status: 403,
    },
    { label: 'a 401', shareId: null, authorization: undefined, status: 401 },
    {
      label: 'a 404',
      shareId: 'A'.repeat(20),
      authorization: 'Bearer x',
      status: 404,
    },
  ])('answers no-store on $label', async (testCase) => {
    const wheel = await createWheel({ title: 'Lunch' }, db)

    const result = await run(
      testCase.shareId ?? wheel.shareId,
      testCase.authorization === null
        ? `Bearer ${wheel.editToken}`
        : testCase.authorization,
    )

    expect(result.status).toBe(testCase.status)
    expect(result.cacheControl).toContain('no-store')
  })

  describe('refusals', () => {
    /**
     * The confused-deputy case, and the reason this route calls `assertEditor`
     * instead of asking a cheaper question. An endpoint whose whole purpose is
     * to answer "are you an editor?" is exactly where "is this A valid token?"
     * would be written by accident — and a yes here is a page that renders full
     * editor controls over someone else's wheel.
     */
    it('refuses another wheel’s token with 403', async () => {
      const a = await createWheel({ title: 'Wheel A' }, db)
      const b = await createWheel({ title: 'Wheel B' }, db)

      const result = await run(b.shareId, `Bearer ${a.editToken}`)

      expect(result.status).toBe(403)
      expect(result.body?.error).toBe('not_editor')
    })

    it('refuses a token that belongs to no wheel with 403', async () => {
      const { shareId } = await createWheel({ title: 'Lunch' }, db)

      const result = await run(shareId, 'Bearer not-a-real-token')

      expect(result.status).toBe(403)
      expect(result.body?.error).toBe('not_editor')
    })

    /**
     * 401 and 403 are kept apart because the page acts on them differently in
     * spirit even where it renders the same view: 401 is "this URL carries no
     * token", which is an ordinary share link, and 403 is "this URL carries a
     * token that is wrong", which is worth telling the holder about.
     */
    it.each([
      { label: 'no header at all', authorization: undefined },
      { label: 'the wrong scheme', authorization: 'Basic abc123' },
      { label: 'a scheme with no value', authorization: 'Bearer' },
      { label: 'a scheme with an empty value', authorization: 'Bearer ' },
    ])('answers 401 for $label', async ({ authorization }) => {
      const { shareId } = await createWheel({ title: 'Lunch' }, db)

      const result = await run(shareId, authorization)

      expect(result.status).toBe(401)
      expect(result.body?.error).toBe('missing_token')
    })

    /**
     * Both 404s, and they are one case rather than two by design: a well-formed
     * ID that names nothing and an ID that could never name anything answer
     * identically, so a prober cannot learn which of their guesses were even
     * shaped like a share ID.
     */
    it.each([
      { label: 'a well-formed ID naming no wheel', shareId: 'A'.repeat(20) },
      { label: 'an ID that cannot name a document', shareId: 'nope' },
    ])('answers 404 for $label', async ({ shareId }) => {
      const result = await run(shareId, 'Bearer whatever')

      expect(result.status).toBe(404)
      expect(result.body?.error).toBe('no_such_wheel')
    })
  })
})
