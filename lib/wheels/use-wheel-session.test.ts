// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from './api-client'
import { SLOW_AFTER_MS } from './optimistic'
import type { WheelApi } from './api-client'

/**
 * The composed session: two listeners, the write client and the reconciliation
 * wired together.
 *
 * ./optimistic.test.ts already covers the reconciliation itself, exhaustively
 * and without React. What is left to prove here is that the wiring delivers it
 * — that an optimistic row really does appear on the click and really is
 * replaced rather than duplicated (AC 4), that a failure rolls back AND reaches
 * the caller (AC 5), and that the pending affordance appears on a timer nobody
 * else has to own (AC 6).
 *
 * Firestore is recorded rather than mocked in spirit: the listeners are driven
 * by hand so a snapshot can be made to arrive before, after, or instead of the
 * HTTP response it races.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const OTHER_ID = 'zYxWvUtSrQpOnMlKjIhG'
const SUGGESTION_ID = 'sUgGeStIoNiDaBcDeFgH'
const TOKEN = 'edit-token-value'

/**
 * Versions, as the routes now report them. `OURS` is what a write says it
 * stored; `BEFORE` is a document that predates it and `AFTER` one that a later
 * write produced.
 */
const BEFORE = new Date('2026-08-01T10:00:00.000Z')
const OURS = new Date('2026-08-01T10:00:01.000Z')
const AFTER = new Date('2026-08-01T10:00:02.000Z')

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

vi.mock('firebase/firestore', () => {
  const reference = (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })
  return {
    doc: reference,
    collection: reference,
    onSnapshot: (
      ref: { path: string },
      next: (snapshot: unknown) => void,
      fail: (error: unknown) => void,
    ) => {
      const unsubscribe = vi.fn()
      firestore.listeners.push({ path: ref.path, next, fail, unsubscribe })
      return unsubscribe
    },
  }
})

const { useWheelSession } = await import('./use-wheel-session')

/** The listener for a path, so a test never depends on subscription order. */
function listener(suffix: string): Recorded {
  const found = firestore.listeners.filter((entry) =>
    entry.path.endsWith(suffix),
  )
  expect(found, `no listener on ${suffix}`).toHaveLength(1)
  return found[0]
}

const wheelListener = () => listener(SHARE_ID)
const queueListener = () => listener('suggestions')

const wheelSnapshot = (data: Record<string, unknown>) => ({
  exists: () => true,
  data: () => ({
    title: 'Lunch Friday',
    suggestionsOpen: true,
    // Every snapshot carries a version, because every real one does. A fixture
    // without one would leave `versionCaughtUp` false and quietly test only the
    // identity half of each rule.
    updatedAt: BEFORE,
    ...data,
  }),
})

const queueSnapshot = (
  ...docs: { id: string; data: Record<string, unknown> }[]
) => ({
  docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })),
})

/** A promise a test resolves or rejects when it chooses. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  // Attached so an intentionally-rejected deferred does not trip the runner's
  // unhandled-rejection guard before the hook's own catch runs.
  promise.catch(() => {})
  return { promise, resolve, reject }
}

/** A `WheelApi` whose every method is a spy returning a controllable promise. */
function fakeApi(): { api: WheelApi; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {}
  const method =
    (name: string) =>
    (...args: unknown[]) => {
      ;(calls[name] ??= []).push(args)
      return Promise.resolve({ updatedAt: OURS })
    }

  const api = {
    createWheel: method('createWheel'),
    duplicateWheel: method('duplicateWheel'),
    updateWheel: method('updateWheel'),
    addOption: method('addOption'),
    removeOption: method('removeOption'),
    submitSuggestion: method('submitSuggestion'),
    acceptSuggestion: method('acceptSuggestion'),
    rejectSuggestion: method('rejectSuggestion'),
  } as unknown as WheelApi

  return { api, calls }
}

/**
 * `editToken` has no default on purpose. A default parameter would be applied
 * when a test passed `undefined` explicitly, which is the exact case the
 * participant tests below are trying to set up — every one of them would have
 * run as an editor and passed for the wrong reason.
 */
