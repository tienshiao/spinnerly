import { ImageResponse } from 'next/og'

import { WheelCard } from '@/app/og/cards'
import { OG_FONTS } from '@/app/og/fonts'
import { OG_SIZE } from '@/app/og/theme'
import type { WheelPreview } from '@/lib/wheels/model'
import { readWheelPreview } from '@/lib/wheels/store'

/**
 * `/w/{shareId}/opengraph-image` — the unfurl a pasted share link produces.
 *
 * **This route is why the project uses a framework at all** (design doc section
 * 3). Slack, Discord, iMessage and Twitter fetch a URL and read its `<head>`;
 * none of them runs JavaScript. Without this and the `generateMetadata` beside
 * it, every wheel ever created would unfurl as the same generic card.
 *
 * The image is built to survive being wrong. Crawlers cache an unfurl against
 * the share URL — the exact string people paste — and do not come back when the
 * wheel changes, so there is no cache-busting move available. Everything drawn
 * here is therefore title, count and a decorative disc; ./page.tsx's metadata
 * follows the same rule, and app/og/preview.ts is where both get their words.
 */

/**
 * Pinned even though Next 16 already defaults to it, matching every route that
 * reaches Firestore. `spinnerly/require-nodejs-runtime` does not fire on this
 * file — the Admin SDK arrives through lib/wheels/store.ts rather than by a
 * direct import — so the line is here by intent rather than by lint. The Admin
 * SDK uses gRPC over native bindings and cannot run on the Edge Runtime.
 */
export const runtime = 'nodejs'

/**
 * Static, because Next only accepts a literal here — `og:image:alt` is one
 * value for the route, not one per wheel. It describes what the picture *is*,
 * which is the honest thing for a card whose specifics may be cached stale
 * anyway. The wheel's own title reaches the unfurl through `og:title`.
 */
export const alt = 'A Spinnerly wheel, waiting to be spun'

export const size = OG_SIZE
export const contentType = 'image/png'

export default async function Image({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const { shareId } = await params

  return new ImageResponse(<WheelCard preview={await preview(shareId)} />, {
    ...size,
    fonts: OG_FONTS,
  })
}

/**
 * The wheel, or `null` if it cannot be read.
 *
 * `readWheelPreview` already answers `null` for a wheel that is not there; the
 * catch is for the other kind of failure — a Firestore call that times out,
 * credentials that are not configured on a preview deployment. **Both must end
 * as the generic card rather than as a throw**, because a throw here is a 500
 * on the image URL, and a crawler that gets one caches the unfurl with a broken
 * image against a share link that will keep being pasted.
 */
async function preview(shareId: string): Promise<WheelPreview | null> {
  try {
    return await readWheelPreview(shareId)
  } catch (error) {
    console.error(`opengraph-image: could not read wheels/${shareId}.`, error)
    return null
  }
}
