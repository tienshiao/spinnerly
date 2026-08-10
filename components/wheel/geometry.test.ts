import { describe, expect, it } from 'vitest'

import { OPTIONS_MAX } from '@/lib/wheels/validation'

import {
  BACKDROP_RADIUS,
  CENTER,
  HUB_RADIUS,
  HUB_STROKE,
  LABEL_MAX,
  LABEL_RADIUS_RATIO,
  LABEL_TRUNCATE,
  POINTER_ANGLE,
  RADIUS,
  VIEWBOX,
  labelPlacement,
  midAngle,
  normalizeDegrees,
  segmentAngle,
  targetRotation,
  truncateLabel,
  wedgePath,
} from './geometry'

/**
 * No jsdom. Every function under test is arithmetic on numbers and strings, and
 * the angle work is where the bugs are — so it is checked in the environment
 * that runs on a bare `npm install`.
 */

/** Every option count a wheel can actually have. Two is the spin minimum. */
const COUNTS = Array.from({ length: OPTIONS_MAX - 1 }, (_, i) => i + 2)

/** Every (count, index) pair, for the sweeps that must hold across all of them. */
const EVERY_WEDGE = COUNTS.flatMap((count) =>
  Array.from({ length: count }, (_, index) => ({ count, index })),
)

/** Degrees into `(-180, 180]`, so "how far from upright" is a magnitude. */
function signedDegrees(degrees: number): number {
  return normalizeDegrees(degrees + 180) - 180
}

describe('constants', () => {
  /**
   * AC 1. These are the prototype's numbers, and the reason to assert them is
   * that nothing else can: they are read by ./wheel.tsx and by TASK-23's image
   * generator, and a change to one of them is invisible in both until somebody
   * compares a screenshot against a design file.
   */
  it('match the prototype geometry', () => {
    expect(VIEWBOX).toBe(400)
    expect(CENTER).toBe(200)
    expect(RADIUS).toBe(190)
    expect(BACKDROP_RADIUS).toBe(198)
    expect(HUB_RADIUS).toBe(34)
    expect(HUB_STROKE).toBe(5)
    expect(LABEL_RADIUS_RATIO).toBe(0.62)
    expect(POINTER_ANGLE).toBe(-90)
  })

  it('put the centre in the middle of the viewBox', () => {
    expect(CENTER * 2).toBe(VIEWBOX)
  })

  it('keep the backdrop proud of the wedges and the hub inside them', () => {
    expect(BACKDROP_RADIUS).toBeGreaterThan(RADIUS)
    // Otherwise the backdrop is clipped by the viewBox and the rim goes flat on
    // four sides.
    expect(BACKDROP_RADIUS).toBeLessThanOrEqual(CENTER)
    expect(HUB_RADIUS).toBeLessThan(RADIUS * LABEL_RADIUS_RATIO)
  })
})

describe('segmentAngle', () => {
  it.each([
    { label: 'one option is the whole disc', count: 1, expected: 360 },
    { label: 'two options halve it', count: 2, expected: 180 },
    { label: 'four options quarter it', count: 4, expected: 90 },
    { label: 'ten options', count: 10, expected: 36 },
  ])('$label', ({ count, expected }) => {
    expect(segmentAngle(count)).toBe(expected)
  })

  /**
   * The empty wheel. Without the `Math.max(count, 1)` guard this is `Infinity`,
   * every coordinate downstream is `NaN`, and SVG draws a `NaN` path as nothing
   * at all — a blank disc with no error in the console.
   */
  it('does not divide by zero on an empty wheel', () => {
    expect(segmentAngle(0)).toBe(360)
    expect(Number.isFinite(segmentAngle(0))).toBe(true)
  })

  it('tiles the circle exactly', () => {
    for (const count of COUNTS) {
      expect(segmentAngle(count) * count).toBeCloseTo(360, 10)
    }
  })
})

