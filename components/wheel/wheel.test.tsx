// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { PALETTE_LENGTH, SLICE } from '@/app/wheel-palette'
import type { WheelOption } from '@/lib/wheels/model'

import {
  BACKDROP_RADIUS,
  CENTER,
  HUB_RADIUS,
  LABEL_TRUNCATE,
  WEDGE_STROKE,
  wedgePath,
} from './geometry'
import { Wheel } from './wheel'

function option(label: string): WheelOption {
  return { id: label, label, addedAt: null, fromSuggestion: null }
}

const OPTIONS = ['Taqueria', 'Noodle Bar', 'Green Bowl', 'Sunny Deli'].map(
  option,
)

function renderWheel(props: Partial<Parameters<typeof Wheel>[0]> = {}) {
  return render(
    <Wheel
      options={OPTIONS}
      rotation={0}
      transition="none"
      title="Team lunch"
      {...props}
    />,
  )
}

/** The rotating group: everything inside the svg turns with the wheel. */
function svg(): SVGSVGElement {
  const element = screen.getByRole('img')
  expect(element.tagName.toLowerCase()).toBe('svg')
  return element as unknown as SVGSVGElement
}

afterEach(cleanup)

describe('the wedges', () => {
  it('draws one per option', () => {
    const { container } = renderWheel()
    expect(container.querySelectorAll('path')).toHaveLength(OPTIONS.length)
  })

  it('draws the path geometry says it should', () => {
    const { container } = renderWheel()
    const paths = [...container.querySelectorAll('path')]

    paths.forEach((path, index) => {
      expect(path.getAttribute('d')).toBe(wedgePath(index, OPTIONS.length))
      expect(path.getAttribute('stroke')).toBe('#ffffff')
      expect(path.getAttribute('stroke-width')).toBe(String(WEDGE_STROKE))
    })
  })

  it('fills from the palette in order', () => {
    const { container } = renderWheel()
    const fills = [...container.querySelectorAll('path')].map((path) =>
      path.getAttribute('fill'),
    )
    expect(fills).toEqual(SLICE.slice(0, OPTIONS.length))
  })

  /**
   * A wheel can hold `OPTIONS_MAX` options against a palette of ten, so the
   * eleventh has to come back round to the first rather than render undefined.
   */
  it('wraps the palette past its length', () => {
    const many = Array.from({ length: PALETTE_LENGTH + 3 }, (_, i) =>
      option(`Option ${i}`),
    )
    const { container } = renderWheel({ options: many })
    const fills = [...container.querySelectorAll('path')].map((path) =>
      path.getAttribute('fill'),
    )

    expect(fills[PALETTE_LENGTH]).toBe(SLICE[0])
    expect(fills[PALETTE_LENGTH + 2]).toBe(SLICE[2])
    expect(fills).not.toContain(null)
  })

  /**
   * A one-option wheel cannot be spun, but it is on screen the whole time an
   * editor is filling in the first two — so it has to be visible. It was not:
   * see `wedgePath`'s note on coincident arc endpoints.
   */
  it('draws a visible slice for a single option', () => {
    const { container } = renderWheel({ options: [option('Curry House')] })
    const path = container.querySelector('path')

    expect(path).not.toBeNull()
    expect(path?.getAttribute('fill')).toBe(SLICE[0])
    // A path that renders as nothing: one arc command, its endpoint equal to
    // the move-to that preceded it.
    expect(path?.getAttribute('d')).not.toMatch(
      /^M 200 200 L ([\d.]+) ([\d.]+) A [^Z]*\1 \2 Z$/,
    )
    expect(container.querySelector('text')?.textContent).toBe('Curry House')
  })

  /**
   * The empty wheel draws as a one-slice wheel with nothing written on it.
   *
   * Left as a bare backdrop it was a white disc inside a white rim under a drop
   * shadow, which reads as a component that failed to load rather than as a
   * wheel waiting for its first option — and that is the state every new wheel
   * opens in, so it is the first thing a creator sees.
   */
  it('draws a single blank slice for an empty wheel', () => {
    const { container } = renderWheel({ options: [] })
    const paths = container.querySelectorAll('path')

    expect(paths).toHaveLength(1)
    expect(paths[0].getAttribute('fill')).toBe(SLICE[0])
    expect(
      paths[0].getAttribute('d'),
      'the empty wheel and the one-option wheel are the same geometry',
    ).toBe(wedgePath(0, 1))
    expect(
      container.querySelectorAll('text'),
      'a slice standing for nothing must not be labelled',
    ).toHaveLength(0)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    expect(container.innerHTML).not.toContain('NaN')
  })
})

