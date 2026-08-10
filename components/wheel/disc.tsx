import type { CSSProperties, ReactNode } from 'react'

import { BRAND_MARK_SLICES, sliceColors } from '@/app/wheel-palette'

import {
  BACKDROP_RADIUS,
  CENTER,
  HUB_RADIUS,
  HUB_STROKE,
  POINTER_HEIGHT,
  POINTER_RISE,
  POINTER_WIDTH,
  RADIUS,
  VIEWBOX,
  wedgePath,
} from './geometry'

/**
 * The wheel, drawn once for everywhere that draws one.
 *
 * Three surfaces show a wheel — the landing hero, the wheel page, and the Open
 * Graph card — and before this they were three separate pictures: the hero was a
 * `conic-gradient` with no dividers and a hub inset by 38%, the wheel page was
 * SVG arcs with a 34-unit hub, and the card had a third hub, a thicker rim and a
 * pointer in a different red. Nothing was wrong with any of them on its own,
 * which is exactly why they drifted.
 *
 * So the picture lives here and the numbers live in ./geometry.ts. What each
 * surface still owns is what genuinely differs: the wheel page rotates its disc
 * and labels its wedges, the hero turns slowly forever, and the card is a PNG.
 *
 * **Renderable by Satori**, which is what lets the Open Graph route use it
 * rather than keep a fourth copy. Three things follow, and all are worth knowing
 * before editing this file:
 *
 *  - **No CSS custom properties.** Every colour arrives as a prop; the app
 *    passes `var(--color-*)` and the card passes the literals those resolve to.
 *    `className` exists for the app's sake and the card leaves it unset —
 *    Satori has no stylesheet to resolve one against.
 *  - **No `'use client'`.** This is presentational, and a client module is not
 *    something an image route can reach into.
 *  - **The structure is not free.** See `WheelDisc` for the three ways Satori
 *    silently drops SVG content, each of which shows up as a blank disc on a
 *    card that is already in Slack's cache.
 */

/** The disc's own drop shadow. Prototype value, shared by all three surfaces. */
export const DISC_SHADOW = '0 12px 28px rgba(46,43,37,0.22)'

/** The pointer's, which is tighter and closer — it sits on top of the disc. */
export const POINTER_SHADOW = '0 2px 3px rgba(46,43,37,0.3)'

export type DiscSlice = {
  /** Which palette colour fills this wedge. See app/wheel-palette.ts. */
  palette: number
  /**
   * React key. Defaults to the wedge's position, which is right for the two
   * decorative wheels and wrong for the wheel page: its wedges are options that
   * get added and removed, so they key on the option id to stop React reusing a
   * departed option's element — and its animations — for the one that shuffled
   * into that position.
   */
  key?: string
  /** Drawn inside the wedge's own group, over the fill. The wheel page's label. */
  content?: ReactNode
}

export type WheelDiscProps = {
  slices: readonly DiscSlice[]
  /**
   * The two theme colours this drawing needs. Defaults are the app's tokens;
   * the Open Graph card passes literals because Satori has no cascade to
   * resolve a `var()` against.
   *
   */
  surface?: string
  accent?: string
  /**
   * Degrees to turn the whole drawing by, for the marketing card's tilted disc.
   *
   * On this group rather than on a group of its own, because of the nesting
   * limit in the note below. Both circles are centred, so turning them with the
   * wedges is work with no visible result.
   */
  tilt?: number
  /** Rendered size. The app's two wheels scale with their box and pass neither. */
  width?: number
  height?: number
  className?: string
  style?: CSSProperties
  /**
   * Announced as one image, since that is what a wheel is to a screen reader.
   *
   * Omitted for a decorative wheel, which leaves the SVG unlabelled for an
   * ancestor's `aria-hidden` to cover.
   */
  label?: string
}

/**
 * The whole `<svg>`, not just its contents.
 *
 * **The element is here rather than with each caller because of Satori.** It
 * does not invoke function components inside an `<svg>` subtree — it takes that
 * subtree as markup to serialise — so a `<WheelDisc/>` under a caller's own
 * `<svg>` produced no error and no wedges, just an empty disc on a share card
 * already sitting in Slack's cache. Everything below this element is therefore
 * plain SVG, and anything a caller needs to put ON the element arrives as a
 * prop.
 *
 * Two more shapes here are Satori's doing, and fail as quietly. The drawing is
 * wrapped in one `<g>` rather than returned as a fragment, of which Satori
 * renders only the first child. And a wedge is a bare `<path>` unless it has a
 * label to carry, so that the common case does not nest a group inside that one.
 * `<g>` is inert in SVG and preserves child order, which is the whole of the
 * stacking here — SVG has no z-index.
 */