describe('wedgePath', () => {
  /**
   * AC 1, as exact strings. Captured from this implementation and checked
   * against the prototype's arithmetic by hand — the point is that a change to
   * the path formula has to be deliberate enough to update a literal.
   */
  it.each([
    {
      label: 'a single option is a full circle, drawn as two half-turn arcs',
      index: 0,
      count: 1,
      expected: 'M 200 10 A 190 190 0 1 1 200 390 A 190 190 0 1 1 200 10 Z',
    },
    {
      label: 'the first of two starts at the top and sweeps to the bottom',
      index: 0,
      count: 2,
      expected: 'M 200 200 L 200.00 10.00 A 190 190 0 0 1 200.00 390.00 Z',
    },
    {
      label: 'the second of two closes the circle',
      index: 1,
      count: 2,
      expected: 'M 200 200 L 200.00 390.00 A 190 190 0 0 1 200.00 10.00 Z',
    },
    {
      label: 'the first of four ends due east',
      index: 0,
      count: 4,
      expected: 'M 200 200 L 200.00 10.00 A 190 190 0 0 1 390.00 200.00 Z',
    },
    {
      label: 'the fourth of six',
      index: 3,
      count: 6,
      expected: 'M 200 200 L 200.00 390.00 A 190 190 0 0 1 35.46 295.00 Z',
    },
  ])('$label', ({ index, count, expected }) => {
    expect(wedgePath(index, count)).toBe(expected)
  })

  /**
   * The bug this file was written against, found by looking at the thing in a
   * browser rather than by any assertion here.
   *
   * A single option makes the arc's start and end points coincide, and SVG
   * defines that as omitting the arc entirely — so the natural
   * centre-out-around-back path collapses to a line and the wheel renders as a
   * blank white disc with an invisible white label on it. The large-arc flag
   * does not help, which is what makes it easy to write and believe.
   *
   * The assertion is on the arc having DISTINCT endpoints, which is the actual
   * requirement; asserting the exact string alone would have passed just as
   * happily for the broken version.
   */
  it('draws a single option as a circle with distinct arc endpoints', () => {
    const d = wedgePath(0, 1)
    const points = [...d.matchAll(/A 190 190 0 1 1 ([\d.]+) ([\d.]+)/g)].map(
      (match) => `${match[1]},${match[2]}`,
    )

    expect(points).toHaveLength(2)
    expect(points[0]).not.toBe(points[1])
    expect(new Set(points).size).toBe(2)
  })

  /**
   * And every wheel of two or more leaves the flag clear: two options give a
   * segment of exactly 180, a half-turn either way round, and larger counts are
   * smaller still.
   */
  it('never sets the large-arc flag on a wheel of two or more', () => {
    for (const count of COUNTS) {
      expect(wedgePath(0, count), `count ${count}`).toContain('A 190 190 0 0 1')
      expect(wedgePath(0, count), `count ${count}`).not.toContain('0 1 1')
    }
  })

  it('starts every wedge at the centre and closes it', () => {
    for (const { index, count } of EVERY_WEDGE) {
      const d = wedgePath(index, count)
      expect(d.startsWith(`M ${CENTER} ${CENTER} `), `${count}/${index}`).toBe(
        true,
      )
      expect(d.endsWith(' Z'), `${count}/${index}`).toBe(true)
      expect(d, `${count}/${index}`).not.toContain('NaN')
    }
  })

  /**
   * The first wedge's leading edge is straight up whatever the count, which is
   * what makes a rotation of zero the rest position and lets `targetRotation`
   * measure its offset from the top.
   */
  it('puts the first wedge’s leading edge at twelve o’clock', () => {
    for (const count of COUNTS) {
      expect(wedgePath(0, count), `count ${count}`).toContain(
        `L ${CENTER.toFixed(2)} ${(CENTER - RADIUS).toFixed(2)}`,
      )
    }
  })

  /** Each wedge picks up exactly where the last one left off — no seams. */
  it('starts each wedge where the previous one ended', () => {
    for (const count of COUNTS) {
      for (let index = 1; index < count; index++) {
        const previousEnd = wedgePath(index - 1, count).match(
          /A 190 190 0 [01] 1 ([\d.-]+) ([\d.-]+) Z$/,
        )
        const thisStart = wedgePath(index, count).match(/L ([\d.-]+) ([\d.-]+)/)
        expect(previousEnd, `count ${count} index ${index}`).not.toBeNull()
        expect([thisStart?.[1], thisStart?.[2]]).toEqual([
          previousEnd?.[1],
          previousEnd?.[2],
        ])
      }
    }
  })
})

