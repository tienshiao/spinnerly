import { ImageResponse } from 'next/og'

import { MarketingCard } from './og/cards'
import { OG_FONTS } from './og/fonts'
import { OG_SIZE } from './og/theme'

/**
 * The site card, for a link to the root rather than to a wheel.
 *
 * Every route without an `opengraph-image` of its own inherits this one, so it
 * is what `/` unfurls as — and it is the fallback the whole app sits on if a
 * segment is ever added without its own card.
 *
 * **Static**: no params, no data, no request-time API, so Next prerenders it at
 * build time and serves a fixed PNG. That is the difference between this card
 * and the one under w/[shareId]/, and the reason this one has no error path —
 * there is nothing here that can fail at request time.
 *
 * Generated rather than committed as a .png so it cannot drift from the theme:
 * the colours come from app/og/theme.ts and the wheel from the same geometry
 * the app draws with, so retuning either updates this card with the next build.
 */

export const alt = 'Spinnerly — stop debating, spin for it'
export const size = OG_SIZE
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(<MarketingCard />, { ...size, fonts: OG_FONTS })
}
