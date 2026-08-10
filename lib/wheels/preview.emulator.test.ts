import { type Firestore } from 'firebase-admin/firestore'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAdminDb } from '@/lib/firebase/admin'

import { createWheel, readWheelPreview, WHEELS } from './store'
import { DEFAULT_TITLE } from './validation'

/**
 * `readWheelPreview`, against a live Firestore. Run with
 * `npm run test:emulator`.
 *
 * The only read in lib/wheels/store.ts, and the one both Open Graph routes in
 * app/w/[shareId]/ sit on. No unit-project counterpart: what is worth testing
 * here is what comes back out of a real document, including documents this API
 * cannot write but a console edit can.
 *
 * Two of these are invariants rather than behaviour. **A read must not slide
 * the wheel's expiry** — an unfurl is a crawler reading a link somebody pasted,
 * not activity, and treating it as activity would let a link in a busy channel
 * keep a wheel alive forever, defeating the bounded lifetime of a leaked link
 * that design doc section 8 exists for. And **a missing wheel is `null`, never
 * a throw**, because both callers are metadata for a page that must still
 * render.
 */

let db: Firestore

/** Well-formed — 20 of `[A-Za-z0-9]` — but nothing was ever written to it. */
const UNUSED_SHARE_ID = 'zz00zz00zz00zz00zz00'

beforeAll(() => {
  expect(
    process.env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  db = getAdminDb()
})

describe('readWheelPreview', () => {
  it('reports the title, the labels and how many there are', async () => {
    const { shareId } = await createWheel(
      {
        title: 'Team lunch',
        options: [{ label: 'Tacos' }, { label: 'Ramen' }],
      },
      db,
    )

    await expect(readWheelPreview(shareId, db)).resolves.toEqual({
      title: 'Team lunch',
      options: ['Tacos', 'Ramen'],
      optionCount: 2,
    })
  })

  it('keeps the labels in the wheel’s own order', async () => {
    // The card colours a pill by its position, so a reordering here would pair
    // a pill with another option's slice.
    const labels = ['First', 'Second', 'Third', 'Fourth']
    const { shareId } = await createWheel(
      { title: 'Ordered', options: labels.map((label) => ({ label })) },
      db,
    )

    const preview = await readWheelPreview(shareId, db)
    expect(preview?.options).toEqual(labels)
  })

  it('reports an empty wheel as zero rather than as missing', async () => {
    const { shareId } = await createWheel({ title: 'Nothing yet' }, db)

    await expect(readWheelPreview(shareId, db)).resolves.toEqual({
      title: 'Nothing yet',
      options: [],
      optionCount: 0,
    })
  })

  it('returns null for a wheel that does not exist', async () => {
    await expect(readWheelPreview(UNUSED_SHARE_ID, db)).resolves.toBeNull()
  })

  it.each([
    { label: 'a path separator', shareId: 'wheels/x/wheelSecrets/y' },
    { label: 'the empty string', shareId: '' },
    { label: 'a short id', shareId: 'abc' },
  ])(
    'returns null for $label without touching a document',
    async ({ shareId }) => {
      // The guard runs before the value can reach `collection.doc()`, which
      // resolves slashes as path separators — see `isShareId`.
      await expect(readWheelPreview(shareId, db)).resolves.toBeNull()
    },
  )

  it('leaves the wheel exactly as it found it', async () => {
    const { shareId } = await createWheel({ title: 'Untouched' }, db)
    const before = (await db.collection(WHEELS).doc(shareId).get()).data()

    await readWheelPreview(shareId, db)

    const after = (await db.collection(WHEELS).doc(shareId).get()).data()
    expect(
      after,
      'a crawler reading a pasted link is not activity on the wheel',
    ).toEqual(before)
  })

  it('names a wheel whose stored title is not a string', async () => {
    // Not reachable through this API — every write path validates — but a
    // console edit or a future migration can produce it, and the failure it
    // guards is a share card cached with a blank line where the title goes.
    await db
      .collection(WHEELS)
      .doc(UNUSED_SHARE_ID)
      .set({ title: 42, options: [{ id: 'a', label: 'One' }] })

    await expect(readWheelPreview(UNUSED_SHARE_ID, db)).resolves.toEqual({
      title: DEFAULT_TITLE,
      options: ['One'],
      optionCount: 1,
    })

    await db.collection(WHEELS).doc(UNUSED_SHARE_ID).delete()
  })

  it('counts nothing when the options field is not an array', async () => {
    await db.collection(WHEELS).doc(UNUSED_SHARE_ID).set({ title: 'Odd' })

    await expect(readWheelPreview(UNUSED_SHARE_ID, db)).resolves.toEqual({
      title: 'Odd',
      options: [],
      optionCount: 0,
    })

    await db.collection(WHEELS).doc(UNUSED_SHARE_ID).delete()
  })

  it('holds a place for an option whose label is not a string', async () => {
    // Empty rather than dropped, so the labels stay parallel to the wedges —
    // dropping one would shift every option after it into the wrong colour.
    // `optionPills` is what refuses to draw the blank.
    await db
      .collection(WHEELS)
      .doc(UNUSED_SHARE_ID)
      .set({
        title: 'Gappy',
        options: [{ label: 'Tacos' }, { label: 7 }, { label: 'Ramen' }],
      })

    await expect(readWheelPreview(UNUSED_SHARE_ID, db)).resolves.toEqual({
      title: 'Gappy',
      options: ['Tacos', '', 'Ramen'],
      optionCount: 3,
    })

    await db.collection(WHEELS).doc(UNUSED_SHARE_ID).delete()
  })
})
