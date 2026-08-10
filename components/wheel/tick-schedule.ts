/**
 * When the wheel clicks, as arithmetic. No React, no DOM, no audio.
 *
 * Same argument as ./geometry.ts for being its own file: this is the part where
 * the bugs are, none of it needs a browser, and it unit-tests under `npm test`
 * without jsdom. ./sounds.ts turns these numbers into noise and knows nothing
 * about easing; this knows nothing about the Web Audio API.
 *
 * **The tick is a boundary crossing the pointer, not a metronome.** A fixed
 * interval is the obvious implementation and it is wrong within the first
 * second: the spin coasts on a cubic-bezier that covers most of its travel
 * early, so evenly spaced clicks are already lagging the picture while the wheel
 * is still fast, and still clicking at the same rate when it has visibly
 * stopped. Deriving each tick from the angle it belongs to means the sound
 * cannot drift from the animation, because both are the same curve.
 */

/**
 * The spin easing's control points — `cubic-bezier(0.16, 0.85, 0.16, 1)`, which
 * is `SPIN_EASING` in ./use-spin.ts.
 *
 * Duplicated as numbers rather than parsed from that string, and the tests hold
 * both to the same values. Parsing a CSS function to get four floats back is
 * more code and more failure than writing them twice.
 */
const EASE_X1 = 0.16
const EASE_Y1 = 0.85
const EASE_X2 = 0.16
const EASE_Y2 = 1

/** A cubic Bézier's value at parameter `s`, for control points 0, a, b, 1. */
function bezier(s: number, a: number, b: number): number {
  const inverse = 1 - s
  return 3 * inverse * inverse * s * a + 3 * inverse * s * s * b + s * s * s
}

/**
 * How much of the spin is over at `progress` of its duration — the easing
 * function itself, for tests and for anyone reading the inverse below.
 *
 * A CSS timing function is a curve in the (time, distance) plane travelled by a
 * parameter that is NEITHER axis. So this is two evaluations: find the `s` whose
 * x is the time we were asked about, then read that `s`'s y.
 */
export function spinEase(progress: number): number {
  return bezier(parameterAtX(progress), EASE_Y1, EASE_Y2)
}

/**
 * The parameter `s` at which the curve's x reaches `x`.
 *
 * Bisection rather than Newton's method. Newton is faster and it is also the
 * one that fails here: x1 and x2 are both 0.16, so the curve leaves the origin
 * almost vertically and dx/ds is near zero over the first stretch — exactly
 * where a Newton step divides by it and throws the iterate somewhere else
 * entirely. Bisection cannot do that, and fifty halvings of [0, 1] is a
 * resolution of 1e-15 for arithmetic that runs a few dozen times per spin.
 */
function parameterAtX(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  let low = 0
  let high = 1

  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2
    if (bezier(mid, EASE_X1, EASE_X2) < x) low = mid
    else high = mid
  }

  return (low + high) / 2
}

/**
 * The time at which the spin has covered `fraction` of its travel: the easing,
 * read backwards.
 *
 * Monotonic, so the same bisection works — the only difference is which
 * coordinate is being hunted for.
 */
function timeAtDistance(fraction: number): number {
  if (fraction <= 0) return 0
  if (fraction >= 1) return 1

  let low = 0
  let high = 1

  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2
    if (bezier(mid, EASE_Y1, EASE_Y2) < fraction) low = mid
    else high = mid
  }

  const s = (low + high) / 2
  return bezier(s, EASE_X1, EASE_X2)
}

export type TickSchedule = {
  /** Milliseconds after the spin starts, ascending. */
  times: number[]
  /**
   * The gap before each tick, in milliseconds, and so how fast the wheel was
   * going when it clicked. `ticks[0]`'s gap is measured from the spin start.
   *
   * Carried alongside rather than left for the caller to difference, because
   * ./sounds.ts shapes each click from it — a wheel that is barely turning
   * should not click as brightly as one that is a blur.
   */
  gaps: number[]
}

export type TickScheduleInput = {
  /** Where the wheel is now, in degrees. */
  from: number
  /** Where it is going: `targetRotation`'s answer. */
  to: number
  /** How many wedges the wheel has. */
  count: number
  /** The transition's length, in milliseconds. */
  durationMs: number
}

/**
 * The largest number of clicks a single spin will schedule.
 *
 * Six turns of a ten-option wheel is 217 ticks, which is the realistic ceiling;
 * this sits above it and exists for the case that is not realistic. `count`
 * arrives from a wheel document, and the cap is what stands between a wheel with
 * an implausible number of options and a spin that tries to schedule tens of
 * thousands of audio sources in one frame. Ticks are dropped from the START of
 * the spin, where they are so dense as to be a texture rather than clicks —
 * losing the end would be losing the part anyone can count.
 */
export const MAX_TICKS = 400

/**
 * Every wedge boundary that will pass the pointer during this spin, as times.
 *
 * The wheel finishes with a wedge's MIDDLE under the pointer — that is what
 * `targetRotation` is for — so the boundaries are half a wedge either side of
 * the finish and then every wedge-width back from there. Walking backwards from
 * the end rather than forwards from the start is deliberate: the spin's end is
 * the angle we know exactly, and it puts the rounding, if any, at the fast end
 * where nobody can hear it.
 */
export function tickSchedule({
  from,
  to,
  count,
  durationMs,
}: TickScheduleInput): TickSchedule {
  const travel = to - from
  const segment = 360 / Math.max(count, 1)

  // A wheel that is not moving has nothing to click, and a single-option wheel
  // has no boundary to cross. Both are reachable: `canSpin` needs two options,
  // but this function is also called by tests and by the kitchen sink.
  if (!(travel > 0) || !(segment > 0) || count < 2) {
    return { times: [], gaps: [] }
  }

  const rotations: number[] = []
  for (
    let rotation = to - segment / 2;
    rotation > from && rotations.length < MAX_TICKS;
    rotation -= segment
  ) {
    rotations.push(rotation)
  }

  // Built backwards, so reverse before differencing. `reverse` mutates, which is
  // what is wanted on an array that has not left this function.
  rotations.reverse()

  const times = rotations.map(
    (rotation) => durationMs * timeAtDistance((rotation - from) / travel),
  )

  const gaps = times.map((time, index) =>
    index === 0 ? time : time - times[index - 1],
  )

  return { times, gaps }
}