function session(api: WheelApi, editToken?: string) {
  return renderHook(
    ({ shareId }: { shareId: string }) =>
      useWheelSession({ shareId, editToken, api }),
    { initialProps: { shareId: SHARE_ID } },
  )
}

beforeEach(() => {
  firestore.listeners.length = 0
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('role and status', () => {
  it('is an editor when a token is held and a participant otherwise', () => {
    const { api } = fakeApi()

    expect(session(api, TOKEN).result.current.role).toBe('editor')
    cleanup()
    firestore.listeners.length = 0
    expect(session(api, undefined).result.current.role).toBe('participant')
  })

  it('treats an empty token as no token, not as a token', () => {
    const { api } = fakeApi()
    expect(session(api, '').result.current.role).toBe('participant')
  })

  it('surfaces a not-found wheel rather than hanging', () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)

    act(() =>
      wheelListener().next({ exists: () => false, data: () => undefined }),
    )

    expect(result.current.status).toBe('not-found')
    expect(result.current.view.wheel).toBeNull()
  })

  it('surfaces a listener error from either listener', () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    const refused = { code: 'permission-denied' }

    act(() => queueListener().fail(refused))

    expect(result.current.error).toBe(refused)
  })
})

describe('adding an option', () => {
  /**
   * AC 4, end to end and in the order that matters. The row must be on screen
   * from the click, must still be there in the window between the 201 and the
   * snapshot — which is where retiring on the response goes wrong — and must
   * not be drawn alongside the real one afterwards.
   */
  it('shows one row at every step from click to snapshot', async () => {
    const { api } = fakeApi()
    const answer = deferred<{
      option: { id: string; label: string }
      updatedAt: Date
    }>()
    vi.spyOn(api, 'addOption').mockReturnValue(
      answer.promise as ReturnType<WheelApi['addOption']>,
    )

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    const labels = () =>
      result.current.view.wheel?.options.map((row) => row.label) ?? []

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addOption('Tacos')
    })
    expect(labels(), 'the row did not appear on the click').toEqual(['Tacos'])
    expect(result.current.view.wheel?.options[0].optimistic).toBe(true)

    await act(async () => {
      answer.resolve({
        option: { id: 'server-1', label: 'Tacos' },
        updatedAt: OURS,
      })
      await pending
    })
    expect(
      labels(),
      'the row vanished between the 201 and the snapshot',
    ).toEqual(['Tacos'])

    act(() =>
      wheelListener().next(
        wheelSnapshot({ options: [{ id: 'server-1', label: 'Tacos' }] }),
      ),
    )
    expect(
      labels(),
      'the optimistic row was drawn next to the real one',
    ).toEqual(['Tacos'])
    expect(result.current.view.wheel?.options[0].optimistic).toBe(false)
    expect(result.current.view.wheel?.options[0].id).toBe('server-1')
    expect(result.current.view.pendingCount).toBe(0)
  })

  /**
   * The race the reconcile effect exists for: a snapshot can beat its own HTTP
   * response. Without a reconcile triggered by the settlement as well as by the
   * snapshot, this entry would wait for a change nobody is going to make and
   * the duplicate row would stay on screen.
   */
  it('retires the row when the snapshot beats the response', async () => {
    const { api } = fakeApi()
    const answer = deferred<{
      option: { id: string; label: string }
      updatedAt: Date
    }>()
    vi.spyOn(api, 'addOption').mockReturnValue(
      answer.promise as ReturnType<WheelApi['addOption']>,
    )

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addOption('Tacos')
    })

    act(() =>
      wheelListener().next(
        wheelSnapshot({ options: [{ id: 'server-1', label: 'Tacos' }] }),
      ),
    )
    expect(
      result.current.view.wheel?.options.map((row) => row.label),
      'the snapshot arrived first, so both rows are on screen for now',
    ).toEqual(['Tacos', 'Tacos'])

    await act(async () => {
      answer.resolve({
        option: { id: 'server-1', label: 'Tacos' },
        updatedAt: OURS,
      })
      await pending
    })

    expect(
      result.current.view.wheel?.options.map((row) => row.label),
      'the entry never retired against a snapshot that had already arrived',
    ).toEqual(['Tacos'])
  })

  /**
   * The reconcile effect's actual job. `project` filters landed entries out on
   * its own, so what renders is right whether or not the sweep has run — which
   * makes the sweep invisible from the view, and means the only observable of a
   * list that never empties is a timer still scheduled against an entry that is
   * over and done with.
   *
   * Without `entries` in that effect's dependency list this is precisely the
   * case that leaks: the snapshot arrives before the response, so the entry
   * settles at a moment when no further `live` change is coming.
   */
  it('sweeps a settled entry away rather than keeping it forever', async () => {
    vi.useFakeTimers()
    const { api } = fakeApi()
    const answer = deferred<{
      option: { id: string; label: string }
      updatedAt: Date
    }>()
    vi.spyOn(api, 'addOption').mockReturnValue(
      answer.promise as ReturnType<WheelApi['addOption']>,
    )

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    let pending!: Promise<void>
    act(() => {
      pending = result.current.addOption('Tacos')
    })
    expect(vi.getTimerCount(), 'the slow deadline should be scheduled').toBe(1)

    act(() =>
      wheelListener().next(
        wheelSnapshot({ options: [{ id: 'server-1', label: 'Tacos' }] }),
      ),
    )
    await act(async () => {
      answer.resolve({
        option: { id: 'server-1', label: 'Tacos' },
        updatedAt: OURS,
      })
      await pending
    })

    expect(
      vi.getTimerCount(),
      'a timer is still armed for an entry that has landed, so the list never emptied',
    ).toBe(0)
  })

  /** AC 5. Both halves: the row goes back, and the caller is told. */
  it('rolls back and rejects when the write fails', async () => {
    const { api } = fakeApi()
    const refusal = new ApiError(409, 'options_full', 'That wheel is full.')
    vi.spyOn(api, 'addOption').mockRejectedValue(refusal)

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    let caught: unknown
    await act(async () => {
      caught = await result.current.addOption('Tacos').catch((error) => error)
    })

    expect(caught).toBe(refusal)
    expect(result.current.view.wheel?.options).toEqual([])
    expect(result.current.view.pendingCount).toBe(0)
  })
})

