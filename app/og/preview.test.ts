import { describe, expect, it } from 'vitest'

import { DECORATIVE_SLICES, PALETTE_LENGTH } from '@/app/wheel-palette'
import { SITE_TAGLINE } from '@/lib/site'
import {
  OPTIONS_MAX,
  OPTION_LABEL_MAX,
  TITLE_MAX,
} from '@/lib/wheels/validation'

import {
  PILLS_MAX,
  PILL_LABEL_MAX,
  UNKNOWN_WHEEL_TITLE,
  decorativeSlices,
  displayTitle,
  optionCountLine,
  optionPills,
  titleFontSize,
  wheelMetadata,
} from './preview'

/**
 * The words and numbers an unfurl is built from. The picture itself is a PNG
 * and is checked by looking at it; everything testable is here.
 */

describe('optionCountLine', () => {
  it.each([
    { label: 'an empty wheel', count: 0, expected: 'Options going up now' },
    { label: 'one option', count: 1, expected: '1 option on the wheel' },
    { label: 'two options', count: 2, expected: '2 options on the wheel' },
    { label: 'a full wheel', count: 50, expected: '50 options on the wheel' },
  ])('reads correctly for $label', ({ count, expected }) => {
    expect(optionCountLine(count)).toBe(expected)
  })

  it.each([
    { label: 'a negative count', count: -3 },
    { label: 'a fractional count', count: 2.7 },
    { label: 'NaN', count: Number.NaN },
  ])('never interpolates $label raw', ({ count }) => {
    // A stored document is the source of this number, so the failure being
    // guarded is a card reading "NaN options on the wheel" — cached that way.
    expect(optionCountLine(count)).toMatch(
      /^(Options going up now|\d+ options? on the wheel)$/,
    )
  })
})

describe('decorativeSlices', () => {
  it.each([
    { label: 'an empty wheel', count: 0 },
    { label: 'one option', count: 1 },
    { label: 'two options', count: 2 },
  ])('draws the decorative disc for $label', ({ count }) => {
    // One wedge is a plain disc and two is a coin. Neither reads as a wheel.
    expect(decorativeSlices(count)).toBe(DECORATIVE_SLICES)
  })

  it('numbers the wedges from the palette, in order', () => {
    // The pills are coloured by the same index, so a wedge that did not take
    // SLICE[position] would pair a pill with the wrong slice.
    expect(decorativeSlices(4)).toEqual([0, 1, 2, 3])
  })

  it('follows the real count once there is a wheel to draw', () => {
    expect(decorativeSlices(3)).toHaveLength(3)
    expect(decorativeSlices(PALETTE_LENGTH)).toHaveLength(PALETTE_LENGTH)
  })

  it('stops at one full pass of the palette', () => {
    // Past this the colours repeat, and at OPTIONS_MAX the disc is fifty
    // slivers of five recurring colours, which reads as noise.
    expect(decorativeSlices(PALETTE_LENGTH + 1)).toHaveLength(PALETTE_LENGTH)
    expect(decorativeSlices(OPTIONS_MAX)).toHaveLength(PALETTE_LENGTH)
  })

  it('is always a wheel a wedge path can be drawn from', () => {
    for (const count of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const slices = decorativeSlices(count)
      expect(
        slices.length,
        `${count} gave ${slices.length} wedges`,
      ).toBeGreaterThan(0)
      expect(slices.every(Number.isInteger)).toBe(true)
    }
  })
})

