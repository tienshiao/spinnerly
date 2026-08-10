import { describe, expect, it } from 'vitest'

import { OPTIONS_MAX } from '@/lib/wheels/validation'

import { INK, PALETTE_LENGTH, SLICE, sliceColors } from './wheel-palette'

/**
 * The one rule the palette exists to hold: **no wheel has two touching slices
 * the same colour.**
 *
 * Worth a test rather than a comment because the failure is invisible from any
 * single call. `sliceColors` is a pure function of one position and looks
 * obviously correct at every position; the defect only exists between the last
 * slice and the first, which no caller ever asks about — the wheel is a circle
 * and nothing in the code says so.
 */

/** Every slice colour for a wheel of `count` options, in wheel order. */
function wheelOf(count: number): string[] {
  return Array.from({ length: count }, (_, i) => sliceColors(i).fill)
}

describe('sliceColors', () => {
  /**
   * The seam is the pair the old `i % PALETTE_LENGTH` got wrong, at 11, 21, 31
   * and 41 options. Checked at every count a wheel can reach rather than at
   * those four, so a future change to the palette length cannot quietly
   * reintroduce it somewhere else.
   */
  it.each(
    Array.from({ length: OPTIONS_MAX - 1 }, (_, i) => ({
      label: `${i + 2} options`,
      count: i + 2,
    })),
  )('gives $label no two touching slices of one colour', ({ count }) => {
    const fills = wheelOf(count)

    for (const [i, fill] of fills.entries()) {
      // `% count` is the whole point: it wraps the last slice round to the
      // first, which is the pair that is adjacent on a disc and adjacent
      // nowhere in the data.
      const next = (i + 1) % count
      expect(
        fill,
        `slices ${i} and ${next} of a ${count}-option wheel are both ${fill}`,
      ).not.toBe(fills[next])
    }
  })

  /**
   * What makes the rule above cheap: it changes nothing anybody can currently
   * see. Ten options or fewer are untouched, and so is every module that names
   * a palette entry by index — `DECORATIVE_SLICES`, `BRAND_MARK_SLICES`, the
   * landing page's avatar row, the Open Graph pills.
   */
  it('is the identity for a full first pass of the palette', () => {
    for (let i = 0; i < PALETTE_LENGTH; i++) {
      expect(sliceColors(i)).toEqual({ fill: SLICE[i], ink: INK[i] })
    }
  })

  it('reserves the first colour for the first slice alone', () => {
    const laterSlices = Array.from(
      { length: OPTIONS_MAX },
      (_, i) => sliceColors(i + 1).fill,
    )
    expect(laterSlices).not.toContain(SLICE[0])
  })

  it('keeps the ink paired with the fill it has to be legible on', () => {
    // The two arrays are parallel, so the only pairs that may ever come back
    // are the ten that were contrast-checked together. Compared as pairs rather
    // than by looking an index up, because a mapping that returned the right
    // fill with the wrong ink would pass an index-wise check of either alone.
    const contrastChecked = SLICE.map((fill, i) => `${fill} on ${INK[i]}`)

    for (let i = 0; i < OPTIONS_MAX; i++) {
      const { fill, ink } = sliceColors(i)
      expect(contrastChecked, `slice ${i}`).toContain(`${fill} on ${ink}`)
    }
  })

  it.each([
    { label: 'a fractional index', index: 2.7 },
    { label: 'NaN', index: Number.NaN },
    { label: 'a negative index', index: -1 },
    { label: 'Infinity', index: Number.POSITIVE_INFINITY },
  ])('returns a real colour pair for $label', ({ index }) => {
    // Untruncated, a fractional index passes through the modulo unchanged and
    // misses both arrays, returning undefined twice — with no error anywhere.
    const { fill, ink } = sliceColors(index)
    expect(SLICE).toContain(fill)
    expect(INK).toContain(ink)
  })
})
