import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'
import { WHEEL_VERSION_HEADER } from '@/lib/wheels/model'
import {
  createWheel,
  SUGGESTIONS,
  WHEEL_SECRETS,
  WHEELS,
} from '@/lib/wheels/store'
import { POST as createOption } from './[shareId]/options/route'
import { DELETE as removeOption } from './[shareId]/options/[optionId]/route'
import { PATCH as patchWheel } from './[shareId]/route'
import { POST as submitSuggestion } from './[shareId]/suggestions/route'
import { POST as acceptSuggestion } from './[shareId]/suggestions/[suggestionId]/accept/route'
import { DELETE as rejectSuggestion } from './[shareId]/suggestions/[suggestionId]/route'
import { POST as duplicateWheel } from './[shareId]/duplicate/route'

/**
 * The two lifecycle invariants that hold design doc section 8 up, neither of
 * which any per-route suite states. Run with `npm run test:emulator`.
 *
 * The per-route files already assert that each route slides its own wheel — this
 * is not that. These are the cross-document properties that only break when two
 * routes are considered together, and that would otherwise be discovered in
 * production as data quietly outliving or predeceasing the thing it belongs to:
 *
 *  1. **A secret always outlives its wheel.** The pair is reaped by independent
 *     per-collection TTL jobs with no ordering guarantee, and one of the two
 *     orders leaves a live, publicly suggestable wheel whose owner has
 *     permanently lost the kill switch. A route that slid the wheel and forgot
 *     the secret, or recomputed the margin locally, would pass its own tests.
 *  2. **A suggestion never outlives its wheel.** A TTL delete does not cascade
 *     to subcollections, so a suggestion whose `expiresAt` ran past its wheel's
 *     would survive the wheel's deletion with nothing left to reach it from.
 *
 * Neither can be observed by watching a TTL policy work: the emulator serves no
 * field-configuration API and runs no reaper, and production reaps on a ~24 hour
 * horizon. What is testable is the state of the timestamps the policy acts on,
 * which is the half this codebase controls.
 *
 * A third invariant joins them, from the same source. `slidingExpiry` writes
 * `updatedAt` alongside the two expiries, and that field is the VERSION every
 * mutating route reports back so a client can ask whether the snapshot it is
 * looking at already includes its own write (see `WheelVersion` in
 * lib/wheels/model.ts). It is tested here rather than per route for the same
 * reason as the other two: what matters is that the set is complete, and a
 * route added later that forgot to report its version is invisible to a suite
 * organised per route.
 */

let db: Firestore

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  db = getAdminDb()
})