describe('optionPills', () => {
  const labels = (count: number) =>
    Array.from({ length: count }, (_, i) => `Option ${i + 1}`)

  it('names the options in the wheel’s own order', () => {
    const { pills } = optionPills(labels(3), 3)
    expect(pills.map((pill) => pill.label)).toEqual([
      'Option 1',
      'Option 2',
      'Option 3',
    ])
  })

  it('colours each pill by its slice', () => {
    // The dot is the wedge's colour, so the index has to be the option's
    // position rather than the pill's.
    const { pills } = optionPills(labels(3), 3)
    expect(pills.map((pill) => pill.palette)).toEqual([0, 1, 2])
  })

  it('shows no more than PILLS_MAX and counts the rest', () => {
    const { pills, overflow } = optionPills(
      labels(PILLS_MAX + 6),
      PILLS_MAX + 6,
    )
    expect(pills).toHaveLength(PILLS_MAX)
    expect(overflow).toBe(6)
  })

  it('reports nothing left over when it has shown everything', () => {
    expect(optionPills(labels(PILLS_MAX), PILLS_MAX).overflow).toBe(0)
    expect(optionPills([], 0).pills).toEqual([])
  })

  it('cuts a long label rather than letting it take the row', () => {
    // OPTION_LABEL_MAX is 60, which at the card's 22px is a row on its own and
    // pushes the count line off the card.
    const { pills } = optionPills(['x'.repeat(OPTION_LABEL_MAX)], 1)
    expect(Array.from(pills[0].label)).toHaveLength(PILL_LABEL_MAX)
    expect(pills[0].label.endsWith('…')).toBe(true)
  })

  it('never cuts an astral character in half', () => {
    // A lone surrogate renders as a replacement box, on a card that cannot be
    // re-fetched. Same argument as components/wheel/geometry.ts.
    const { pills } = optionPills(['🎉'.repeat(PILL_LABEL_MAX + 4)], 1)

    // `Array.from` splits by code point, so a surviving half of a pair shows up
    // as a single unit in the surrogate range while a whole emoji is one unit
    // above 0xFFFF.
    const orphans = Array.from(pills[0].label).filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 0xd800 && code <= 0xdfff
    })
    expect(orphans).toEqual([])
  })

  it('drops a label that would render as a blank pill', () => {
    // No write path can produce one, but this reads a stored document.
    const { pills, overflow } = optionPills(['Tacos', '', '   ', 'Ramen'], 4)
    expect(pills.map((pill) => pill.label)).toEqual(['Tacos', 'Ramen'])
    // And the two it dropped are still counted, because the count line beside
    // the pills is drawn from the wheel's own total and would otherwise be
    // describing a different wheel. See the case below.
    expect(overflow).toBe(2)
  })

  /**
   * The card must not contradict its own caption.
   *
   * `overflow` used to be counted off the filtered list while
   * `optionCountLine` was fed `preview.optionCount`, which `readWheelPreview`
   * takes from the unfiltered array — `labelOf` coerces a bad label to `''`
   * rather than dropping it, so that a broken option cannot shift every
   * palette position after it. Six options with two label-less therefore drew
   * four pills, no "+N more", and "6 options on the wheel" underneath: a card
   * disagreeing with itself, cached that way for good.
   */
  it('counts what the wheel has, not what survived the filter', () => {
    const stored = ['Tacos', '', 'Ramen', '', 'Sushi', 'Pizza']
    const { pills, overflow } = optionPills(stored, stored.length)

    expect(pills).toHaveLength(PILLS_MAX)
    expect(overflow, 'four shown out of six leaves two').toBe(2)
    // Stated the way the card states it, since that is the pairing that broke.
    expect(pills.length + overflow).toBe(6)
    expect(optionCountLine(stored.length)).toBe('6 options on the wheel')
  })

  /**
   * `total` is the wheel's, and `options` may be a sample of it — `WheelPreview`
   * says so and forbids assuming otherwise. Nothing truncates it today, which
   * is exactly why this is pinned: a reader that later hands over the first
   * few labels must not silently turn "+46 more" into "+0 more".
   */
  it('counts options it was never given labels for', () => {
    const { pills, overflow } = optionPills(labels(PILLS_MAX), 50)

    expect(pills).toHaveLength(PILLS_MAX)
    expect(overflow).toBe(46)
  })

  it('never reports a negative overflow for a nonsense count', () => {
    // `total` comes from a stored document, so it gets the same treatment
    // every other count on the card gets.
    for (const total of [-5, Number.NaN, 0]) {
      expect(optionPills(labels(3), total).overflow).toBe(0)
    }
  })
})

describe('titleFontSize', () => {
  it('shrinks as the title grows', () => {
    const sizes = [
      'Lunch',
      'Where are we eating?',
      'x'.repeat(40),
      'x'.repeat(TITLE_MAX),
    ].map(titleFontSize)

    for (const [i, size] of sizes.slice(1).entries()) {
      expect(sizes[i], `step ${i} of the ramp`).toBeGreaterThan(size)
    }
  })

  it('has a smallest step that a maximum-length title reaches', () => {
    // The ramp is only useful if TITLE_MAX lands in the bucket the layout was
    // checked against.
    expect(titleFontSize('x'.repeat(TITLE_MAX))).toBe(38)
  })

  it('measures code points rather than UTF-16 units', () => {
    // Seven emoji are fourteen units. Counting units would drop this title a
    // bucket for no reason. Same argument as lib/wheels/validation.ts.
    expect(titleFontSize('🎉'.repeat(7))).toBe(titleFontSize('abcdefg'))
  })
})

describe('displayTitle', () => {
  it.each([
    { label: 'undefined', title: undefined },
    { label: 'an empty string', title: '' },
    { label: 'whitespace only', title: '   ' },
  ])('falls back for $label', ({ title }) => {
    expect(displayTitle(title)).toBe(UNKNOWN_WHEEL_TITLE)
  })

  it('trims but does not otherwise touch a real title', () => {
    expect(displayTitle('  Team lunch  ')).toBe('Team lunch')
  })
})

describe('wheelMetadata', () => {
  /** A wheel whose labels do not matter to the assertion. */
  const wheel = (title: string, optionCount: number) => ({
    title,
    optionCount,
    options: Array.from({ length: optionCount }, (_, i) => `Option ${i + 1}`),
  })

  it('says nothing specific about a wheel it could not read', () => {
    // Absent and unreadable are deliberately the same answer: a description
    // claiming the wheel is gone would be cached by a crawler that caught one
    // failed read, and would then describe a live wheel as expired.
    expect(wheelMetadata(null)).toEqual({
      title: UNKNOWN_WHEEL_TITLE,
      description: SITE_TAGLINE,
    })
  })

  it('carries the wheel title through as its own', () => {
    expect(wheelMetadata(wheel('Team lunch', 6)).title).toBe('Team lunch')
  })

  it('agrees with the card about the count', () => {
    // The point of both living in this module: the two are read by different
    // programs and a mismatch would never show up locally.
    const { description } = wheelMetadata(wheel('Team lunch', 6))
    expect(description).toContain(optionCountLine(6))
  })

  it('does not describe an empty wheel by its count', () => {
    expect(wheelMetadata(wheel('Team lunch', 0)).description).not.toMatch(
      /\b0\b/,
    )
  })

  it('does not name the options', () => {
    // The card lists them; the description deliberately does not. og:description
    // is quoted verbatim in a chat message, where a stale list of specific
    // things reads worse than a stale number.
    const { description } = wheelMetadata(wheel('Team lunch', 3))
    expect(description).not.toContain('Option 1')
  })
})
