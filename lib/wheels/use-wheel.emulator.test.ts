// @vitest-environment jsdom

import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  acceptSuggestion,
  addOption,
  createWheel,
  removeOption,
  submitSuggestion,
  updateWheel,
} from './store'

/**
 * The listeners against a real Firestore, through a real client SDK.
 *
 * Its companions ./use-wheel.test.ts and ./use-suggestions.test.ts drive
 * `onSnapshot` by hand, which is the only way to prove teardown but proves
 * nothing about whether the subscription works. This file is the other half:
 * every fixture is written by the Admin SDK through ./store.ts — the same
 * functions the route handlers call — so what is under test is the whole read
 * path the browser actually has, including the security rules the emulator is
 * now enforcing.
 *
 * Run with `npm run test:emulator`.
 *
 * The client SDK needs the `NEXT_PUBLIC_*` values that `.env.development`
 * supplies to `next dev`. `firebase emulators:exec` does not load that file, so
 * they are derived here from `FIRESTORE_EMULATOR_HOST`, which it does set —
 * deriving rather than hard-coding keeps this pointed at whatever port the
 * emulator actually came up on.
 */

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? ''
const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-spinnerly'

vi.stubEnv('NEXT_PUBLIC_FIREBASE_EMULATOR_HOST', EMULATOR_HOST)
vi.stubEnv('NEXT_PUBLIC_FIREBASE_PROJECT_ID', PROJECT_ID)
vi.stubEnv('NEXT_PUBLIC_FIREBASE_API_KEY', 'demo-api-key')

const { useWheel } = await import('./use-wheel')
const { useSuggestions } = await import('./use-suggestions')

let app: App
let db: Firestore

/**
 * Generous, and deliberately so. What is being waited on is a real WebChannel
 * round trip to a Java process, not a resolved promise, and these tests run
 * alongside the rest of the emulator suite. A tight timeout here would fail as
 * a flake rather than as a finding.
 */
const ARRIVES = { timeout: 10_000 }

beforeAll(() => {
  expect(
    EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST is unset — run these with `npm run test:emulator`.',
  ).toBeTruthy()

  app = initializeApp({ projectId: PROJECT_ID }, `task-15-tests-${process.pid}`)
  db = getFirestore(app)
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  if (app) await deleteApp(app)
})

/** A wheel with a known title and options, written the way a route writes one. */
async function seed(
  options: { label: string }[] = [],
): Promise<{ shareId: string; editToken: string }> {
  return createWheel({ title: 'Lunch Friday', options }, db)
}

describe('useWheel', () => {
  it('delivers a wheel that already exists (AC 1)', async () => {
    const { shareId } = await seed([{ label: 'Tacos' }])

    const { result } = renderHook(() => useWheel(shareId))
    expect(result.current.status).toBe('loading')

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    }, ARRIVES)

    expect(result.current.wheel?.shareId).toBe(shareId)
    expect(result.current.wheel?.title).toBe('Lunch Friday')
    expect(result.current.wheel?.options.map((o) => o.label)).toEqual(['Tacos'])
    expect(result.current.wheel?.suggestionsOpen).toBe(true)
  })

  /**
   * The reason this application is on Firestore at all: a write by one client
   * reaches another with no polling and no websocket layer of our own.
   */
  it('delivers an option added after the listener opened', async () => {
    const { shareId } = await seed()
    const { result } = renderHook(() => useWheel(shareId))
    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)

    await addOption(shareId, { label: 'Ramen' }, db)

    await waitFor(() => {
      expect(result.current.wheel?.options.map((o) => o.label)).toEqual([
        'Ramen',
      ])
    }, ARRIVES)
  })

  it('delivers a removal and a title change', async () => {
    const { shareId } = await seed([{ label: 'Tacos' }, { label: 'Pizza' }])
    const { result } = renderHook(() => useWheel(shareId))
    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)

    const doomed = result.current.wheel?.options.find(
      (o) => o.label === 'Tacos',
    )
    await removeOption(shareId, doomed?.id ?? '', db)
    await updateWheel(shareId, { title: 'Dinner', suggestionsOpen: false }, db)

    await waitFor(() => {
      expect(result.current.wheel?.title).toBe('Dinner')
      expect(result.current.wheel?.suggestionsOpen).toBe(false)
      expect(result.current.wheel?.options.map((o) => o.label)).toEqual([
        'Pizza',
      ])
    }, ARRIVES)
  })

  it('decodes the timestamps the Admin SDK wrote as Dates', async () => {
    const { shareId } = await seed([{ label: 'Tacos' }])
    const { result } = renderHook(() => useWheel(shareId))
    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)

    // The Timestamp-to-Date duck-typing in ./snapshot.ts is only ever exercised
    // against a hand-made stub in the unit tests. This is the one place a real
    // Firestore `Timestamp` goes through it.
    expect(result.current.wheel?.createdAt).toBeInstanceOf(Date)
    expect(result.current.wheel?.expiresAt).toBeInstanceOf(Date)
    expect(result.current.wheel?.options[0].addedAt).toBeInstanceOf(Date)
    expect(result.current.wheel?.expiresAt?.getTime() ?? 0).toBeGreaterThan(
      Date.now(),
    )
  })

  /** AC 7, against a document that genuinely is not there. */
  it('reports not-found for a wheel that does not exist', async () => {
    const { result } = renderHook(() => useWheel('nOsUcHwHeElAtAlLxYzA'))

    await waitFor(() => {
      expect(result.current.status).toBe('not-found')
    }, ARRIVES)

    expect(result.current.wheel).toBeNull()
    expect(result.current.error).toBeNull()
  })

  /**
   * AC 2. A leaked listener still delivers correct data, so the only way to see
   * one is to change the database after unmounting and check that nothing
   * moved. The counter is the observable: a delivered snapshot would raise it.
   */
  it('stops delivering after unmount', async () => {
    const { shareId } = await seed()
    const { result, unmount } = renderHook(() => useWheel(shareId))
    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)

    const seqAtUnmount = result.current.seq
    unmount()

    await addOption(shareId, { label: 'Ramen' }, db)
    // Long enough that a live listener would certainly have delivered — the
    // assertions above land well inside this.
    await new Promise((resolve) => setTimeout(resolve, 750))

    expect(result.current.seq).toBe(seqAtUnmount)
    expect(result.current.wheel?.options).toEqual([])
  })

  it('follows a change of wheel without carrying the old one over', async () => {
    const first = await seed([{ label: 'Tacos' }])
    const second = await seed([{ label: 'Ramen' }])

    const { result, rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: first.shareId },
    })
    await waitFor(() => {
      expect(result.current.wheel?.options.map((o) => o.label)).toEqual([
        'Tacos',
      ])
    }, ARRIVES)

    act(() => rerender({ id: second.shareId }))
    expect(
      result.current.wheel,
      'the first wheel was still on screen under the second wheel’s ID',
    ).toBeNull()

    await waitFor(() => {
      expect(result.current.wheel?.options.map((o) => o.label)).toEqual([
        'Ramen',
      ])
    }, ARRIVES)
  })
})