describe('labelPlacement', () => {
  it.each([
    {
      label: 'top-right wedge is not flipped',
      index: 0,
      count: 4,
      expected: {
        x: 317.8,
        y: 200,
        transform: 'rotate(-45 200 200)',
        flipped: false,
      },
    },
    {
      label: 'bottom-left wedge is flipped about its own position',
      index: 2,
      count: 4,
      expected: {
        x: 317.8,
        y: 200,
        transform: 'rotate(135 200 200) rotate(180 317.8 200)',
        flipped: true,
      },
    },
  ])('$label', ({ index, count, expected }) => {
    expect(labelPlacement(index, count)).toEqual(expected)
  })

  it('lays every label out at the same point before rotating it', () => {
    for (const { index, count } of EVERY_WEDGE) {
      const placement = labelPlacement(index, count)
      expect(placement.x, `${count}/${index}`).toBeCloseTo(
        CENTER + RADIUS * LABEL_RADIUS_RATIO,
        10,
      )
      expect(placement.y, `${count}/${index}`).toBe(CENTER)
    }
  })

  /**
   * AC 2, and the assertion is about the RESULT rather than the predicate: the
   * label's final on-screen rotation — the wedge rotation plus the flip, if any
   * — is never more than a quarter turn from upright. Asserting `flipped` per
   * index instead would restate the implementation's own boolean and pass for a
   * predicate with the comparison backwards.
   */
  it('leaves no label upside down, at any option count', () => {
    for (const { index, count } of EVERY_WEDGE) {
      const { flipped } = labelPlacement(index, count)
      const onScreen = midAngle(index, count) + (flipped ? 180 : 0)
      expect(
        Math.abs(signedDegrees(onScreen)),
        `count ${count} index ${index} reads upside down`,
      ).toBeLessThanOrEqual(90 + 1e-9)
    }
  })

  /**
   * The open interval in the flip predicate, at the one boundary that is
   * reachable.
   *
   * A label at exactly 90 degrees is vertical, and reads the same whichever way
   * it is turned — so flipping it is churn, and a `>=` there would flip it
   * while leaving its mirror alone, which is visible as one label facing the
   * wrong way on an odd-numbered wheel.
   *
   * Only odd counts reach it, at the middle wedge: the midangle normalises to
   * 90 when `(index + 0.5) / count` is exactly one half. The other boundary,
   * 270, needs `index + 0.5` to be a whole multiple of `count` and is therefore
   * unreachable for any integer index — the `< 270` half of the predicate is
   * guarding a case the geometry cannot produce, and is kept because the
   * predicate should describe the upside-down arc rather than the arcs that
   * happen to occur.
   */
  it('does not flip a label that is exactly vertical', () => {
    expect(normalizeDegrees(midAngle(1, 3))).toBe(90)
    expect(labelPlacement(1, 3).flipped).toBe(false)

    for (const count of COUNTS.filter((n) => n % 2 === 1)) {
      const middle = (count - 1) / 2
      expect(normalizeDegrees(midAngle(middle, count)), `count ${count}`).toBe(
        90,
      )
      expect(labelPlacement(middle, count).flipped, `count ${count}`).toBe(
        false,
      )
    }
  })
})

