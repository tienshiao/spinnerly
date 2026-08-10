import { describe, expect, it } from 'vitest'

import { targetRotation } from './geometry'
import { MAX_TICKS, spinEase, tickSchedule } from './tick-schedule'
import { SPIN_DURATION_MS } from './use-spin'

/**
 * The tick schedule.
 *
 * The whole claim being tested is that the clicks belong to the ANIMATION
 * rather than to a clock: a fixed-interval tick passes every case a reasonable
 * person writes about counts and ordering, and is wrong on the only thing that
 * matters, which is where in the four seconds each click falls.
 *
 * So the cases that carry weight here are the two that pin the schedule to the
 * curve — the last tick landing exactly half a wedge from the finish, and the
 * gaps growing by more than an order of magnitude across one spin.
 */

/** Five options, spun from rest onto index 2. A wheel this app really draws. */
const COUNT = 5
const TO = targetRotation(0, 2, COUNT)

function schedule(overrides: Partial<Parameters<typeof tickSchedule>[0]> = {}) {
  return tickSchedule({
    from: 0,
    to: TO,
    count: COUNT,
    durationMs: SPIN_DURATION_MS,
    ...overrides,
  })
}

describe('the easing', () => {
  it('runs from nothing to everything', () => {
    expect(spinEase(0)).toBe(0)
    expect(spinEase(1)).toBe(1)
  })

  it('never goes backwards', () => {
    let previous = -1
    for (let i = 0; i <= 100; i += 1) {
      const value = spinEase(i / 100)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  /**
   * The shape of the whole feature in one assertion: this spin is a coast, not
   * a constant sweep. A quarter of the way through the wheel has already
   * travelled 82% of its distance, which is why the clicks have to be derived
   * from the curve rather than spaced evenly.
   */
  it('is front-loaded — most of the travel happens early', () => {
    expect(spinEase(0.25)).toBeGreaterThan(0.8)
    expect(spinEase(0.5)).toBeGreaterThan(0.95)
  })
})

describe('the ticks', () => {
  it('gives one tick per wedge boundary that passes the pointer', () => {
    const { times } = schedule()

    // The finish puts a wedge's middle under the pointer, so the boundaries are
    // at half a wedge from the end and every wedge-width back from there.
    // `ceil` rather than `floor + 1`: a boundary that lands exactly on the
    // starting angle is already under the pointer and never crosses it.
    const segment = 360 / COUNT
    expect(times).toHaveLength(Math.ceil((TO - segment / 2) / segment))
  })

  it('is ordered, and lands inside the spin', () => {
    const { times } = schedule()

    for (const [index, time] of times.entries()) {
      expect(time).toBeGreaterThan(0)
      expect(time).toBeLessThan(SPIN_DURATION_MS)
      if (index > 0) expect(time).toBeGreaterThan(times[index - 1])
    }
  })

  /**
   * The inverse, checked against the forward easing rather than against a
   * number somebody wrote down: the last click is the wheel's last boundary,
   * which is exactly half a wedge from where it stops. If the bisection ever
   * drifts, this is where it shows.
   */
  it('puts the last tick half a wedge from the finish', () => {
    const { times } = schedule()
    const segment = 360 / COUNT

    const last = times[times.length - 1]
    expect(spinEase(last / SPIN_DURATION_MS)).toBeCloseTo(
      (TO - segment / 2) / TO,
      6,
    )
  })

  /**
   * AC 1. The wheel travels 96% of its distance in the first half of the spin,
   * so the clicks have to crowd into that half and then stretch right out —
   * a schedule whose first and last gaps are within an order of magnitude of
   * each other is a metronome wearing this function's name.
   */
  it('slows down: the last gap is many times the first', () => {
    const { gaps } = schedule()

    expect(gaps[gaps.length - 1]).toBeGreaterThan(gaps[0] * 10)
  })

  /**
   * And it slows down MONOTONICALLY, over everything but the first few
   * milliseconds. The exception is real rather than a tolerance: the easing's
   * two x control points are equal, so the curve leaves the origin almost
   * vertically and the very first clicks — 25ms apart, an audible flutter
   * rather than countable clicks — differ from one another by hundredths of a
   * millisecond in the wrong direction.
   */
  it('never speeds up once it is past the flutter', () => {
    const { gaps } = schedule()
    const tail = gaps.slice(4)

    for (const [index, gap] of tail.entries()) {
      if (index > 0) expect(gap).toBeGreaterThanOrEqual(tail[index - 1])
    }
  })

  it('measures the first gap from the start of the spin', () => {
    const { times, gaps } = schedule()

    expect(gaps[0]).toBe(times[0])
  })

  it('scales to the wheel: fewer options, fewer and wider ticks', () => {
    const few = tickSchedule({
      from: 0,
      to: targetRotation(0, 0, 2),
      count: 2,
      durationMs: SPIN_DURATION_MS,
    })
    const many = tickSchedule({
      from: 0,
      to: targetRotation(0, 0, 10),
      count: 10,
      durationMs: SPIN_DURATION_MS,
    })

    expect(few.times.length).toBeLessThan(many.times.length)
  })
})

describe('the schedules with nothing to say', () => {
  it.each([
    { label: 'a single option, which has no boundary', count: 1 },
    { label: 'an empty wheel', count: 0 },
  ])('is silent for $label', ({ count }) => {
    expect(
      tickSchedule({ from: 0, to: 2340, count, durationMs: SPIN_DURATION_MS })
        .times,
    ).toEqual([])
  })

  it.each([
    { label: 'a wheel that is not moving', to: 0 },
    { label: 'a target behind the wheel', to: -720 },
    { label: 'a target that is not a number', to: Number.NaN },
  ])('is silent for $label', ({ to }) => {
    expect(
      tickSchedule({ from: 0, to, count: COUNT, durationMs: SPIN_DURATION_MS })
        .times,
    ).toEqual([])
  })
})

/**
 * The cap is not about wheels anyone builds — six turns of a ten-option wheel is
 * 217 clicks. `count` arrives from a Firestore document, and this is what stands
 * between a wheel with an implausible number of options and a spin that tries to
 * hand the audio thread tens of thousands of sources in one frame.
 */
describe('the cap', () => {
  it('drops the flutter rather than the end', () => {
    const { times } = tickSchedule({
      from: 0,
      to: TO,
      count: 5000,
      durationMs: SPIN_DURATION_MS,
    })

    expect(times).toHaveLength(MAX_TICKS)

    // What survives is the tail: the last click is still the boundary half a
    // wedge from the finish, and the first is late in the spin rather than at
    // the very start.
    const segment = 360 / 5000
    expect(spinEase(times[times.length - 1] / SPIN_DURATION_MS)).toBeCloseTo(
      (TO - segment / 2) / TO,
      6,
    )
    expect(
      times[0],
      'the ticks kept must be the audible ones at the end',
    ).toBeGreaterThan(SPIN_DURATION_MS / 2)
  })
})