/**
 * The version, wired end to end. ./optimistic.test.ts covers the rules; what is
 * left to show here is that the value really does travel from the response into
 * the settlement and get compared against what the listener delivers.
 */
describe('the version a write returns', () => {
  /**
   * The bug the version replaced a delivery counter to fix. A snapshot arriving
   * after our response can still be a document generated BEFORE our commit —
   * another write landing in the window just ahead of ours. A counter could not
   * tell the two apart and retired here, and the title reverted for a frame.
   */
  it('holds the new title against a delivery that predates the write', async () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ title: 'Lunch' })))

    await act(async () => {
      await result.current.setTitle('Dinner')
    })
    expect(result.current.view.wheel?.title).toBe('Dinner')

    act(() =>
      wheelListener().next(
        wheelSnapshot({ title: 'Someone else’s', updatedAt: BEFORE }),
      ),
    )
    expect(
      result.current.view.wheel?.title,
      'retired against a snapshot generated before our own commit',
    ).toBe('Dinner')
    expect(result.current.view.saving.title).toBe(true)

    act(() =>
      wheelListener().next(wheelSnapshot({ title: 'Dinner', updatedAt: OURS })),
    )
    expect(result.current.view.wheel?.title).toBe('Dinner')
    expect(result.current.view.saving.title).toBe(false)
  })

  it('yields to a concurrent editor who wrote after us', async () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ title: 'Lunch' })))

    await act(async () => {
      await result.current.setTitle('Dinner')
    })

    // The value we asked for never appears — theirs was written last — so only
    // the version can say the server has moved past us.
    act(() =>
      wheelListener().next(
        wheelSnapshot({ title: 'Brunch', updatedAt: AFTER }),
      ),
    )
    expect(result.current.view.wheel?.title).toBe('Brunch')
  })

  /**
   * The stranded row. A suggestion submitted and rejected inside one round trip
   * may never appear in any snapshot this client receives, and before the
   * routes returned a version there was no way to tell that from "not delivered
   * yet" — the row, its count and its affordance stayed for the life of the
   * page.
   */
  it('clears a suggestion created and deleted before the queue saw it', async () => {
    const { api } = fakeApi()
    vi.spyOn(api, 'submitSuggestion').mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, label: 'Ramen', status: 'pending' },
      updatedAt: OURS,
    })

    const { result } = session(api, undefined)
    act(() => wheelListener().next(wheelSnapshot({})))
    act(() => queueListener().next(queueSnapshot()))

    await act(async () => {
      await result.current.submitSuggestion('Ramen')
    })
    expect(result.current.view.suggestions.map((row) => row.label)).toEqual([
      'Ramen',
    ])

    act(() => wheelListener().next(wheelSnapshot({ updatedAt: AFTER })))
    expect(
      result.current.view.suggestions.map((row) => row.label),
      'the wheel moved but the queue had not spoken — the row must not vanish yet',
    ).toEqual(['Ramen'])

    act(() => queueListener().next(queueSnapshot()))

    expect(result.current.view.suggestions).toEqual([])
    expect(result.current.view.pendingCount).toBe(0)
  })
})

