import { readFileSync } from 'node:fs'

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  updateDoc,
  where,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * The security rules are the whole client-side security model (design doc
 * section 5), and the thing they defend against — a rules edit that quietly
 * opens a read or a write — is invisible in review and catastrophic in
 * production. So every clause gets an assertion, and the assertions are
 * deny-first.
 *
 * These run against the emulator via `npm run test:emulator`. Against a live
 * project the same checks could only be done by hand, once, and would rot from
 * the next edit onwards.
 *
 * The rules under test are READ FROM DISK rather than inlined here. An inline
 * copy would test a string that agrees with the deployed file only for as long
 * as someone keeps the two in step, which is exactly the discipline that fails.
 */

const RULES_PATH = new URL('./firestore.rules', import.meta.url)

/**
 * Twenty characters of [A-Za-z0-9], the shape of a Firestore auto-ID — the
 * same constraint the seed script conforms to, for the same reason: `isShareId`
 * in lib/wheels/store.ts rejects anything else.
 */
const WHEEL = 'rulestestwheel000000'
/** A second wheel, so the collection-group cases have more than one parent to escape from. */
const OTHER_WHEEL = 'rulestestwheel000001'
const SUGGESTION = 'rulestestsugg0000000'
const SPIN = 'rulestestspin0000000'

let testEnv: RulesTestEnvironment

/**
 * `RulesTestContext.firestore()` is declared as returning the *compat*
 * `firebase.firestore.Firestore`, while every function this file calls is from
 * the v9 modular SDK. The instance genuinely is usable with both — the library
 * documents that and it is the only supported way to use the modular API here —
 * so the mismatch is in the type declaration rather than in the object, and the
 * cast is confined to this one function instead of appearing at each call site.
 */
function firestoreOf(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore
}

/** A browser with no Firebase Auth token — which is every Spinnerly client, since the app has no accounts. */
function client(): Firestore {
  return firestoreOf(testEnv.unauthenticatedContext())
}

/**
 * A signed-in browser. Spinnerly never produces one, and that is the point of
 * testing with it: the rules must not have a condition that an attacker can
 * satisfy just by calling `signInAnonymously`, which is enabled by default on
 * a new Firebase project.
 */
function signedInClient(): Firestore {
  return firestoreOf(testEnv.authenticatedContext('some-uid'))
}

beforeAll(async () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
  expect(
    emulatorHost,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`. ' +
      'Rules only exist inside a Firestore, so there is nothing for this suite to ' +
      'assert against without one.',
  ).toBeTruthy()

  const separator = emulatorHost!.lastIndexOf(':')

  testEnv = await initializeTestEnvironment({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-spinnerly',
    firestore: {
      rules: readFileSync(RULES_PATH, 'utf8'),
      // Passed explicitly rather than left to the Emulator Hub. `npm run
      // test:emulator` runs `emulators:exec --only firestore`, so which
      // emulators the hub knows about depends on that flag; FIRESTORE_EMULATOR_HOST
      // is set either way and is what every other suite here already trusts.
      host: emulatorHost!.slice(0, separator),
      port: Number(emulatorHost!.slice(separator + 1)),
    },
  })

  // `withSecurityRulesDisabled` is the only writer in this file that is meant
  // to succeed. Everything the fixture needs has to arrive this way, because
  // the rules under test forbid a client from creating any of it — which is
  // itself the thing being tested.
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = firestoreOf(context)
    await setDoc(doc(db, 'wheels', WHEEL), {
      title: 'Lunch Friday',
      options: [],
      suggestionsOpen: true,
    })
    await setDoc(doc(db, 'wheels', WHEEL, 'suggestions', SUGGESTION), {
      label: 'Tacos',
      status: 'pending',
    })
    await setDoc(doc(db, 'wheels', WHEEL, 'spins', SPIN), {
      resultIndex: 0,
    })
    await setDoc(doc(db, 'wheelSecrets', WHEEL), {
      editTokenHash: 'not-a-real-hash',
    })

    // A second wheel with its own subcollections. Without it, a collection
    // group query that leaked exactly one parent's data would be
    // indistinguishable from one that was properly denied.
    await setDoc(doc(db, 'wheels', OTHER_WHEEL), { title: 'Dinner' })
    await setDoc(doc(db, 'wheels', OTHER_WHEEL, 'suggestions', SUGGESTION), {
      label: 'Ramen',
    })
    await setDoc(doc(db, 'wheels', OTHER_WHEEL, 'spins', SPIN), {
      resultIndex: 1,
    })
  })
})

afterAll(async () => {
  // Guarded: `testEnv` is only assigned after the env-var check above, and an
  // unguarded `cleanup()` on undefined would throw a second failure that buries
  // the first — the one carrying the instructions.
  if (testEnv) await testEnv.cleanup()
})

describe('reads a client is meant to have', () => {
  it('allows get on a wheel whose shareId is known', async () => {
    const snapshot = await assertSucceeds(
      getDoc(doc(client(), 'wheels', WHEEL)),
    )
    expect(
      snapshot.data()?.title,
      'the read was permitted but returned nothing, so the fixture never landed',
    ).toBe('Lunch Friday')
  })

  it('allows get and list on the suggestions of a known wheel', async () => {
    const db = client()
    await assertSucceeds(
      getDoc(doc(db, 'wheels', WHEEL, 'suggestions', SUGGESTION)),
    )
    const listed = await assertSucceeds(
      getDocs(collection(db, 'wheels', WHEEL, 'suggestions')),
    )
    expect(listed.size).toBe(1)
  })

  it('allows get and list on the spins of a known wheel', async () => {
    const db = client()
    await assertSucceeds(getDoc(doc(db, 'wheels', WHEEL, 'spins', SPIN)))
    await assertSucceeds(getDocs(collection(db, 'wheels', WHEEL, 'spins')))
  })

  it('allows a signed-in client exactly the same reads and no more', async () => {
    const db = signedInClient()
    await assertSucceeds(getDoc(doc(db, 'wheels', WHEEL)))
    await assertFails(getDocs(collection(db, 'wheels')))
    await assertFails(getDoc(doc(db, 'wheelSecrets', WHEEL)))
  })
})

