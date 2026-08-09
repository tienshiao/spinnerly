/**
 * The wheel slice palette.
 *
 * Deliberately not a set of theme tokens: these are a data palette indexed by
 * option position, so a wheel's Nth slice is always the Nth colour. They are
 * chosen for maximum adjacent-slice separation on a spinning disc, which is a
 * different job from the semantic accent ramps in theme.css.
 *
 * `SLICE[i]` is the fill and `INK[i]` is the label colour that meets contrast
 * on it — the two arrays are parallel and must stay the same length. Index by
 * `i % SLICE.length` so wheels with more than ten options wrap.
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
 * An even conic gradient built from palette indices — the brand mark, and the
 * landing page's decorative discs.
 *
 * Goes through `sliceColors` rather than indexing `SLICE` directly. Indexing a
 * tuple with a plain `number` widens to `string`, so an out-of-range index
 * would type-check, lint clean, and then emit
 * `conic-gradient(undefined 0 12.5%, …)` — which the browser discards as an
 * invalid declaration, leaving a blank transparent disc with no console error
 * and no build failure. `sliceColors` already wraps for exactly this reason.
 */
export function conicFromPalette(indices: readonly number[]): string {
  const stops = indices.map(
    (paletteIndex, i) =>
      `${sliceColors(paletteIndex).fill} 0 ${((i + 1) / indices.length) * 100}%`,
  )
  return `conic-gradient(${stops.join(', ')})`
}

/** Fill and label colour for the option at position `index`, wrapping. */
export function sliceColors(index: number): { fill: string; ink: string } {
  // Truncate before the modulo: a fractional or NaN index would otherwise pass
  // through it unchanged and miss both arrays, returning undefined twice.
  const n = Number.isFinite(index) ? Math.trunc(index) : 0
  const i = ((n % PALETTE_LENGTH) + PALETTE_LENGTH) % PALETTE_LENGTH
  return { fill: SLICE[i], ink: INK[i] }
}