describe('useSuggestions', () => {
  it('delivers the queue and keeps it live (AC 1)', async () => {
    const { shareId } = await seed()
    const { result } = renderHook(() => useSuggestions(shareId))

    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)
    expect(result.current.suggestions).toEqual([])

    await submitSuggestion(shareId, { label: 'Ramen' }, db)

    await waitFor(() => {
      expect(result.current.suggestions.map((s) => s.label)).toEqual(['Ramen'])
    }, ARRIVES)
    expect(result.current.suggestions[0].status).toBe('pending')
    expect(result.current.suggestions[0].createdAt).toBeInstanceOf(Date)
  })

  it('orders the queue oldest first', async () => {
    const { shareId } = await seed()
    // Sequential rather than concurrent: the assertion is about order, and two
    // submissions racing would make the expected order the thing under test.
    await submitSuggestion(shareId, { label: 'first' }, db)
    await submitSuggestion(shareId, { label: 'second' }, db)
    await submitSuggestion(shareId, { label: 'third' }, db)

    const { result } = renderHook(() => useSuggestions(shareId))

    await waitFor(() => {
      expect(result.current.suggestions.map((s) => s.label)).toEqual([
        'first',
        'second',
        'third',
      ])
    }, ARRIVES)
  })

  /**
   * The two documents an accept touches, seen from the two listeners that
   * deliver them. This is the shape ./optimistic.ts's accept case is built
   * around: the option and the status flip arrive independently.
   */
  it('delivers an accept as a status flip, with the option on the wheel', async () => {
    const { shareId } = await seed()
    const {
      suggestion: { id },
    } = await submitSuggestion(shareId, { label: 'Ramen' }, db)

    const queue = renderHook(() => useSuggestions(shareId))
    const wheel = renderHook(() => useWheel(shareId))
    await waitFor(() => {
      expect(queue.result.current.suggestions).toHaveLength(1)
    }, ARRIVES)

    await acceptSuggestion(shareId, id, db)

    await waitFor(() => {
      expect(queue.result.current.suggestions[0].status).toBe('accepted')
      expect(wheel.result.current.wheel?.options.map((o) => o.label)).toEqual([
        'Ramen',
      ])
    }, ARRIVES)

    // The key the optimistic accept retires on. If TASK-12 ever stopped writing
    // it, an accepted suggestion's optimistic row would never recognise its own
    // arrival and would be drawn beside the real one.
    expect(wheel.result.current.wheel?.options[0].fromSuggestion).toBe(id)
  })

  it('reads the queue of a wheel that does not exist as empty, not missing', async () => {
    const { result } = renderHook(() => useSuggestions('nOsUcHwHeElAtAlLxYzA'))

    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)
    expect(result.current.suggestions).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('stops delivering after unmount', async () => {
    const { shareId } = await seed()
    const { result, unmount } = renderHook(() => useSuggestions(shareId))
    await waitFor(() => expect(result.current.status).toBe('ready'), ARRIVES)

    unmount()
    await submitSuggestion(shareId, { label: 'Ramen' }, db)
    await new Promise((resolve) => setTimeout(resolve, 750))

    expect(result.current.suggestions).toEqual([])
  })
})