describe('the labels', () => {
  it('renders one per option', () => {
    const { container } = renderWheel()
    const labels = [...container.querySelectorAll('text')].map(
      (text) => text.textContent,
    )
    expect(labels).toEqual(OPTIONS.map((o) => o.label))
  })

  /** AC 2, through the component rather than through the pure function. */
  it('truncates a long label with an ellipsis', () => {
    const { container } = renderWheel({
      options: [option('The Green Bowl on Fourth Street'), option('Deli')],
    })
    const labels = [...container.querySelectorAll('text')].map(
      (text) => text.textContent,
    )

    expect(labels[0]).toBe('The Green Bowl on…')
    expect(labels[0]).toHaveLength(LABEL_TRUNCATE + 1)
    expect(labels[1]).toBe('Deli')
  })

  it('flips the labels on the left half and not the ones on the right', () => {
    const { container } = renderWheel()
    const transforms = [...container.querySelectorAll('text')].map((text) =>
      text.getAttribute('transform'),
    )

    // Four options: wedges 0 and 1 are the right half, 2 and 3 the left.
    expect(transforms[0]).not.toContain('rotate(180')
    expect(transforms[1]).not.toContain('rotate(180')
    expect(transforms[2]).toContain('rotate(180')
    expect(transforms[3]).toContain('rotate(180')
  })

  it('colours each label for contrast against its own slice', () => {
    const { container } = renderWheel()
    const fills = [...container.querySelectorAll('text')].map((text) =>
      text.getAttribute('fill'),
    )

    // The second slice is the yellow one, which needs dark ink; the first is
    // red and takes white. A single hard-coded label colour fails this.
    expect(fills[0]).toBe('#ffffff')
    expect(fills[1]).toBe('#4f3400')
  })
})

describe('the disc', () => {
  it('places the backdrop behind the wedges and the hub on top', () => {
    const { container } = renderWheel()
    const children = [...(container.querySelector('svg')?.children ?? [])]

    expect(children[0].tagName.toLowerCase()).toBe('circle')
    expect(children[0].getAttribute('r')).toBe(String(BACKDROP_RADIUS))
    expect(children[children.length - 1].getAttribute('r')).toBe(
      String(HUB_RADIUS),
    )
  })

  it('centres both circles', () => {
    const { container } = renderWheel()
    for (const circle of container.querySelectorAll('circle')) {
      expect(circle.getAttribute('cx')).toBe(String(CENTER))
      expect(circle.getAttribute('cy')).toBe(String(CENTER))
    }
  })

  it('uses the full viewBox', () => {
    renderWheel()
    expect(svg().getAttribute('viewBox')).toBe('0 0 400 400')
  })
})

describe('rotation', () => {
  it('applies the rotation and transition it is given', () => {
    renderWheel({
      rotation: 2475,
      transition: 'transform 4300ms cubic-bezier(0.16, 0.85, 0.16, 1)',
    })

    expect(svg().style.transform).toBe('rotate(2475deg)')
    expect(svg().style.transition).toBe(
      'transform 4300ms cubic-bezier(0.16, 0.85, 0.16, 1)',
    )
  })

  it('holds still with no transition', () => {
    renderWheel({ rotation: 90 })
    expect(svg().style.transition).toBe('none')
  })
})

describe('the pointer', () => {
  /**
   * Outside the svg, and that is structural: everything inside it rotates, so a
   * pointer drawn in there would spin along with the wedges it is indicating.
   */
  it('sits outside the rotating svg', () => {
    const { container } = renderWheel()
    const pointer = container.querySelector('[aria-hidden="true"]')

    expect(pointer).not.toBeNull()
    expect(pointer?.closest('svg')).toBeNull()
  })

  /**
   * Read through the SHORTHAND rather than `borderTopWidth`, which is empty
   * here. jsdom's CSS parser declines to expand a shorthand whose value
   * contains `var()` — the declaration survives intact on the element and a
   * real browser resolves it, but the longhand accessor reports nothing. Not
   * worth splitting the component's styles into longhands to satisfy: that
   * would be a test dictating the shape of the code it tests, over a gap in
   * the test environment.
   */
  it('is a triangle of the prototype’s dimensions', () => {
    const { container } = renderWheel()
    const pointer = container.querySelector(
      '[aria-hidden="true"]',
    ) as HTMLElement

    expect(pointer.style.borderTop).toBe('34px solid var(--color-accent-600)')
    expect(pointer.style.borderLeft).toBe('17px solid transparent')
    expect(pointer.style.borderRight).toBe('17px solid transparent')
    // A CSS triangle is a zero-sized box; give it dimensions and the borders
    // stop meeting at a point.
    expect(pointer.style.width).toBe('0px')
    expect(pointer.style.height).toBe('0px')
  })
})

describe('accessibility', () => {
  it('names the wheel and its options as one image', () => {
    renderWheel()
    expect(svg().getAttribute('aria-label')).toBe(
      'Team lunch: Taqueria, Noodle Bar, Green Bowl, Sunny Deli',
    )
  })

  it('says so when there is nothing on the wheel', () => {
    renderWheel({ options: [] })
    expect(svg().getAttribute('aria-label')).toBe('Team lunch: no options yet')
  })

  /** The label a screen reader hears is the full one, not the wedge's. */
  it('announces untruncated labels', () => {
    renderWheel({
      options: [option('The Green Bowl on Fourth Street'), option('Deli')],
    })
    expect(svg().getAttribute('aria-label')).toContain(
      'The Green Bowl on Fourth Street',
    )
  })
})