describe('the other mutations', () => {
  it('removes an option optimistically and restores it on failure', async () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() =>
      wheelListener().next(
        wheelSnapshot({ options: [{ id: 'o1', label: 'Tacos' }] }),
      ),
    )

    const failure = new ApiError(0, 'network_error', 'no')
    vi.spyOn(api, 'removeOption').mockRejectedValue(failure)

    let pending!: Promise<unknown>
    act(() => {
      pending = result.current.removeOption('o1').catch((error) => error)
    })
    expect(result.current.view.wheel?.options).toEqual([])

    await act(async () => {
      expect(await pending).toBe(failure)
    })
    expect(result.current.view.wheel?.options.map((row) => row.label)).toEqual([
      'Tacos',
    ])
  })

  it('shows a new title before the server confirms it', () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ title: 'Lunch Friday' })))

    act(() => {
      void result.current.setTitle('Dinner')
    })

    expect(result.current.view.wheel?.title).toBe('Dinner')
    expect(result.current.view.saving.title).toBe(true)
  })

  it('accepts a suggestion into the options and the queue at once', () => {
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))
    act(() =>
      queueListener().next(
        queueSnapshot({
          id: SUGGESTION_ID,
          data: { label: 'Ramen', status: 'pending' },
        }),
      ),
    )

    act(() => {
      void result.current.acceptSuggestion(SUGGESTION_ID, 'Ramen')
    })

    expect(result.current.view.wheel?.options.map((row) => row.label)).toEqual([
      'Ramen',
    ])
    expect(result.current.view.suggestions[0].status).toBe('accepted')
  })

  it('submits a suggestion without a token', async () => {
    const { api } = fakeApi()
    const submit = vi.spyOn(api, 'submitSuggestion').mockResolvedValue({
      suggestion: { id: SUGGESTION_ID, label: 'Ramen', status: 'pending' },
      updatedAt: OURS,
    })

    const { result } = session(api, undefined)
    await act(async () => {
      await result.current.submitSuggestion('Ramen')
    })

    expect(result.current.view.suggestions.map((row) => row.label)).toEqual([
      'Ramen',
    ])
    // Asserted on the spy rather than on `calls`, which `vi.spyOn` has replaced
    // and which therefore cannot be populated whatever the hook does. The point
    // of this case is the ARGUMENTS: `submitSuggestion` is `auth: none`, so it
    // takes no token and there is no third argument for one to arrive in.
    expect(submit).toHaveBeenCalledWith(SHARE_ID, { label: 'Ramen' })
  })

  it('forks without touching this wheel’s pending state', async () => {
    const { api } = fakeApi()
    vi.spyOn(api, 'duplicateWheel').mockResolvedValue({
      shareId: OTHER_ID,
      editToken: 'fork-token',
    })

    const { result } = session(api, undefined)
    let fork: unknown
    await act(async () => {
      fork = await result.current.duplicate()
    })

    expect(fork).toEqual({ shareId: OTHER_ID, editToken: 'fork-token' })
    expect(result.current.view.pendingCount).toBe(0)
  })
})

