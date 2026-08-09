// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WheelOption } from '@/lib/wheels/model'

import { midAngle, normalizeDegrees, POINTER_ANGLE } from './geometry'
import {
  REDUCED_MOTION_SETTLE_MS,
  SPIN_DURATION_MS,
  SPIN_SETTLE_MS,
  useSpin,
} from './use-spin'

/**
 * Fake timers throughout: the whole point of this hook is a four-and-a-half
 * second gap between a click and an announcement, and a suite that waited it
 * out would take longer than the rest of `npm test` combined.
 */

function option(label: string): WheelOption {
  return { id: label, label, addedAt: null, fromSuggestion: null }
}

const OPTIONS = ['Taqueria', 'Noodle Bar', 'Green Bowl', 'Sunny Deli'].map(
  option,
)

/**
 * `matchMedia`, stubbed. jsdom ships one, but its `matches` is hard-wired false
 * and it never emits a change — so a reduced-motion test against the built-in
 * would pass whatever the hook did with the value.
 */
function stubReducedMotion(matches: boolean): {
  change: (to: boolean) => void
} {
  let current = matches
  const listeners = new Set<() => void>()

  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return current
    },
    addEventListener: (_event: string, handler: () => void) => {
      listeners.add(handler)
    },
    removeEventListener: (_event: string, handler: () => void) => {
      listeners.delete(handler)
    },
  }))

  return {
    change(to: boolean) {
      current = to
      for (const handler of listeners) handler()
    },
  }
}

/** Always picks the same wedge, so assertions can name the expected winner. */
function picks(index: number) {
  return () => index
}

beforeEach(() => {
  vi.useFakeTimers()
  stubReducedMotion(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('canSpin', () => {
  // AC 6, in both directions.
  it.each([
    { label: 'no options', count: 0, expected: false },
    { label: 'one option', count: 1, expected: false },
    { label: 'two options', count: 2, expected: true },
    { label: 'four options', count: 4, expected: true },
  ])('$label', ({ count, expected }) => {
    const { result } = renderHook(() => useSpin(OPTIONS.slice(0, count)))
    expect(result.current.canSpin).toBe(expected)
  })

  it('is false while a spin is running and true again once it settles', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    expect(result.current.canSpin).toBe(true)
    act(() => result.current.spin())
    expect(result.current.spinning).toBe(true)
    expect(result.current.canSpin).toBe(false)

    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    expect(result.current.spinning).toBe(false)
    expect(result.current.canSpin).toBe(true)
  })

  it('refuses to spin a wheel with fewer than two options', () => {
    const pick = vi.fn(() => 0)
    const { result } = renderHook(() => useSpin(OPTIONS.slice(0, 1), pick))

    act(() => result.current.spin())

    expect(pick).not.toHaveBeenCalled()
    expect(result.current.spinning).toBe(false)
    expect(result.current.rotation).toBe(0)
  })

  it('ignores a second spin while the first is still running', () => {
    const pick = vi.fn(() => 1)
    const { result } = renderHook(() => useSpin(OPTIONS, pick))

    act(() => result.current.spin())
    const rotation = result.current.rotation
    act(() => result.current.spin())

    expect(pick).toHaveBeenCalledTimes(1)
    expect(result.current.rotation).toBe(rotation)
  })
})

describe('the rotation', () => {
  it('lands the chosen wedge under the pointer', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(2)))

    act(() => result.current.spin())

    const underPointer = normalizeDegrees(
      midAngle(2, OPTIONS.length) + result.current.rotation,
    )
    expect(underPointer).toBeCloseTo(normalizeDegrees(POINTER_ANGLE), 9)
  })

  it('accumulates across spins rather than resetting', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(0)))

    act(() => result.current.spin())
    const first = result.current.rotation
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    act(() => result.current.spin())

    expect(result.current.rotation).toBeGreaterThan(first)
  })

  /**
   * The same wedge twice running. The offset is identical, so a target that did
   * not add its turns would equal the current rotation — no transition fires
   * and the button looks broken. `targetRotation` guarantees the turns; this
   * asserts the hook actually threads the current value through.
   */
  it('still travels a full spin when the same wedge wins twice', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(3)))

    act(() => result.current.spin())
    const first = result.current.rotation
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    act(() => result.current.spin())

    expect(result.current.rotation - first).toBeGreaterThan(360 * 5)
  })

  /**
   * A clamp alone does not cover this table, which is why it is a table. `NaN`
   * passes through `Math.trunc`, `Math.max` and `Math.min` untouched — every
   * comparison against it is false — so the arithmetic-only version announces
   * `{ index: NaN, option: undefined }` and hands a consumer a value the type
   * says cannot be there.
   *
   * The infinities are in the table to pin the OTHER half of that: they clamp
   * to the ends and must keep doing so. Fixing `NaN` with a `Number.isFinite`
   * gate sends them to the first option instead, which is a silently different
   * answer to a case that was already right.
   */
  it.each([
    { label: 'past the end', drawn: 99, expected: 3 },
    { label: 'negative', drawn: -4, expected: 0 },
    { label: 'fractional', drawn: 2.7, expected: 2 },
    { label: 'Infinity', drawn: Infinity, expected: 3 },
    { label: '-Infinity', drawn: -Infinity, expected: 0 },
    { label: 'NaN', drawn: NaN, expected: 0 },
  ])('coerces a pick that is $label', ({ drawn, expected }) => {
    const { result } = renderHook(() => useSpin(OPTIONS, () => drawn))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.result).toEqual({
      index: expected,
      option: OPTIONS[expected],
    })
    expect(result.current.result?.option).toBeDefined()
    expect(Number.isFinite(result.current.rotation)).toBe(true)
  })
})

