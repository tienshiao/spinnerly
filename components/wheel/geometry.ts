/**
 * The wheel's geometry, as arithmetic. No React, no DOM, no `'use client'`.
 *
 * Every number here is verbatim from the prototype's script block
 * (docs/spin-the-wheel-editor/project/Wheel.dc.html), which is the visual
 * reference this task was asked to recreate.
 *
 * Separate from ./wheel.tsx rather than inline in it for one concrete reason:
 * TASK-23 renders the same wheel server-side into an Open Graph image, and a
 * `'use client'` module is the wrong thing for that code to reach into. Keeping
 * the arithmetic in a file with no directive means the image generator imports
 * exactly this and draws the same wedges, instead of a second implementation
 * that agrees with this one only for as long as somebody keeps them in step.
 *
 * It also means the geometry unit-tests under `npm test` with no jsdom — the
 * angle work is where the bugs are, and none of it needs a browser to check.
 *
 * Deliberately NOT in lib/wheels/. That directory is the client *data* path —
 * six modules, listed in CLAUDE.md, running from Firestore document to rendered
 * state. Wedge angles are not on it.
 */

/**
 * The SVG coordinate space. `0 0 400 400`, so the wheel scales with its
 * container and every number below is in viewBox units rather than pixels.
 */
export const VIEWBOX = 400

/** Centre of the disc, on both axes. */
export const CENTER = 200

/** Radius of the coloured wedges. */
export const RADIUS = 190

/**
 * A white disc behind the wedges, eight units proud of them.
 *
 * It is what gives the wheel its rim: the wedges are stroked white at
 * `WEDGE_STROKE`, and a stroke straddles the path rather than sitting inside
 * it, so the outer edge of the arc would otherwise be a half-width of white
 * fading into whatever is behind the SVG. The backdrop makes that deliberate.
 */
export const BACKDROP_RADIUS = 198

/** The white hub sitting on top of the wedge points. */
export const HUB_RADIUS = 34

/** White, and 3 units wide, between adjacent wedges. */
export const WEDGE_STROKE = 3

/** The hub's accent ring. */
export const HUB_STROKE = 5

/**
 * Where a label sits, as a fraction of `RADIUS`.
 *
 * 0.62 rather than 0.5 because a wedge is a triangle-ish sliver that gets wider
 * the further out you go, so the widest place to put a horizontal run of text
 * is well outside the midpoint — but not so far that a long label collides with
 * the rim.
 */
export const LABEL_RADIUS_RATIO = 0.62

/**
 * Labels longer than this are truncated to `LABEL_TRUNCATE` plus an ellipsis.
 *
 * The gap between the two is not an off-by-one: a label of exactly 18 renders
 * whole, and 19 becomes 17 characters and a `…` — so truncating never makes a
 * label *longer* than leaving it alone would have. Prototype behaviour.
 */
export const LABEL_MAX = 18

/** How much of an over-long label survives, before the ellipsis. */
export const LABEL_TRUNCATE = 17

/**
 * Where the pointer sits, in SVG degrees: straight up.
 *
 * SVG angles run clockwise from east, so up is -90. Every angle below is
 * shifted by that constant, which is what puts the first wedge's leading edge
 * at twelve o'clock and lets a rotation of zero be the wheel's rest position.
 */
export const POINTER_ANGLE = -90

/** How many full turns a spin makes before it starts hunting for its wedge. */
const SPIN_TURNS = 6

const TAU_DEGREES = 360

/** Degrees, normalised into `[0, 360)`. Negative inputs included. */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % TAU_DEGREES) + TAU_DEGREES) % TAU_DEGREES
}

/**
 * The angular width of one wedge, in degrees.
 *
 * `Math.max(count, 1)` guards the empty wheel: a zero count would make this
 * `Infinity` and every coordinate derived from it `NaN`, which SVG renders as
 * nothing at all — no error, just a blank disc.
 *
 * The guard is load-bearing rather than merely defensive, because ./wheel.tsx
 * does call the per-wedge functions with no wedges: an empty wheel is drawn as
 * `wedgePath(0, 0)`, which the floor turns into the same full disc a
 * single-option wheel gets. Removing it would not throw — it would silently
 * draw nothing.
 */
export function segmentAngle(count: number): number {
  return TAU_DEGREES / Math.max(count, 1)
}

/** The angle, in SVG degrees, of the middle of wedge `index`. */
export function midAngle(index: number, count: number): number {
  const segment = segmentAngle(count)
  return index * segment + segment / 2 + POINTER_ANGLE
}

/**
 * The `d` attribute for wedge `index` of `count`: centre, out to the arc,
 * around, and closed back to the centre.
 *
 * Coordinates are fixed to two decimals, as the prototype does. That is not
 * cosmetic — it keeps the string stable, which is what makes the exact-path
 * assertions in the test suite readable rather than a wall of floating-point
 * noise, and it keeps React from rewriting the attribute over a difference in
 * the fifteenth digit.
 *
 * **The single-option wheel is a special case, and the obvious code for it
 * renders nothing at all.** With one option the wedge is the whole disc, so the
 * arc's start and end points coincide — and SVG defines an arc with identical
 * endpoints as equivalent to omitting the segment entirely (SVG 1.1 F.6.2).
 * The large-arc flag does not rescue it: the renderer is not choosing the short
 * way round, it is declining to draw an arc at all. What is left is a
 * degenerate line from the centre to twelve o'clock, so the wheel comes out as
 * a bare white disc with a white label invisible on top of it.
 *
 * The prototype has this defect; it is only ever shown with six options, so
 * nobody met it. Two half-turn arcs describe the same circle with distinct
 * endpoints and draw correctly. No spoke back to the centre, because the
 * boundary between the only wedge and itself is not a real edge.
 */