export function WheelDisc({
  slices,
  surface,
  accent,
  tilt,
  width,
  height,
  className,
  style,
  label,
}: WheelDiscProps) {
  const fill = surface ?? 'var(--color-neutral-100)'

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={width}
      height={height}
      className={className}
      style={style}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      <g transform={tilt ? `rotate(${tilt} ${CENTER} ${CENTER})` : undefined}>
        {/* Behind the wedges, so their white stroke has something to sit on
          rather than half-fading into the page. A stroke straddles its path, so
          without this the rim would be a half-width of white over whatever is
          behind the SVG. */}
        <circle cx={CENTER} cy={CENTER} r={BACKDROP_RADIUS} fill={fill} />

        {slices.map((slice, index) => {
          // Edge to edge, with nothing between them. The wedges were stroked
          // white for a while; the mark has never had dividers and the two
          // read as one thing without them.
          const wedge = {
            d: wedgePath(index, slices.length),
            fill: sliceColors(slice.palette).fill,
          }
          const key = slice.key ?? index

          // A group only when there is something to group with. See the note
          // above: the wheel page has labels and renders in a browser; the card
          // has neither.
          return slice.content ? (
            <g key={key}>
              <path {...wedge} />
              {slice.content}
            </g>
          ) : (
            <path key={key} {...wedge} />
          )
        })}

        {/* Over the wedge points, which would otherwise converge into a muddy
          spike of overlapping white strokes at the centre. */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={HUB_RADIUS}
          fill={fill}
          stroke={accent ?? 'var(--color-accent-500)'}
          strokeWidth={HUB_STROKE}
        />
      </g>
    </svg>
  )
}

/**
 * The Spinnerly mark: four quarters of the wheel with a white ring cut into
 * them.
 *
 * The same drawing in four places — the landing header, the wheel page's
 * header, both share cards, and the favicon — where it used to be a
 * `conic-gradient` in two of them, an inset box-shadow for the ring, and a
 * separate copy of the quarter sequence in each file. Neither of those
 * techniques survives Satori, and the sequence had already drifted: one mark
 * closed on the teal and another on the purple.
 *
 * **Cropped to the wedges rather than sharing the wheel's viewBox.** The wheel
 * leaves `VIEWBOX - 2 * RADIUS` of margin for its rim, which a mark has no use
 * for — at favicon size that margin is a wasted pixel on every side and the
 * mark reads as too small for its box.
 *
 * The ring is the prototype's `inset 0 0 0 5px` at 38px. A circle stroked inset
 * by half its own width lands in the same place, and unlike a box-shadow it is
 * a thing Satori can draw.
 */
export function WheelMark({
  size,
  className,
  surface = 'var(--color-neutral-100)',
}: {
  size?: number
  className?: string
  surface?: string
}) {
  const diameter = RADIUS * 2
  const ring = diameter * (5 / 38)

  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox={`${CENTER - RADIUS} ${CENTER - RADIUS} ${diameter} ${diameter}`}
    >
      {BRAND_MARK_SLICES.map((palette, index) => (
        <path
          key={palette}
          d={wedgePath(index, BRAND_MARK_SLICES.length)}
          fill={sliceColors(palette).fill}
        />
      ))}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={RADIUS - ring / 2}
        fill="none"
        stroke={surface}
        strokeWidth={ring}
      />
    </svg>
  )
}

/**
 * The pointer, for the two surfaces that render in a browser.
 *
 * A CSS triangle — a zero-sized box with two transparent borders — as the
 * prototype draws it. Give the box dimensions and the borders stop meeting at a
 * point.
 *
 * **Outside the disc's `<svg>`, and that is structural rather than tidy:**
 * everything inside that element rotates, so a pointer drawn in there would spin
 * along with the wedges it exists to indicate.
 *
 * The Open Graph card cannot use this one. Satori's handling of a
 * transparent-border triangle is not something to bet a cached share card on, so
 * it draws a polygon from the same three constants — see app/og/wheel.tsx.
 */
export function WheelPointer() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: -POINTER_RISE,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 0,
        height: 0,
        borderLeft: `${POINTER_WIDTH / 2}px solid transparent`,
        borderRight: `${POINTER_WIDTH / 2}px solid transparent`,
        borderTop: `${POINTER_HEIGHT}px solid var(--color-accent-600)`,
        zIndex: 2,
        filter: `drop-shadow(${POINTER_SHADOW})`,
      }}
    />
  )
}