describe('the result', () => {
  it('is not announced before the settle', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS - 1))

    expect(result.current.result).toBeNull()
    expect(result.current.spinning).toBe(true)
  })

  it('names the chosen option once the settle arrives', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.result).toEqual({ index: 1, option: OPTIONS[1] })
  })

  it('clears while a new spin is running', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    expect(result.current.result).not.toBeNull()

    act(() => result.current.spin())
    expect(result.current.result).toBeNull()
  })
})

/**
 * The Picked badge's state, which lives here because this is the only code that
 * knows a spin landed. Decision 15: local to the spinning browser, no field and
 * no endpoint, gone on refresh — so these are the whole of its behaviour.
 */
describe('the picked set', () => {
  it('is empty until a spin settles', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    expect(result.current.picked.size).toBe(0)

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS - 1))

    expect(result.current.picked.size, 'recorded with the result').toBe(0)
  })

  it('records the option the wheel landed on', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect([...result.current.picked]).toEqual([OPTIONS[1].id])
  })

  it('accumulates across spins and survives a dismissal', () => {
    const { result, rerender } = renderHook(
      ({ index }: { index: number }) => useSpin(OPTIONS, picks(index)),
      { initialProps: { index: 1 } },
    )

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    act(() => result.current.dismiss())

    expect([...result.current.picked]).toEqual([OPTIONS[1].id])

    rerender({ index: 3 })
    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect([...result.current.picked]).toEqual([OPTIONS[1].id, OPTIONS[3].id])
  })

  /**
   * Landing on the same option twice hands back the identical set, so the
   * panel — which renders a row per option against this — re-renders nothing.
   */
  it('does not change identity when the same option comes up again', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(2)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    const first = result.current.picked

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.picked).toBe(first)
  })

  /**
   * Read from the same snapshot and the same index as the result, so the badge
   * and the announcement cannot disagree. Decision 2 accepts that a spin may
   * land on an option deleted moments earlier; what it does not accept is the
   * wheel naming one option and the list badging another.
   */
  it('badges what was announced, even if that option has since gone', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(3)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    rerender({ options: OPTIONS.slice(0, 2) })
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.result?.option).toEqual(OPTIONS[3])
    expect([...result.current.picked]).toEqual([OPTIONS[3].id])
  })
})

