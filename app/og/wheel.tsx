import { DISC_SHADOW, WheelDisc, type DiscSlice } from '@/components/wheel/disc'
import {
  POINTER_HEIGHT,
  POINTER_RISE,
  POINTER_WIDTH,
} from '@/components/wheel/geometry'

import { OG } from './theme'

/**
 * The wheel, for Satori.
 *
 * The drawing is components/wheel/disc.tsx — the same one the wheel page and the
 * landing hero use, which is the point: three surfaces showing three subtly
 * different wheels is what this file used to be part of. What is left here is
 * the two things Satori will not do.
 *
 * **Colours are passed as literals.** There is no stylesheet and no cascade, so
 * `var(--color-neutral-100)` is not a colour that fails to resolve — it is a
 * string Satori cannot parse. ./theme.ts holds the resolved values.
 *
 * **The pointer is a polygon and its shadow is an SVG filter.** The browser
 * surfaces draw a CSS triangle with `filter: drop-shadow`; Satori supports
 * neither with any confidence. Both are rebuilt from the same three constants in
 * geometry.ts, so they are the same mark at the same size.
 *
 * What is deliberately still missing is labels. The card shows the options as
 * pills beside the wheel — see ./cards.tsx — and repeating them around the rim
 * at this size would be six characters per wedge.
 *
 * The brand mark has no wrapper here at all: `WheelMark` in that same module is
 * already Satori-safe, so both cards import it directly.
 */

export type OgWheelProps = {
  /** Rendered size in card pixels. */
  size: number
  /** Palette index per wedge, in order. */
  slices: readonly number[]
  /**
   * Degrees to turn the wedges by, for the marketing card's tilted disc.
   *
   * Applied inside the SVG rather than as a CSS transform on the box, so the
   * pointer and the rim stay upright — and because an SVG `transform` on a group
   * is a primitive Satori is certain to support.
   */
  tilt?: number
}

export function OgWheel({ size, slices, tilt = 0 }: OgWheelProps) {
  const wedges: DiscSlice[] = slices.map((palette) => ({ palette }))

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: size,
        height: size,
      }}
    >
      {/*
        The disc's shadow is a box-shadow on a round box behind the SVG rather
        than the `filter: drop-shadow` the other two use, Satori supporting the
        one and not the other. The values match, and the backdrop circle fills
        99% of this box, so the result is the same ring of shadow under the same
        edge.
      */}
      <div
        style={{
          display: 'flex',
          width: size,
          height: size,
          borderRadius: size,
          boxShadow: DISC_SHADOW,
        }}
      >
        {/* `WheelDisc` renders the `<svg>` itself, and has to: Satori does not
            invoke a function component inside an SVG subtree. See the note
            there — the symptom is an empty disc, not an error. */}
        <WheelDisc
          slices={wedges}
          surface={OG.surface}
          accent={OG.accent}
          tilt={tilt}
          width={size}
          height={size}
        />
      </div>

      <svg
        width={POINTER_WIDTH}
        height={POINTER_HEIGHT + POINTER_RISE}
        viewBox={`0 0 ${POINTER_WIDTH} ${POINTER_HEIGHT + POINTER_RISE}`}
        style={{
          position: 'absolute',
          top: -POINTER_RISE,
          left: Math.round((size - POINTER_WIDTH) / 2),
        }}
      >
        {/* `POINTER_SHADOW` spelled out as a filter, because an feDropShadow
            wants the offset, the blur and the colour as separate attributes and
            a CSS shadow string cannot be handed over whole. `stdDeviation` is
            half the CSS blur radius, which is how the two are defined to
            correspond. Keep these in step with that constant by hand. */}
        <filter
          id="pointer-shadow"
          x="-50%"
          y="-50%"
          width="200%"
          height="200%"
        >
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="1.5"
            floodColor="#2e2b25"
            floodOpacity="0.3"
          />
        </filter>
        <polygon
          points={`0,0 ${POINTER_WIDTH},0 ${POINTER_WIDTH / 2},${POINTER_HEIGHT}`}
          fill={OG.accent600}
          filter="url(#pointer-shadow)"
        />
      </svg>
    </div>
  )
}
