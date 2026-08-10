// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SLICE } from '@/app/wheel-palette'

import { CONFETTI_LIFETIME_MS, CONFETTI_PIECES, Confetti } from './confetti'

/**
 * The burst.
 *
 * Two of these cases are about what happens when nobody is watching: the layer
 * taking itself back out of the DOM once the pieces have landed (AC 2), and
 * there being no layer at all under `prefers-reduced-motion` (AC 3). Both fail
 * silently in a browser — seventy spans parked below the fold look exactly like
 * no spans at all, and a burst that ignores the preference looks correct to
 * whoever did not set it.
 */

/**
 * `matchMedia`, stubbed. jsdom ships one whose `matches` is hard-wired false,
 * so a reduced-motion case against the built-in would pass whatever the
 * component did with the value. Same helper as ./use-spin.test.ts.
 */
function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function pieces(container: HTMLElement): HTMLSpanElement[] {
  return Array.from(container.querySelectorAll('span'))
}

beforeEach(() => {
  stubReducedMotion(false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the layer', () => {
  it('is decorative and takes no clicks', () => {
    const { container } = render(<Confetti />)

    const layer = container.querySelector('[data-slot="confetti"]')
    expect(layer?.getAttribute('aria-hidden')).toBe('true')
    // The card sits under this layer; a burst that swallowed pointer events
    // would leave "Nice" and "Spin again" dead for four seconds.
    expect(layer?.className).toContain('pointer-events-none')
  })

  it("draws the prototype's seventy pieces", () => {
    const { container } = render(<Confetti />)

    expect(pieces(container)).toHaveLength(CONFETTI_PIECES)
  })

  /**
   * Every piece waits out its stagger — up to 900ms — before its animation
   * styles anything, so where it sits in the meantime is the element's own
   * business. With the start offset written into the keyframe instead, seventy
   * pieces sat in a row along the top edge of the page and dropped out of it
   * one at a time.
   *
   * Asserted on the class rather than on a measured position, which jsdom has
   * neither the layout nor the animations to give.
   */
  it('waits out its stagger above the top of the screen', () => {
    const { container } = render(<Confetti />)

    for (const piece of pieces(container)) {
      expect(piece.className).toContain('-top-[10vh]')
    }
  })

  /** Two in three are rectangles, the third a disc — the prototype's mix. */
  it('alternates rectangles and discs, in the slice palette', () => {
    const { container } = render(<Confetti />)
    const all = pieces(container)

    expect(all[0].style.width, 'index 0 is a disc').toBe('13px')
    expect(all[0].style.borderRadius).toBe('var(--radius-pill)')
    expect(all[1].style.width, 'index 1 is a rectangle').toBe('9px')
    expect(all[1].style.height).toBe('14px')
    expect(all[1].style.borderRadius).toBe('2px')

    // Every piece is a palette colour, and the palette wraps rather than
    // running out at ten.
    const fills = new Set(all.map((piece) => piece.style.background))
    expect(fills.size).toBe(SLICE.length)
  })

  /**
   * The drift and the spin ride on custom properties so that seventy pieces can
   * share one keyframe. Both have fallbacks in the keyframe, which is what makes
   * a missing one invisible rather than loud — the piece just hangs at the top
   * of the screen — so they are asserted here.
   */
  it('gives every piece its own drift, rotation and start', () => {
    const { container } = render(<Confetti />)
    const all = pieces(container)

    for (const piece of all) {
      expect(piece.style.getPropertyValue('--confetti-dx')).toMatch(/^-?\d+px$/)
      expect(piece.style.getPropertyValue('--confetti-rot')).toMatch(
        /^-?\d+deg$/,
      )
    }

    const starts = new Set(all.map((piece) => piece.style.animationDelay))
    expect(
      starts.size,
      'a single start time is a curtain, not a burst',
    ).toBeGreaterThan(1)

    const drifts = new Set(
      all.map((piece) => piece.style.getPropertyValue('--confetti-dx')),
    )
    expect(drifts.size).toBeGreaterThan(1)
  })
})

describe('cleaning up', () => {
  /**
   * AC 2. The modal can stay open for as long as the room takes to react, and
   * the pieces are done in four seconds — a layer that stayed would leave
   * seventy filled spans below the fold, and another seventy on the next spin.
   */
  it('removes itself once the last piece has landed', () => {
    vi.useFakeTimers()
    const { container } = render(<Confetti />)

    act(() => {
      vi.advanceTimersByTime(CONFETTI_LIFETIME_MS - 1)
    })
    expect(
      pieces(container),
      'gone before the slowest piece landed',
    ).toHaveLength(CONFETTI_PIECES)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('[data-slot="confetti"]')).toBeNull()
  })

  /**
   * The lifetime is derived from the pieces rather than written down, so this
   * pins the derivation rather than the number: it has to outlast the piece
   * that starts last AND falls slowest, not merely the slowest one.
   */
  it('waits for the piece that starts last and falls slowest', () => {
    const { container } = render(<Confetti />)

    const latest = Math.max(
      ...pieces(container).map(
        (piece) =>
          Number.parseInt(piece.style.animationDelay, 10) +
          Number.parseInt(piece.style.animationDuration, 10),
      ),
    )

    expect(CONFETTI_LIFETIME_MS).toBe(latest)
  })
})

describe('prefers-reduced-motion', () => {
  /**
   * AC 3, and the reason it is nothing rather than a shortened fall: what the
   * preference asks for is the absence of the movement, and seventy elements
   * crossing the viewport IS the movement. A 200ms version is the same request
   * refused faster.
   */
  it('draws nothing at all', () => {
    stubReducedMotion(true)

    const { container } = render(<Confetti />)

    expect(container.querySelector('[data-slot="confetti"]')).toBeNull()
    expect(pieces(container)).toHaveLength(0)
  })
})
