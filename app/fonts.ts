import { Caprasimo, Figtree } from 'next/font/google'

/**
 * Organic pairs a display face for headings with a workhorse sans for body
 * copy. The prototype loads both from the Google Fonts CDN with a
 * render-blocking `@import`; `next/font` self-hosts them instead, so there is
 * no third-party request and no layout shift.
 *
 * The `variable` names are consumed by `--font-heading` / `--font-body` in
 * theme.css, which add the fallback chain. Nothing should reference these two
 * directly.
 */

export const headingFont = Caprasimo({
  // Caprasimo ships a single weight; it is not a variable font.
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-heading-src',
})

export const bodyFont = Figtree({
  // Variable font spanning 300-900, which covers the 400/600/700 the
  // prototype uses without shipping three static files.
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body-src',
})

export const fontVariables = `${headingFont.variable} ${bodyFont.variable}`