describe('the frozen snapshot', () => {
  /**
   * AC 4. The wheel must not reflow when a concurrent editor's write lands
   * mid-rotation — decision 2, freeze the view and do not lock the data.
   */
  it('does not reflow when options change mid-spin', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(1)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_DURATION_MS / 2))

    rerender({ options: [...OPTIONS, option('Curry House')] })

    expect(result.current.options).toEqual(OPTIONS)
    expect(result.current.options).toHaveLength(4)
  })

  it('stays frozen while the result is on screen', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(1)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    rerender({ options: OPTIONS.slice(0, 2) })
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.spinning).toBe(false)
    expect(result.current.options).toEqual(OPTIONS)
  })

  /** AC 5. */
  it('re-renders from live state once the result is dismissed', () => {
    const grown = [...OPTIONS, option('Curry House')]
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(1)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    rerender({ options: grown })
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    expect(result.current.options).toEqual(OPTIONS)

    act(() => result.current.dismiss())

    expect(result.current.result).toBeNull()
    expect(result.current.options).toEqual(grown)
  })

  /**
   * "Spin again" without dismissing first, which the winner modal offers as a
   * button beside "Nice". A new spin re-freezes from LIVE, so it picks up
   * everything that landed while the last result was on screen — the second
   * spin must not run against the previous snapshot.
   *
   * `dismiss` documents itself as mandatory for whatever presents the result;
   * this is the one path that is safe without it, and it is only safe because
   * of this behaviour.
   */
  it('re-freezes from live when spun again without dismissing', () => {
    const grown = [...OPTIONS, option('Curry House')]
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(4)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    rerender({ options: grown })
    expect(result.current.options).toEqual(OPTIONS)

    // No dismiss: straight into another spin.
    act(() => result.current.spin())

    expect(result.current.options).toEqual(grown)
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    expect(result.current.result?.option).toEqual(grown[4])
  })

  it('follows live options when no spin has ever run', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(1)),
      { initialProps: { options: OPTIONS } },
    )

    rerender({ options: OPTIONS.slice(0, 2) })

    expect(result.current.options).toHaveLength(2)
  })

  it('refuses to thaw mid-spin', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(1)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    rerender({ options: OPTIONS.slice(0, 2) })
    act(() => result.current.dismiss())

    expect(result.current.spinning).toBe(true)
    expect(result.current.options).toEqual(OPTIONS)
  })

  /**
   * The bug the snapshot exists to prevent, stated directly.
   *
   * The prototype reads the winner out of live state at settle time, so
   * deleting the winning option mid-spin makes it announce a different option
   * — or, at the end of the array, nothing at all. Decision 2 says a result may
   * name an option deleted moments earlier and that this is acceptable; what is
   * not acceptable is naming the WRONG one.
   *
   * What this catches, precisely, because the obvious mutation does NOT fail
   * it: rewriting the settle to read `live[index]` passes, since inside that
   * callback `live` and `snapshot` are the same captured binding. The failure
   * mode is reading through a REF — `liveRef.current[index]`, which is what
   * someone reaches for when a linter complains about a stale closure — and
   * that mutation this test does fail. Recorded rather than left implied,
   * because a reader who assumes the strict-looking mutation is covered will
   * trust this test for more than it does.
   */
  it('announces the option it was aimed at even after that option is deleted', () => {
    const { result, rerender } = renderHook(
      ({ options }: { options: WheelOption[] }) => useSpin(options, picks(3)),
      { initialProps: { options: OPTIONS } },
    )

    act(() => result.current.spin())
    rerender({ options: OPTIONS.slice(0, 1) })
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.result?.option).toEqual(OPTIONS[3])
  })
})

describe('the transition', () => {
  it('is none at rest', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))
    expect(result.current.transition).toBe('none')
  })

  it('carries the prototype duration and easing while spinning', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())

    expect(result.current.transition).toBe(
      'transform 4300ms cubic-bezier(0.16, 0.85, 0.16, 1)',
    )
  })

  it('goes back to none once the wheel has landed', () => {
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))

    expect(result.current.transition).toBe('none')
  })
})