describe('without an edit token', () => {
  /**
   * A participant view should not render these controls at all, so reaching
   * here is a bug — but a silent no-op is a button that does nothing, and
   * sending the request is a 401 the user cannot act on.
   */
  it.each([
    {
      label: 'addOption',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.addOption('Tacos'),
    },
    {
      label: 'removeOption',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.removeOption('o1'),
    },
    {
      label: 'setTitle',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.setTitle('Dinner'),
    },
    {
      label: 'setSuggestionsOpen',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.setSuggestionsOpen(false),
    },
    {
      label: 'acceptSuggestion',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.acceptSuggestion(SUGGESTION_ID, 'Ramen'),
    },
    {
      label: 'rejectSuggestion',
      run: (s: ReturnType<typeof session>['result']['current']) =>
        s.rejectSuggestion(SUGGESTION_ID),
    },
  ])('$label rejects with missing_token and sends nothing', async ({ run }) => {
    const { api, calls } = fakeApi()
    const { result } = session(api, undefined)

    const error = await run(result.current).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('missing_token')
    expect(calls, 'a request went out without a token').toEqual({})
    expect(
      result.current.view.pendingCount,
      'an optimistic row was left behind for a request never sent',
    ).toBe(0)
  })
})

describe('the pending affordance', () => {
  /**
   * AC 6. The threshold is crossed by a timer this hook owns, so no component
   * has to poll — and `project` stays pure, which is what
   * `react-hooks/purity` requires of anything called during a render.
   */
  it('flips to slow once the write passes the threshold', () => {
    vi.useFakeTimers()
    const { api } = fakeApi()
    vi.spyOn(api, 'addOption').mockReturnValue(
      new Promise(() => {}) as ReturnType<WheelApi['addOption']>,
    )

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))
    act(() => {
      void result.current.addOption('Tacos')
    })

    expect(result.current.view.slow).toBe(false)
    expect(result.current.view.wheel?.options[0].slow).toBe(false)

    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS - 1))
    expect(result.current.view.slow, 'flipped early').toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.view.slow).toBe(true)
    expect(result.current.view.wheel?.options[0].slow).toBe(true)
  })

  it('walks through several writes in the order they were started', () => {
    vi.useFakeTimers()
    const { api } = fakeApi()
    vi.spyOn(api, 'addOption').mockReturnValue(
      new Promise(() => {}) as ReturnType<WheelApi['addOption']>,
    )

    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    act(() => {
      void result.current.addOption('Tacos')
    })
    act(() => vi.advanceTimersByTime(300))
    act(() => {
      void result.current.addOption('Pizza')
    })

    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS - 300))
    expect(
      result.current.view.wheel?.options.map((row) => row.slow),
      'the first write should be slow and the second should not',
    ).toEqual([true, false])

    act(() => vi.advanceTimersByTime(300))
    expect(result.current.view.wheel?.options.map((row) => row.slow)).toEqual([
      true,
      true,
    ])
  })

  it('runs no timer when nothing is outstanding', () => {
    vi.useFakeTimers()
    const { api } = fakeApi()
    const { result } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))

    // An idle wheel must stay idle: a polling implementation would keep the tab
    // waking for as long as it was open.
    expect(vi.getTimerCount()).toBe(0)
    expect(result.current.view.slow).toBe(false)
  })
})

describe('changing wheels', () => {
  it('discards pending mutations, which belong to the wheel that left', () => {
    const { api } = fakeApi()
    vi.spyOn(api, 'addOption').mockReturnValue(
      new Promise(() => {}) as ReturnType<WheelApi['addOption']>,
    )

    const { result, rerender } = session(api, TOKEN)
    act(() => wheelListener().next(wheelSnapshot({ options: [] })))
    act(() => {
      void result.current.addOption('Tacos')
    })
    expect(result.current.view.pendingCount).toBe(1)

    rerender({ shareId: OTHER_ID })

    expect(result.current.view.pendingCount).toBe(0)
    expect(result.current.view.wheel).toBeNull()
    expect(result.current.status).toBe('loading')
  })
})