describe('list on the wheels collection — the load-bearing denial', () => {
  /**
   * Design doc section 5: with `list` permitted, `getDocs(collection(db,
   * 'wheels'))` walks the entire collection and every share ID in existence
   * comes back with it, at which point the unguessable ID secures nothing.
   */
  it('denies an unfiltered list of every wheel', async () => {
    await assertFails(getDocs(collection(client(), 'wheels')))
  })

  it.each([
    {
      label: 'a filtered query',
      build: (wheels: CollectionReference) =>
        query(wheels, where('suggestionsOpen', '==', true)),
    },
    {
      label: 'a single-document query',
      build: (wheels: CollectionReference) => query(wheels, limit(1)),
    },
    {
      label: 'a query filtered to one known document',
      build: (wheels: CollectionReference) =>
        query(wheels, where('title', '==', 'Lunch Friday')),
    },
  ])(
    'denies $label, because rules are not filters and this is still a list',
    async ({ build }) => {
      await assertFails(getDocs(build(collection(client(), 'wheels'))))
    },
  )
})

describe('wheelSecrets is unreachable', () => {
  it('denies get on a secret whose shareId is known', async () => {
    await assertFails(getDoc(doc(client(), 'wheelSecrets', WHEEL)))
  })

  it('denies list on the secrets collection', async () => {
    await assertFails(getDocs(collection(client(), 'wheelSecrets')))
  })
})

describe('collection group queries cannot escape a parent path', () => {
  /**
   * The subcollection rules permit `list`, which is safe only because reaching
   * them requires naming a shareId. A collection group query does not name one
   * — it reaches every `suggestions` collection under every wheel at once —
   * and under rules v2 it is authorised only by a rule with a recursive
   * wildcard prefix. There is no such rule, so these are denied by absence.
   *
   * That makes this the most fragile guarantee in the file: it holds because
   * of a line nobody wrote, and a plausible-looking `match /{document=**}`
   * added later would revoke it silently.
   */
  it.each([
    { label: 'suggestions', group: 'suggestions' },
    { label: 'spins', group: 'spins' },
  ])('denies collectionGroup($label) across all wheels', async ({ group }) => {
    await assertFails(getDocs(collectionGroup(client(), group)))
  })

  it('denies a collection group query even when filtered', async () => {
    await assertFails(
      getDocs(
        query(
          collectionGroup(client(), 'suggestions'),
          where('label', '==', 'Tacos'),
        ),
      ),
    )
  })
})

/**
 * Every write verb against every collection. The browser's write path is the
 * API (design doc section 3), so there is no case in this block that is
 * expected to succeed — the table exists to make sure none quietly starts to.
 *
 * `path` is a tuple rather than a string because `doc()` and `collection()`
 * take path segments, and a slash-joined string would silently accept an even
 * number of segments where an odd one was meant.
 */
const WRITE_TARGETS = [
  { label: 'a wheel', collectionPath: ['wheels'], docId: WHEEL },
  {
    label: 'a suggestion',
    collectionPath: ['wheels', WHEEL, 'suggestions'],
    docId: SUGGESTION,
  },
  {
    label: 'a spin',
    collectionPath: ['wheels', WHEEL, 'spins'],
    docId: SPIN,
  },
  { label: 'a wheel secret', collectionPath: ['wheelSecrets'], docId: WHEEL },
] as const

describe.each(WRITE_TARGETS)(
  'no client can write $label',
  ({ collectionPath, docId }) => {
    function target(db: Firestore) {
      return collection(db, collectionPath[0], ...collectionPath.slice(1))
    }

    it('denies creating a new document with a chosen ID', async () => {
      const db = client()
      await assertFails(
        setDoc(doc(target(db), 'brandnewdocument00000'), { label: 'nope' }),
      )
    })

    it('denies creating a new document with an auto-ID', async () => {
      await assertFails(addDoc(target(client()), { label: 'nope' }))
    })

    it('denies overwriting an existing document', async () => {
      await assertFails(setDoc(doc(target(client()), docId), { label: 'nope' }))
    })

    it('denies updating an existing document', async () => {
      await assertFails(
        updateDoc(doc(target(client()), docId), { label: 'nope' }),
      )
    })

    it('denies deleting an existing document', async () => {
      await assertFails(deleteDoc(doc(target(client()), docId)))
    })

    it('denies a signed-in client the same write', async () => {
      await assertFails(
        setDoc(doc(target(signedInClient()), docId), { label: 'nope' }),
      )
    })
  },
)

describe('the default-deny floor', () => {
  /**
   * Nothing in the app reads these paths; the point is that the rules file has
   * no catch-all, so a collection somebody adds later is denied until a rule
   * is written for it deliberately. If one of these ever starts passing, a
   * recursive wildcard has been introduced somewhere above.
   */
  it.each([
    { label: 'an unmatched top-level collection', path: ['chat', 'c1'] },
    {
      label: 'an unmatched subcollection of a wheel',
      path: ['wheels', WHEEL, 'chat', 'c1'],
    },
    {
      label: 'a deeper collection under a suggestion',
      path: ['wheels', WHEEL, 'suggestions', SUGGESTION, 'votes', 'v1'],
    },
  ])('denies reading $label', async ({ path }) => {
    const db = client()
    await assertFails(getDoc(doc(db, path[0], ...path.slice(1))))
  })
})