describe('truncateLabel', () => {
  it.each([
    { label: 'empty', input: '', expected: '' },
    { label: 'short', input: 'Curry House', expected: 'Curry House' },
    {
      label: 'exactly the truncation length is untouched',
      input: 'a'.repeat(LABEL_TRUNCATE),
      expected: 'a'.repeat(LABEL_TRUNCATE),
    },
    {
      label: 'exactly the maximum is untouched',
      input: 'a'.repeat(LABEL_MAX),
      expected: 'a'.repeat(LABEL_MAX),
    },
    {
      label: 'one past the maximum truncates',
      input: 'a'.repeat(LABEL_MAX + 1),
      expected: 'a'.repeat(LABEL_TRUNCATE) + '…',
    },
    {
      label: 'a long real label',
      input: 'The Green Bowl on Fourth Street',
      expected: 'The Green Bowl on…',
    },
  ])('$label', ({ input, expected }) => {
    expect(truncateLabel(input)).toBe(expected)
  })

  /**
   * The one deliberate departure from the prototype's `.slice(0, 17)`. An emoji
   * is two UTF-16 units, so a plain slice cuts the twelfth one in half and the
   * label ends in a lone surrogate — a replacement glyph on the wheel. Labels
   * are arbitrary user text up to 60 characters, so this is reachable.
   */
  it('does not split an astral character in half', () => {
    const truncated = truncateLabel('🍕'.repeat(20))
    expect(truncated).toBe('🍕'.repeat(LABEL_TRUNCATE) + '…')

    // Under the `u` flag this class matches a lone surrogate only: a properly
    // paired one is a single astral code point, well outside the range.
    expect(truncated).not.toMatch(/[\uD800-\uDFFF]/u)

    // What the prototype's byte-counting slice would have produced instead —
    // asserted so the test states the bug it exists to prevent rather than
    // merely being satisfied by its absence.
    expect('🍕'.repeat(20).slice(0, LABEL_TRUNCATE)).toMatch(/[\uD800-\uDFFF]/u)
  })

  /** Truncating must never make a label longer than leaving it alone would. */
  it('never returns more than the maximum', () => {
    for (let length = 0; length <= 80; length++) {
      const result = truncateLabel('x'.repeat(length))
      expect(Array.from(result).length, `length ${length}`).toBeLessThanOrEqual(
        LABEL_MAX,
      )
    }
  })
})

describe('targetRotation', () => {
  /**
   * AC 3, swept over every option count from two to the cap and every index
   * within it — 1274 pairs.
   *
   * The oracle is the geometry the component actually draws: take the wedge's
   * own midangle, add the rotation the wheel is told to animate to, and the
   * result must be the pointer's angle. That deliberately does NOT re-derive
   * `targetRotation`'s arithmetic in the test, which would pass for two
   * implementations that agreed with each other and disagreed with the picture.
   */
  it('lands the chosen wedge under the pointer, for every option count', () => {
    for (const { index, count } of EVERY_WEDGE) {
      const rotation = targetRotation(0, index, count)
      const underPointer = normalizeDegrees(midAngle(index, count) + rotation)
      expect(
        signedDegrees(underPointer - POINTER_ANGLE),
        `count ${count} index ${index} landed ${underPointer}`,
      ).toBeCloseTo(0, 9)
    }
  })

  /** And it must keep doing so from wherever the previous spin stopped. */
  it('lands correctly when the wheel is already at an arbitrary angle', () => {
    let rotation = 0
    for (const { index, count } of EVERY_WEDGE) {
      rotation = targetRotation(rotation, index, count)
      const underPointer = normalizeDegrees(midAngle(index, count) + rotation)
      expect(
        signedDegrees(underPointer - POINTER_ANGLE),
        `count ${count} index ${index}`,
      ).toBeCloseTo(0, 9)
    }
  })

  /**
   * Always forward, and by enough to read as a spin. A target below the current
   * rotation animates anticlockwise; a target equal to it does not animate at
   * all, which is the second spin of a two-option wheel that lands on the same
   * option — the button appears dead.
   */
  it('always travels forward by at least five full turns', () => {
    let rotation = 0
    for (const { index, count } of EVERY_WEDGE) {
      const next = targetRotation(rotation, index, count)
      expect(next - rotation, `count ${count} index ${index}`).toBeGreaterThan(
        360 * 5,
      )
      rotation = next
    }
  })

  it('is deterministic for the same inputs', () => {
    expect(targetRotation(0, 3, 8)).toBe(targetRotation(0, 3, 8))
  })
})

describe('normalizeDegrees', () => {
  it.each([
    { label: 'zero', input: 0, expected: 0 },
    { label: 'inside the range', input: 90, expected: 90 },
    { label: 'a full turn wraps to zero', input: 360, expected: 0 },
    { label: 'past a full turn', input: 450, expected: 90 },
    { label: 'negative', input: -90, expected: 270 },
    { label: 'several turns negative', input: -810, expected: 270 },
  ])('$label', ({ input, expected }) => {
    expect(normalizeDegrees(input)).toBe(expected)
  })
})