describe('prefers-reduced-motion', () => {
  /** AC 7: the rotation is suppressed, and a result still arrives. */
  it('suppresses the transition and still yields a result', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(2)))

    expect(result.current.reducedMotion).toBe(true)

    act(() => result.current.spin())
    expect(result.current.transition).toBe('none')
    expect(result.current.spinning).toBe(true)

    act(() => void vi.advanceTimersByTime(REDUCED_MOTION_SETTLE_MS))

    expect(result.current.result).toEqual({ index: 2, option: OPTIONS[2] })
    expect(result.current.spinning).toBe(false)
  })

  /**
   * The wheel still MOVES to the winning wedge, instantly. Leaving it where it
   * was would put the pointer on one option while the modal named another.
   */
  it('still lands the pointer on the winner', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(2)))

    act(() => result.current.spin())

    const underPointer = normalizeDegrees(
      midAngle(2, OPTIONS.length) + result.current.rotation,
    )
    expect(underPointer).toBeCloseTo(normalizeDegrees(POINTER_ANGLE), 9)
  })

  it('does not wait the full animation before announcing', () => {
    stubReducedMotion(true)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(0)))

    act(() => result.current.spin())
    act(() => void vi.advanceTimersByTime(REDUCED_MOTION_SETTLE_MS))

    expect(result.current.result).not.toBeNull()
    expect(REDUCED_MOTION_SETTLE_MS).toBeLessThan(SPIN_SETTLE_MS)
  })

  /**
   * The transition and the settle delay are both decided at spin start, and the
   * point of this test is that they agree.
   *
   * Reading the live preference for the transition while the timer keeps the
   * duration it was scheduled with is the mismatch: the wheel snaps to its
   * wedge the instant the setting flips, and then sits there for the remaining
   * four seconds with no result — the dead air `REDUCED_MOTION_SETTLE_MS`
   * exists to avoid, arrived at by trying to honour the preference promptly.
   */
  it('does not strand a spin that was already running when the setting flipped', () => {
    const media = stubReducedMotion(false)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    expect(result.current.transition).toContain('4300ms')

    act(() => media.change(true))

    // Still animating, because this spin started animating.
    expect(result.current.transition).toContain('4300ms')
    expect(result.current.spinning).toBe(true)

    act(() => void vi.advanceTimersByTime(SPIN_SETTLE_MS))
    expect(result.current.result?.option).toBe(OPTIONS[1])

    // The next spin honours it.
    act(() => result.current.spin())
    expect(result.current.transition).toBe('none')
    act(() => void vi.advanceTimersByTime(REDUCED_MOTION_SETTLE_MS))
    expect(result.current.result).not.toBeNull()
  })

  it('notices the setting changing mid-session', () => {
    const media = stubReducedMotion(false)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    expect(result.current.reducedMotion).toBe(false)
    act(() => media.change(true))
    expect(result.current.reducedMotion).toBe(true)
  })

  /**
   * A non-browser environment, or one old enough to lack the API. The hook must
   * degrade to full motion rather than throwing at import time and taking the
   * page with it.
   */
  it('assumes full motion when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useSpin(OPTIONS, picks(1)))

    expect(result.current.reducedMotion).toBe(false)
    act(() => result.current.spin())
    expect(result.current.transition).toContain('4300ms')
  })
})

describe('cleanup', () => {
  /**
   * The settle fires 4.4 seconds after a click, which is far longer than it
   * takes to close a wheel. Left running it sets state on an unmounted tree and,
   * under fake timers, leaks into whatever runs next.
   */
  it('cancels the pending settle on unmount', () => {
    const { result, unmount } = renderHook(() => useSpin(OPTIONS, picks(1)))

    act(() => result.current.spin())
    unmount()

    expect(() => vi.advanceTimersByTime(SPIN_SETTLE_MS * 2)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })
})
