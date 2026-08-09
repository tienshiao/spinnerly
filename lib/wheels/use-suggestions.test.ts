// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The suggestions listener. Same recorded-`onSnapshot` approach as
 * ./use-wheel.test.ts, and the same reason: teardown is the property no
 * assertion about data can catch.
 *
 * What differs from the wheel listener is worth stating, because both look like
 * near-copies until one of them is wrong:
 *
 *  - There is no `not-found`. An empty queue is a legitimate answer, and the
 *    subcollection of a wheel that does not exist reads as empty rather than as
 *    absent — the wheel listener is what says whether the wheel is there.
 *  - The query is unordered and sorted in the client, because an
 *    `orderBy('createdAt')` would EXCLUDE a document that lacks the field
 *    rather than merely sorting it oddly.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const OTHER_ID = 'zYxWvUtSrQpOnMlKjIhG'

type Recorded = {
  path: string
  next: (snapshot: unknown) => void
  fail: (error: unknown) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

const firestore = vi.hoisted(() => ({ listeners: [] as Recorded[] }))

vi.mock('@/lib/firebase/client', () => ({
  getClientDb: () => ({ marker: 'client-db' }),
}))

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  onSnapshot: (
    reference: { path: string },
    next: (snapshot: unknown) => void,
    fail: (error: unknown) => void,
  ) => {
    const unsubscribe = vi.fn()
    firestore.listeners.push({ path: reference.path, next, fail, unsubscribe })
    return unsubscribe
  },
}))

const { useSuggestions } = await import('./use-suggestions')

const stamp = (iso: string) => ({ toDate: () => new Date(iso) })

/** A `QuerySnapshot` by the one property this hook reads. */
const queue = (...docs: { id: string; data: Record<string, unknown> }[]) => ({
  docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })),
})

const only = (): Recorded => {
  expect(firestore.listeners).toHaveLength(1)
  return firestore.listeners[0]
}

beforeEach(() => {
  firestore.listeners.length = 0
})

afterEach(() => {
  cleanup()
})

describe('subscribing', () => {
  it('opens one listener on the subcollection', () => {
    renderHook(() => useSuggestions(SHARE_ID))
    expect(only().path).toBe(`wheels/${SHARE_ID}/suggestions`)
  })

  it('starts in loading with an empty queue', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    expect(result.current.status).toBe('loading')
    expect(result.current.suggestions).toEqual([])
  })

  it('decodes the queue', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() =>
      only().next(
        queue({
          id: 'sug-1',
          data: {
            label: 'Ramen',
            status: 'pending',
            createdAt: stamp('2026-08-01T10:00:00.000Z'),
          },
        }),
      ),
    )

    expect(result.current.status).toBe('ready')
    expect(result.current.suggestions).toEqual([
      {
        id: 'sug-1',
        label: 'Ramen',
        status: 'pending',
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        expiresAt: null,
      },
    ])
  })

  it('sorts oldest first, whatever order the snapshot arrived in', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() =>
      only().next(
        queue(
          {
            id: 'c',
            data: { label: 'c', createdAt: stamp('2026-08-03T00:00:00.000Z') },
          },
          {
            id: 'a',
            data: { label: 'a', createdAt: stamp('2026-08-01T00:00:00.000Z') },
          },
          {
            id: 'b',
            data: { label: 'b', createdAt: stamp('2026-08-02T00:00:00.000Z') },
          },
        ),
      ),
    )

    expect(result.current.suggestions.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  /**
   * The reason the query is unordered. Under an `orderBy('createdAt')` this row
   * would not be sorted last — it would not be returned at all, invisible to
   * the editor who has to action it.
   */
  it('keeps a row with no createdAt, at the end of the queue', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() =>
      only().next(
        queue(
          { id: 'undated', data: { label: 'undated' } },
          {
            id: 'a',
            data: { label: 'a', createdAt: stamp('2026-08-01T00:00:00.000Z') },
          },
        ),
      ),
    )

    expect(result.current.suggestions.map((s) => s.id)).toEqual([
      'a',
      'undated',
    ])
  })

  /**
   * The queue has no version of its own — a collection is not a document — so
   * ./optimistic.ts asks it one question instead: has this listener said
   * anything since a write settled? That is what lets a suggestion the wheel's
   * version says was written and deleted be reported as gone rather than as
   * still on its way.
   */
  it('counts deliveries', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    expect(result.current.seq).toBe(0)
    act(() => only().next(queue()))
    expect(result.current.seq).toBe(1)
    act(() => only().next(queue({ id: 'sug-1', data: { label: 'Ramen' } })))
    expect(result.current.seq).toBe(2)
  })

  /**
   * `latestSeq()` is current the instant the callback runs; `seq` only on the
   * render that follows. A write settling in that gap is a resolved promise,
   * and the session records the count right there — reading state instead would
   * record one behind, making "the queue has delivered since" true against the
   * very delivery the entry was already looking at.
   */
  it('exposes the delivery count before the render that carries it', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))
    const delivered = result.current.latestSeq

    expect(delivered()).toBe(0)

    act(() => {
      only().next(queue())

      expect(delivered(), 'the count lags its own callback').toBe(1)
      expect(
        result.current.seq,
        'state cannot have updated yet — that is the window this exists for',
      ).toBe(0)
    })

    expect(result.current.seq).toBe(1)
  })

  it('does not count a listener error as a delivery', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() => only().next(queue()))
    act(() => only().fail({ code: 'unavailable' }))

    expect(result.current.seq).toBe(1)
    expect(result.current.latestSeq()).toBe(1)
  })

  it('restarts the count for a different wheel', () => {
    const { result, rerender } = renderHook(({ id }) => useSuggestions(id), {
      initialProps: { id: SHARE_ID },
    })

    act(() => firestore.listeners[0].next(queue()))
    expect(result.current.latestSeq()).toBe(1)

    rerender({ id: OTHER_ID })

    // Counts from two wheels must never be comparable — a settle holding wheel
    // A's count would otherwise be measured against wheel B's.
    expect(result.current.latestSeq()).toBe(0)
  })

  it('reports an empty queue as ready rather than as missing', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() => only().next(queue()))

    expect(result.current.status).toBe('ready')
    expect(result.current.suggestions).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('survives a document it cannot decode', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))

    act(() => only().next({ docs: [{ id: 'sug-1', data: () => 42 }] }))

    expect(result.current.suggestions[0].label).toBe('')
    expect(result.current.suggestions[0].status).toBe('pending')
  })

  it('reports a rules refusal as an error', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID))
    const refused = { code: 'permission-denied' }

    act(() => only().fail(refused))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(refused)
    expect(result.current.suggestions).toEqual([])
  })

  it('opens no listener for an ID that cannot name a wheel', () => {
    const { result } = renderHook(() => useSuggestions('../wheelSecrets/x'))

    expect(firestore.listeners).toHaveLength(0)
    // `ready` and empty rather than `loading`: there is nothing to wait for,
    // and the wheel listener is the one that reports the bad ID.
    expect(result.current.status).toBe('ready')
  })
})