export function wedgePath(index: number, count: number): string {
  const segment = segmentAngle(count)

  if (segment >= 360) {
    return (
      `M ${CENTER} ${CENTER - RADIUS} ` +
      `A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER + RADIUS} ` +
      `A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER - RADIUS} Z`
    )
  }

  const from = ((index * segment + POINTER_ANGLE) * Math.PI) / 180
  const to = (((index + 1) * segment + POINTER_ANGLE) * Math.PI) / 180

  const x0 = CENTER + RADIUS * Math.cos(from)
  const y0 = CENTER + RADIUS * Math.sin(from)
  const x1 = CENTER + RADIUS * Math.cos(to)
  const y1 = CENTER + RADIUS * Math.sin(to)

  // Always 0 past the guard above: two options give a segment of exactly 180,
  // which is a half-turn either way round, and every larger count is smaller
  // still. Written as a literal rather than a `segment > 180` test that can
  // never be true, so the one case that does exceed a half-turn stays visible
  // as the branch above rather than hiding in a flag nobody sets.
  return (
    `M ${CENTER} ${CENTER} L ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
    `A ${RADIUS} ${RADIUS} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
  )
}

export type LabelPlacement = {
  x: number
  y: number
  /** Ready for the `transform` attribute. */
  transform: string
  /** Whether the second rotation was applied. Exposed for the tests. */
  flipped: boolean
}

/**
 * Where wedge `index`'s label goes, and how it is turned.
 *
 * The text is laid out horizontally at `(CENTER + 0.62R, CENTER)` — due east of
 * the hub — and then rotated about the centre onto its wedge. That is why `y`
 * is always `CENTER`: the rotation is what carries it round, not the
 * coordinates.
 *
 * **The flip is the part worth reading.** A label on the left half of the
 * wheel arrives upside down, because the rotation that put it there passed
 * through 180 degrees. A second rotation, about the label's own position rather
 * than the wheel's centre, turns it back the right way up without moving it.
 * The predicate is the *normalised* midangle strictly inside (90, 270) — the
 * open interval matters at the boundaries, where a label is vertical and either
 * orientation reads the same, so flipping would be churn for no gain.
 */
export function labelPlacement(index: number, count: number): LabelPlacement {
  const mid = midAngle(index, count)
  const normalized = normalizeDegrees(mid)
  const flipped = normalized > 90 && normalized < 270
  const x = CENTER + RADIUS * LABEL_RADIUS_RATIO

  return {
    x,
    y: CENTER,
    transform:
      `rotate(${mid} ${CENTER} ${CENTER})` +
      (flipped ? ` rotate(180 ${x} ${CENTER})` : ''),
    flipped,
  }
}

/**
 * A label, shortened to fit its wedge.
 *
 * Counted in CODE POINTS rather than UTF-16 units, which is the one place this
 * module departs from the prototype's `.slice(0, 17)`. An astral character —
 * an emoji, most of CJK Extension B — is two units, so a plain slice can cut
 * one in half and leave a lone surrogate, which renders as `<66>`. Labels are
 * arbitrary user text with `OPTION_LABEL_MAX` at 60, so this is reachable
 * rather than theoretical, and it is the same argument lib/wheels/validation.ts
 * already makes against measuring user text with `.length`.
 *
 * Still not grapheme clusters: a family emoji or a flag is several code points
 * joined by zero-width joiners and this will split one. Doing better means
 * `Intl.Segmenter` and a judgement about what "17 characters" means for a
 * string that renders as three glyphs. The cheap fix removes the broken
 * character; the expensive one argues about typography, and a wedge label is
 * not where that argument pays.
 */
export function truncateLabel(label: string): string {
  const points = Array.from(label)
  if (points.length <= LABEL_MAX) return label
  return points.slice(0, LABEL_TRUNCATE).join('') + '…'
}

/**
 * The rotation to animate to, so that wedge `index` finishes under the pointer.
 *
 * Three terms, and each is doing something:
 *
 *  - `current - current % 360` discards the fraction of a turn the wheel is
 *    already sitting at, so the offset below is measured from a whole turn
 *    rather than from wherever the last spin happened to stop.
 *  - `+ 360 * SPIN_TURNS` is the show. It is also what makes the result feel
 *    unpredictable: six turns at this easing is long enough that nobody tracks
 *    which wedge is which.
 *  - the offset brings the chosen wedge's midpoint to the pointer. Wedge
 *    `index` sits at `midAngle`, the pointer is at `POINTER_ANGLE`, so the
 *    wheel must turn by `POINTER_ANGLE - midAngle`, normalised into a forward
 *    turn so the wheel never visibly runs backwards.
 *
 * **Always increasing, and that is load-bearing.** The CSS transition animates
 * from the current value to this one, so a target that went *down* would spin
 * the wheel anticlockwise, and a target equal to the current value would not
 * animate at all — the second spin of a two-option wheel that landed on the
 * same option. Truncating to a whole turn and then adding six guarantees a
 * minimum of five full turns of travel whatever the offset works out to.
 */
export function targetRotation(
  current: number,
  index: number,
  count: number,
): number {
  const whole = current - (current % TAU_DEGREES)
  const offset = normalizeDegrees(POINTER_ANGLE - midAngle(index, count))
  return whole + TAU_DEGREES * SPIN_TURNS + offset
}
