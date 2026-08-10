/**
 * The wheel slice palette.
 *
 * Deliberately not a set of theme tokens: these are a data palette indexed by
 * option position, so a wheel's Nth slice is always the Nth colour. They are
 * chosen for maximum adjacent-slice separation on a spinning disc, which is a
 * different job from the semantic accent ramps in theme.css.
 *
 * `SLICE[i]` is the fill and `INK[i]` is the label colour that meets contrast
 * on it — the two arrays are parallel and must stay the same length. **Never
 * index them directly: go through `sliceColors`**, which owns the one rule that
 * makes a wheel of any size legible — see `paletteIndex` for what it is and why
 * a plain `i % SLICE.length` is not it.
 *
 * Values are verbatim from the prototype
 * (docs/spin-the-wheel-editor/project/Wheel.dc.html).
 */

export const SLICE = [
  '#f2545b',
  '#ffc23c',
  '#3fa7d6',
  '#7d5ba6',
  '#2ec4a3',
  '#ff7f51',
  '#4a6cf7',
  '#ff5fa2',
  '#8ed44a',
  '#00b3b3',
] as const

export const INK = [
  '#ffffff',
  '#4f3400',
  '#ffffff',
  '#ffffff',
  '#0d3b33',
  '#4f1a08',
  '#ffffff',
  '#ffffff',
  '#20390d',
  '#ffffff',
] as const

/** How many distinct slice colours exist, before wrapping.
 *
 *  The annotation is load-bearing: both sides are literal types, so if a
 *  colour is added to one array and not the other this stops compiling. That
 *  is the only thing keeping `sliceColors` honest about returning a `string`
 *  for `ink` — an unpaired `SLICE` entry would otherwise yield `undefined`. */
export const PALETTE_LENGTH: typeof INK.length = SLICE.length

/**
 * The decorative wheel: eight wedges, and the exact sequence the prototype uses.
 *
 * Explicit indices rather than `[...Array(8).keys()]` because the sequence skips
 * `SLICE[7]` (the pink) and closes on `SLICE[8]` (the green). Shared by the
 * landing hero and the Open Graph marketing card, which is the whole reason it
 * is here rather than in either of them — the two drew visibly different wheels
 * while both were "eight slices of the palette".
 */
export const DECORATIVE_SLICES = [0, 1, 2, 3, 4, 5, 6, 8] as const

/**
 * The Spinnerly mark: four quarters, in the prototype's order.
 *
 * Also shared, and for the same reason. The mark is on the landing header and on
 * both share cards, and closing on `SLICE[4]` rather than `SLICE[3]` is the
 * difference between the teal quarter the design has and a purple one nobody
 * chose.
 */
export const BRAND_MARK_SLICES = [0, 1, 2, 4] as const

/**
 * Which palette entry the slice at `position` takes.
 *
 * **The first colour is reserved for the first slice, and the other nine cycle
 * for everything after it.** That is what stops a wheel meeting itself: the last
 * slice is adjacent to the first, so a plain `position % 10` collides whenever
 * the count is one past a multiple of ten — 11, 21, 31, 41 — and puts `SLICE[0]`
 * beside `SLICE[0]`. The two then read as a single double-width slice with two
 * labels on it. A white divider used to hide that; the wedges now meet edge to
 * edge, so it shows.
 *
 * Reserving the first colour is the only fix that needs no new colours, because
 * the collision is structural rather than a matter of palette size: with any
 * mapping that depends on position alone and repeats every P, the seam collides
 * whenever `count ≡ 1 (mod P)`. Twenty colours would move the bad counts from
 * four to two, not to none — clearing them that way needs more distinct colours
 * than a wheel can hold. Making `SLICE[0]` unreachable after position 0 makes
 * the seam unable to match the first slice at any count at all.
 *
 * **Identity for positions 0 to 9**, which is what keeps this cheap: no wheel of
 * ten options or fewer changes colour, and neither does anything that indexes
 * the palette directly — `DECORATIVE_SLICES`, `BRAND_MARK_SLICES`, the landing
 * page's avatar row. Only position 10 and beyond shift by one.
 *
 * The cost, stated: colours repeat every nine after the first rather than every
 * ten, and `SLICE[0]` appears exactly once on any wheel while the others appear
 * as often as the count requires. Nobody counts, and a distinct first slice is
 * arguably worth having.
 */
function paletteIndex(index: number): number {
  // Truncated before anything else: a fractional or NaN index would otherwise
  // pass through the modulo unchanged and miss both arrays, returning undefined
  // twice. A negative position is not a thing a wheel has — folding it onto the
  // first colour keeps this total rather than inventing a meaning for it.
  const position = Number.isFinite(index) ? Math.trunc(index) : 0
  if (position <= 0) return 0

  return 1 + ((position - 1) % (PALETTE_LENGTH - 1))
}

/** Fill and label colour for the slice at `index`. See `paletteIndex`. */
export function sliceColors(index: number): { fill: string; ink: string } {
  const i = paletteIndex(index)
  return { fill: SLICE[i], ink: INK[i] }
}
