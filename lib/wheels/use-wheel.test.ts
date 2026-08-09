// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The wheel listener's lifecycle, against a recorded `onSnapshot`.
 *
 * A companion to ./use-wheel.emulator.test.ts, which runs the same hook against
 * a real Firestore. The split is by what each can actually show: the emulator
 * proves the listener works, and this file proves it is torn down — a leaked
 * listener still delivers correct data, so no amount of asserting on wheels
 * would catch one.
 *
 * jsdom is declared per file rather than as a third Vitest project. The
 * projects are split by what a test needs from outside the install — Java, an
 * emulator — and jsdom is just a package, so `npm test` still runs this on a
 * bare `npm install`.
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
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
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

const { useWheel } = await import('./use-wheel')

/** A `DocumentSnapshot` by the two methods this hook actually calls. */
const found = (data: Record<string, unknown>) => ({
  exists: () => true,
  data: () => data,
})

const missing = () => ({ exists: () => false, data: () => undefined })

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
  it('opens exactly one listener, on the wheel document', () => {
    renderHook(() => useWheel(SHARE_ID))
    expect(only().path).toBe(`wheels/${SHARE_ID}`)
  })

  it('starts in loading, before any snapshot', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    expect(result.current.status).toBe('loading')
    expect(result.current.wheel).toBeNull()
    expect(result.current.seq).toBe(0)
  })

  it('delivers a decoded wheel on the first snapshot', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => {
      only().next(
        found({
          title: 'Lunch Friday',
          options: [{ id: 'o1', label: 'Tacos' }],
          suggestionsOpen: true,
        }),
      )
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.wheel?.title).toBe('Lunch Friday')
    expect(result.current.wheel?.shareId).toBe(SHARE_ID)
    expect(result.current.wheel?.options.map((o) => o.label)).toEqual(['Tacos'])
  })

  it('counts snapshots', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next(found({ title: 'Lunch' })))
    expect(result.current.seq).toBe(1)

    act(() => only().next(found({ title: 'Dinner' })))
    expect(result.current.seq).toBe(2)
  })

  it('does not count a listener error as a delivery', () => {
    // An error is not a snapshot, and the count is the one honest way for a
    // component to say "we have heard from the server at least once".
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next(found({ title: 'Lunch' })))
    act(() => only().fail({ code: 'unavailable' }))

    expect(result.current.seq).toBe(1)
  })

  it('restarts the count for a different wheel', () => {
    const { result, rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: SHARE_ID },
    })

    act(() => firestore.listeners[0].next(found({ title: 'Wheel A' })))
    expect(result.current.seq).toBe(1)

    rerender({ id: OTHER_ID })
    expect(result.current.seq).toBe(0)
  })

  /**
   * A malformed document must not throw out of the callback. Firestore does not
   * catch what a listener callback throws, so an exception here leaves the
   * listener in an undefined state and the page silently stops updating.
   */
  it('survives a document it cannot decode', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next({ exists: () => true, data: () => 'not an object' }))

    expect(result.current.status).toBe('ready')
    expect(result.current.wheel?.options).toEqual([])
  })
})

describe('a wheel that is not there', () => {
  /**
   * AC 7. This is the ordinary end of a wheel's life, not an exception:
   * design doc section 8 reaps an idle wheel after 30 days and the share link
   * in someone's chat history outlives it.
   */
  it('reports not-found when the document does not exist', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next(missing()))

    expect(result.current.status).toBe('not-found')
    expect(result.current.wheel).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('reports not-found when the wheel is deleted while being watched', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next(found({ title: 'Lunch' })))
    act(() => only().next(missing()))

    expect(result.current.status).toBe('not-found')
    expect(result.current.wheel).toBeNull()
  })

  it.each([
    { label: 'the empty string', shareId: '' },
    { label: 'a path separator', shareId: 'aBcDeFgHiJ/kLmNoPqRsT' },
    { label: 'a traversal', shareId: '../../wheelSecrets/xx' },
    { label: 'a truncated ID', shareId: SHARE_ID.slice(1) },
  ])(
    'reports not-found for $label without opening a listener',
    ({ shareId }) => {
      // `doc()` throws on a path with the wrong segment count, so this is a
      // crash avoided as well as a document read not paid for.
      const { result } = renderHook(() => useWheel(shareId))

      expect(result.current.status).toBe('not-found')
      expect(firestore.listeners).toHaveLength(0)
    },
  )
})