describe('teardown', () => {
  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useSuggestions(SHARE_ID))
    const listener = only()

    unmount()
    expect(listener.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the old wheel before opening the new one', () => {
    const { rerender } = renderHook(({ id }) => useSuggestions(id), {
      initialProps: { id: SHARE_ID },
    })
    const first = firestore.listeners[0]

    rerender({ id: OTHER_ID })

    expect(first.unsubscribe).toHaveBeenCalledTimes(1)
    expect(firestore.listeners[1].path).toBe(`wheels/${OTHER_ID}/suggestions`)
  })

  /** As in ./use-wheel.test.ts: the one case the shareId pairing cannot cover. */
  it('ignores a torn-down listener that shares its wheel with a live one', () => {
    const { result } = renderHook(() => useSuggestions(SHARE_ID), {
      wrapper: StrictMode,
    })

    expect(
      firestore.listeners,
      'StrictMode no longer double-invokes, so this case is untested',
    ).toHaveLength(2)
    const [torndown, current] = firestore.listeners

    act(() => current.next(queue({ id: 'sug-1', data: { label: 'Current' } })))
    act(() => torndown.next(queue({ id: 'sug-2', data: { label: 'Stale' } })))

    expect(result.current.suggestions.map((s) => s.label)).toEqual(['Current'])
  })

  it('ignores a snapshot that arrives after its listener was torn down', () => {
    const { result, rerender } = renderHook(({ id }) => useSuggestions(id), {
      initialProps: { id: SHARE_ID },
    })
    const first = firestore.listeners[0]

    act(() => first.next(queue({ id: 'sug-1', data: { label: 'Ramen' } })))
    rerender({ id: OTHER_ID })
    act(() => first.next(queue({ id: 'sug-2', data: { label: 'Pizza' } })))

    expect(
      result.current.suggestions,
      'wheel A’s queue was written into wheel B’s state',
    ).toEqual([])
  })

  it('never shows the previous wheel’s queue under the new ID', () => {
    const { result, rerender } = renderHook(({ id }) => useSuggestions(id), {
      initialProps: { id: SHARE_ID },
    })

    act(() =>
      firestore.listeners[0].next(
        queue({ id: 'sug-1', data: { label: 'Ramen' } }),
      ),
    )
    rerender({ id: OTHER_ID })

    expect(result.current.suggestions).toEqual([])
    expect(result.current.status).toBe('loading')
  })
})
