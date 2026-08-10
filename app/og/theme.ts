/**
 * The Organic palette, restated as plain hex for Satori.
 *
 * A duplicate of the tokens in app/theme.css, and unavoidably so: `next/og`
 * renders through Satori, which has no stylesheet, no cascade and no CSS custom
 * properties. `var(--color-accent)` in one of these cards is not a colour that
 * fails to resolve — it is a string Satori cannot parse, and the element is
 * dropped or drawn black.
 *
 * Only the values these two cards actually use are here. Adding the whole ramp
 * would make this look like a second source of truth for the theme, which it is
 * not: theme.css is where a colour changes, and this file follows it by hand.
 *
 * The one value that is not a copy is `divider`. theme.css builds it with
 * `color-mix(in srgb, #26252c 14%, transparent)`, which Satori also cannot
 * parse, so it is pre-mixed here as the rgba it evaluates to.
 */
export const OG = {
  bg: '#f7f6fb',
  surface: '#ffffff',
  text: '#26252c',
  accent: '#f2545b',
  /** `--color-accent-600`. The pointer, which is a shade darker than the hub. */
  accent600: '#d93b45',
  neutral200: '#f1f0f6',
  neutral600: '#7d7a8c',
  neutral700: '#5c5a68',
  accent200: '#ffdcdd',
  accent2_200: '#cfeaf9',
  accent2_800: '#144964',
  divider: 'rgba(38, 37, 44, 0.14)',
} as const

/**
 * The card, in pixels. 1200x630 is the Open Graph size every crawler in design
 * doc section 3 expects, and both `opengraph-image` routes re-export it as
 * their `size` so the meta tags cannot disagree with the bitmap.
 */
export const OG_SIZE = { width: 1200, height: 630 } as const

/** Font family names, spelled once so a card and `OG_FONTS` cannot drift. */
export const OG_FONT = {
  heading: 'Caprasimo',
  body: 'Figtree',
} as const