function request(url: string, method: string, token?: string, body?: unknown) {
  return new Request(`https://example.test${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })
}

/** A wheel with one option and one pending suggestion, plus its editor token. */
async function seed() {
  const { shareId, editToken } = await createWheel(
    { title: 'Lunch Friday', options: [{ id: 'seeded', label: 'Tacos' }] },
    db,
  )

  const suggestion = db
    .collection(WHEELS)
    .doc(shareId)
    .collection(SUGGESTIONS)
    .doc()
  await suggestion.set({
    label: 'Ramen',
    status: 'pending',
    createdAt: new Date(),
    // The wheel's own stored expiry, read back, rather than a fresh
    // `Date.now() + THIRTY_DAYS_MS`. That is what `submitSuggestion` writes —
    // `slide.wheel.expiresAt`, the same instant, not a recomputed one — and the
    // difference is not cosmetic here. `createWheel` computed the wheel's expiry
    // an emulator round trip ago, so a clock read taken now lands a few
    // milliseconds LATER, seeding a suggestion that outlives its wheel: exactly
    // the state the second describe below exists to forbid. Every case in it
    // would still pass, because each mutation slides the wheel back out in
    // front — the invariant would simply never be tested at rest.
    expiresAt: new Date(await expiryOf(WHEELS, shareId)),
  })

  return { shareId, editToken, suggestionId: suggestion.id }
}

async function expiryOf(collection: string, id: string) {
  const snapshot = await db.collection(collection).doc(id).get()
  return snapshot.get('expiresAt')?.toDate().getTime() as number
}

/**
 * Every suggestion's expiry on a wheel, keyed by document ID.
 *
 * Keyed rather than a list because both things a mutation can do to this queue —
 * submit adds a row, reject removes one — reorder a positional comparison, and
 * `.get()` returns documents by document ID rather than by insertion.
 */
async function suggestionExpiries(shareId: string) {
  const queue = await db
    .collection(WHEELS)
    .doc(shareId)
    .collection(SUGGESTIONS)
    .get()

  return new Map(
    queue.docs.map((doc) => [
      doc.id,
      doc.get('expiresAt').toDate().getTime() as number,
    ]),
  )
}

/**
 * Every route that writes, and how to call it.
 *
 * A table rather than six separate assertions because the property is about the
 * set: a route added later without a slide is invisible to a suite organised per
 * route, and this is the one place the omission can be noticed. Each entry
 * returns the response so a case that starts failing shows its status rather
 * than only a stale timestamp.
 *
 * `POST /duplicate` is deliberately absent. It is the one write in the API that
 * does not slide, because it does not mutate the wheel it names — see decision
 * 21 and the duplicate route's own suite, which asserts the source comes out
 * byte-for-byte unchanged.
 */
const MUTATIONS = [
  {
    label: 'PATCH the wheel',
    run: ({ shareId, editToken }: Awaited<ReturnType<typeof seed>>) =>
      patchWheel(
        request(`/api/wheels/${shareId}`, 'PATCH', editToken, {
          title: 'Dinner',
        }),
        {
          params: Promise.resolve({ shareId }),
        } as RouteContext<'/api/wheels/[shareId]'>,
      ),
  },
  {
    label: 'add an option',
    run: ({ shareId, editToken }: Awaited<ReturnType<typeof seed>>) =>
      createOption(
        request(`/api/wheels/${shareId}/options`, 'POST', editToken, {
          label: 'Pizza',
        }),
        {
          params: Promise.resolve({ shareId }),
        } as RouteContext<'/api/wheels/[shareId]/options'>,
      ),
  },
  {
    label: 'remove an option',
    run: ({ shareId, editToken }: Awaited<ReturnType<typeof seed>>) =>
      removeOption(
        request(`/api/wheels/${shareId}/options/seeded`, 'DELETE', editToken),
        {
          params: Promise.resolve({ shareId, optionId: 'seeded' }),
        } as RouteContext<'/api/wheels/[shareId]/options/[optionId]'>,
      ),
  },
  {
    label: 'submit a suggestion',
    run: ({ shareId }: Awaited<ReturnType<typeof seed>>) =>
      submitSuggestion(
        request(`/api/wheels/${shareId}/suggestions`, 'POST', undefined, {
          label: 'Sushi',
        }),
        {
          params: Promise.resolve({ shareId }),
        } as RouteContext<'/api/wheels/[shareId]/suggestions'>,
      ),
  },
  {
    label: 'accept a suggestion',
    run: ({
      shareId,
      editToken,
      suggestionId,
    }: Awaited<ReturnType<typeof seed>>) =>
      acceptSuggestion(
        request(
          `/api/wheels/${shareId}/suggestions/${suggestionId}/accept`,
          'POST',
          editToken,
        ),
        {
          params: Promise.resolve({ shareId, suggestionId }),
        } as RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]/accept'>,
      ),
  },
  {
    label: 'reject a suggestion',
    run: ({
      shareId,
      editToken,
      suggestionId,
    }: Awaited<ReturnType<typeof seed>>) =>
      rejectSuggestion(
        request(
          `/api/wheels/${shareId}/suggestions/${suggestionId}`,
          'DELETE',
          editToken,
        ),
        {
          params: Promise.resolve({ shareId, suggestionId }),
        } as RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]'>,
      ),
  },
]

describe('the secret always outlives its wheel', () => {
  it('holds at creation', async () => {
    const { shareId } = await seed()

    expect(await expiryOf(WHEEL_SECRETS, shareId)).toBeGreaterThan(
      await expiryOf(WHEELS, shareId),
    )
  })

  it.each(MUTATIONS)('holds after $label', async ({ run }) => {
    const fixture = await seed()

    const before = await expiryOf(WHEELS, fixture.shareId)
    const response = await run(fixture)
    expect(response.status, await response.clone().text()).toBeLessThan(300)

    const [wheel, secret] = await Promise.all([
      expiryOf(WHEELS, fixture.shareId),
      expiryOf(WHEEL_SECRETS, fixture.shareId),
    ])

    // Both moved, and the margin survived. Sliding only the wheel is the
    // tempting half-measure, and it is a slow-acting bug rather than a visible
    // one: the secret keeps its original expiry, gets reaped under an actively
    // used wheel, and nobody can edit that wheel again.
    expect(wheel, 'the wheel did not slide').toBeGreaterThanOrEqual(before)
    expect(secret, 'the secret is reapable before its wheel').toBeGreaterThan(
      wheel,
    )
  })
})

describe('a suggestion never outlives its wheel', () => {
  it('holds at rest, with nothing having slid the wheel', async () => {
    // The case the other two cannot make. Every mutation below slides the wheel
    // forward, so a suggestion seeded a few milliseconds past its wheel would
    // still come out behind it afterwards and the suite would report green on a
    // fixture that violated the invariant. This one reads both timestamps with
    // no write in between.
    const { shareId } = await seed()

    const wheel = await expiryOf(WHEELS, shareId)
    for (const suggestion of (await suggestionExpiries(shareId)).values()) {
      expect(
        suggestion,
        'a suggestion would survive the wheel it belongs to',
      ).toBeLessThanOrEqual(wheel)
    }
  })

  it('is written no later than its wheel', async () => {
    const { shareId } = await seed()

    await submitSuggestion(
      request(`/api/wheels/${shareId}/suggestions`, 'POST', undefined, {
        label: 'Sushi',
      }),
      {
        params: Promise.resolve({ shareId }),
      } as RouteContext<'/api/wheels/[shareId]/suggestions'>,
    )

    const wheel = await expiryOf(WHEELS, shareId)
    for (const suggestion of (await suggestionExpiries(shareId)).values()) {
      expect(
        suggestion,
        'a suggestion would survive the wheel it belongs to',
      ).toBeLessThanOrEqual(wheel)
    }
  })

  it.each(MUTATIONS)('still holds after $label', async ({ run }) => {
    // The invariant has to survive the wheel sliding away from a suggestion that
    // does not slide with it. It does, in one direction only — the gap opens
    // with the wheel ahead, never the suggestion.
    const fixture = await seed()

    await run(fixture)

    const wheel = await expiryOf(WHEELS, fixture.shareId)
    for (const suggestion of (
      await suggestionExpiries(fixture.shareId)
    ).values()) {
      expect(
        suggestion,
        'a suggestion would survive the wheel it belongs to',
      ).toBeLessThanOrEqual(wheel)
    }
  })

  it.each(MUTATIONS)(
    'and a suggestion is never slid by $label',
    async ({ run }) => {
      // The other half of decision 20, and the half that is actually observable in
      // a test that runs in milliseconds: a suggestion's expiry is fixed at submit
      // time, so no route moves it. The premature reaping this causes needs 30 days
      // to happen and cannot be watched; that a suggestion's timestamp never moves
      // is the mechanism, and it is checkable now.
      //
      // Written as "unchanged" rather than "behind the wheel" on purpose. A future
      // change that started sliding suggestions would keep the ordering invariant
      // above satisfied and silently reintroduce the per-edit fan-out this decision
      // exists to refuse.
      const fixture = await seed()

      const before = await suggestionExpiries(fixture.shareId)
      await run(fixture)
      const after = await suggestionExpiries(fixture.shareId)

      // Submit adds a row and reject removes one, so the queue may legitimately
      // change size. What must not happen is a row that exists both before and
      // after having a different timestamp.
      for (const [id, expiry] of before) {
        if (!after.has(id)) continue
        expect(after.get(id), `suggestion ${id} was slid`).toBe(expiry)
      }
    },
  )
})

/**
 * The version every mutating route reports, and the one way it can be wrong.
 *
 * The header and the stored field have to be the same instant. A client retires
 * its optimistic row when a snapshot's `updatedAt` reaches the value the route
 * handed back, so a header that ran even a millisecond AHEAD of what was stored
 * would describe a version no snapshot ever carries — every optimistic entry on
 * that wheel would wait for it forever, and the symptom would be rows that
 * never clear rather than anything that looks like a timestamp bug.
 *
 * That is also why `updatedAt` is a real `Date` rather than
 * `FieldValue.serverTimestamp()`: a sentinel is resolved during the commit and
 * the route would have nothing to report. See `writeVersion` in
 * lib/wheels/store.ts.
 */
describe('the version every write reports', () => {
  async function updatedAtOf(shareId: string): Promise<number> {
    const snapshot = await db.collection(WHEELS).doc(shareId).get()
    return snapshot.get('updatedAt')?.toDate().getTime() as number
  }

  it.each(MUTATIONS)('$label reports what it stored', async ({ run }) => {
    const seeded = await seed()

    const response = await run(seeded)
    const reported = response.headers.get(WHEEL_VERSION_HEADER)

    expect(
      reported,
      `${response.status} carried no ${WHEEL_VERSION_HEADER}`,
    ).not.toBeNull()
    expect(new Date(reported ?? '').getTime()).toBe(
      await updatedAtOf(seeded.shareId),
    )
  })

  it.each(MUTATIONS)(
    '$label reports a version that moves forward',
    async ({ run }) => {
      const seeded = await seed()
      const before = await updatedAtOf(seeded.shareId)

      const reported = (await run(seeded)).headers.get(WHEEL_VERSION_HEADER)

      // Greater, not merely different: a version that could go backwards would
      // let a snapshot from before the write satisfy the comparison.
      expect(new Date(reported ?? '').getTime()).toBeGreaterThan(before)
    },
  )

  /**
   * The write that stores nothing, and the reason the table above cannot catch
   * it: every row seeds a fresh PENDING suggestion, so no case in it ever takes
   * the idempotent path.
   *
   * A second accept writes nothing at all — not even the expiry slide, because
   * a second click is not activity. A version computed before the transaction
   * would therefore be strictly AHEAD of what is stored, which is the one shape
   * this header must never have: it describes a state no snapshot ever carries,
   * so every optimistic row on the wheel waits for it forever. The honest
   * answer is the version already on the document.
   */
  it('reports the stored version when a second accept writes nothing', async () => {
    const { shareId, editToken, suggestionId } = await seed()
    const accept = () =>
      acceptSuggestion(
        request(
          `/api/wheels/${shareId}/suggestions/${suggestionId}/accept`,
          'POST',
          editToken,
        ),
        {
          params: Promise.resolve({ shareId, suggestionId }),
        } as RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]/accept'>,
      )

    await accept()
    const afterFirst = await updatedAtOf(shareId)

    const second = await accept()

    expect(second.status).toBe(204)
    expect(
      await updatedAtOf(shareId),
      'the second accept was supposed to write nothing',
    ).toBe(afterFirst)

    const reported = second.headers.get(WHEEL_VERSION_HEADER)
    expect(reported, 'no version on the idempotent accept').not.toBeNull()
    expect(
      new Date(reported ?? '').getTime(),
      'the header ran ahead of the document, so no snapshot can ever satisfy it',
    ).toBe(afterFirst)
  })

  /**
   * `POST /duplicate` is absent from the table for the same reason it is absent
   * from the expiry cases: it does not mutate the wheel it names. It has no
   * version to report because nothing about the source changed, and a client
   * has nothing to reconcile — the result is a different wheel and a
   * navigation.
   */
  it('is not reported by the one write that changes no existing wheel', async () => {
    const { shareId } = await seed()
    const before = await updatedAtOf(shareId)

    const response = await duplicateWheel(
      request(`/api/wheels/${shareId}/duplicate`, 'POST'),
      {
        params: Promise.resolve({ shareId }),
      } as RouteContext<'/api/wheels/[shareId]/duplicate'>,
    )

    expect(response.status).toBe(201)
    expect(response.headers.get(WHEEL_VERSION_HEADER)).toBeNull()
    expect(await updatedAtOf(shareId)).toBe(before)
  })
})