describe('errors', () => {
  it('reports a rules refusal as an error rather than as an empty wheel', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))
    const refused = {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    }

    act(() => only().fail(refused))

    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe(refused)
    expect(result.current.wheel).toBeNull()
  })

  it('drops the wheel it was holding, rather than showing stale data', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID))

    act(() => only().next(found({ title: 'Lunch' })))
    act(() => only().fail({ code: 'unavailable' }))

    expect(result.current.wheel).toBeNull()
  })
})

describe('teardown', () => {
  /** AC 2, the half an unsubscribe covers. */
  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useWheel(SHARE_ID))
    const listener = only()

    expect(listener.unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(listener.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the old wheel before opening the new one', () => {
    const { rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: SHARE_ID },
    })
    const first = firestore.listeners[0]

    rerender({ id: OTHER_ID })

    expect(first.unsubscribe).toHaveBeenCalledTimes(1)
    expect(firestore.listeners).toHaveLength(2)
    expect(firestore.listeners[1].path).toBe(`wheels/${OTHER_ID}`)
  })

  /**
   * The case the `live` flag exists for, and the only one that can distinguish
   * it from the shareId pairing: two listeners on the SAME wheel, the first
   * torn down. StrictMode's double-invoked effect produces exactly that, and so
   * would any future re-subscribe.
   *
   * Pairing cannot help here — both callbacks carry the right ID — so without
   * the flag a stale snapshot from the dead listener overwrites a newer one
   * from the live one, and the page shows data it has already moved past.
   */
  it('ignores a torn-down listener that shares its wheel with a live one', () => {
    const { result } = renderHook(() => useWheel(SHARE_ID), {
      wrapper: StrictMode,
    })

    expect(
      firestore.listeners,
      'StrictMode no longer double-invokes, so this case is untested',
    ).toHaveLength(2)
    const [torndown, current] = firestore.listeners
    expect(torndown.unsubscribe).toHaveBeenCalledTimes(1)

    act(() => current.next(found({ title: 'Current' })))
    act(() => torndown.next(found({ title: 'Stale' })))

    expect(result.current.wheel?.title).toBe('Current')
  })

  /**
   * AC 2, the half an unsubscribe does not cover on its own. `unsubscribe()`
   * stops future deliveries, but one already in flight still arrives — and a
   * snapshot of wheel A landing in the state after the component has moved to
   * wheel B is a listener leaking across a navigation whether or not anything
   * was left subscribed.
   */
  it('ignores a snapshot that arrives after its listener was torn down', () => {
    const { result, rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: SHARE_ID },
    })
    const first = firestore.listeners[0]

    act(() => first.next(found({ title: 'Wheel A' })))
    expect(result.current.wheel?.title).toBe('Wheel A')

    rerender({ id: OTHER_ID })
    act(() => first.next(found({ title: 'Wheel A, later' })))

    expect(
      result.current.wheel,
      'wheel A’s snapshot was written into wheel B’s state',
    ).toBeNull()
    expect(result.current.status).toBe('loading')
  })

  it('ignores an error that arrives after its listener was torn down', () => {
    const { result, rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: SHARE_ID },
    })
    const first = firestore.listeners[0]

    rerender({ id: OTHER_ID })
    act(() => first.fail({ code: 'unavailable' }))

    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeNull()
  })

  /**
   * The frame before the new listener has said anything. Without pairing the
   * held state with the ID it describes, this render would still be showing the
   * previous wheel — correct data under the wrong URL, which is worse than a
   * spinner.
   */
  it('never shows the previous wheel under the new ID', () => {
    const { result, rerender } = renderHook(({ id }) => useWheel(id), {
      initialProps: { id: SHARE_ID },
    })

    act(() => firestore.listeners[0].next(found({ title: 'Wheel A' })))
    rerender({ id: OTHER_ID })

    expect(result.current.status).toBe('loading')
    expect(result.current.wheel).toBeNull()
    expect(result.current.seq).toBe(0)
  })
})
