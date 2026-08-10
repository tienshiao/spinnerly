import { ImageResponse } from 'next/og'

import { WheelMark } from '@/components/wheel/disc'

/**
 * The favicon: the Spinnerly mark, the same one in both headers and on both
 * share cards.
 *
 * Generated rather than committed as a .ico so it cannot drift from the mark it
 * is a copy of. `WheelMark` takes its quarters from `BRAND_MARK_SLICES` and its
 * geometry from components/wheel/geometry.ts, so retuning either updates the tab
 * icon with the next build. It is static — no data, no request-time API — so
 * Next renders it once at build.
 *
 * 32 square, which is a tab icon at 2x on the displays anyone reading this has.
 * No text, so unlike the Open Graph cards this needs no fonts.
 */

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    // Satori wants a box to lay out in; the mark fills it. The white here is
    // the ring cut into the quarters, not a background — everything outside
    // the disc stays transparent, which is what lets the icon sit on a dark
    // tab strip as readably as on a light one.
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <WheelMark size={size.width} surface="#ffffff" />
    </div>,
    size,
  )
}
