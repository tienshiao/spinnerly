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

/**
 * How long a card that came out RIGHT may be held.
 *
 * Modest on purpose. A crawler caches the unfurl against the share URL and
 * never comes back, so a longer TTL here buys nothing where it matters — it
 * only decides how often a re-paste, a preview expander or a second platform
 * costs a Firestore read. Ten minutes keeps that cheap while letting a wheel
 * that has just been filled in unfurl as itself to the next person who pastes
 * it.
 */
const CARD_CACHE = 'public, max-age=600, stale-while-revalidate=3600'

/**
 * And how long a card built from a FAILURE may be held: not at all.
 *
 * This is the whole point of choosing the header rather than accepting the one
 * `ImageResponse` writes, which in production is
 * `public, immutable, no-transform, max-age=31536000`. A single Firestore
 * timeout, or a deployment whose credentials are not configured yet, renders
 * the generic card — and `immutable` then pins that card at the CDN and every
 * intermediary for a year. The route is never asked again, so the "it will be
 * right next time" this file is built around never arrives, on a product whose
 * design doc opens by saying a cached card cannot be corrected.
 *
 * `no-store` rather than a short `max-age`, because there is nothing here worth
 * keeping: the card is a placeholder for a wheel we failed to read, and the
 * cheapest correct thing is to read again.
 */
const FAILED_CACHE = 'no-store'

export default async function Image({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const { shareId } = await params
  const read = await preview(shareId)

  /**
   * **Rendered to bytes here rather than handed back as an `ImageResponse`, and
   * that is what makes everything above possible.**
   *
   * `new ImageResponse(...)` returns at once: satori and resvg run inside the
   * body's `ReadableStream`, which is to say AFTER the 200 and the headers have
   * gone out. A throw in there cannot fall back to anything and cannot change a
   * header — it aborts the stream, and what a crawler receives is a truncated
   * PNG. Awaiting the bytes moves that work in front of the response, so a
   * failure is still a decision we get to make.
   *
   * It is not a theoretical failure. @vercel/og resolves an emoji by fetching
   * it from cdn.jsdelivr.net at render time, and unlike the CJK font branch
   * directly beside it that fetch is not wrapped — so any wheel whose title
   * carries an emoji depends on a third-party CDN answering, mid-render.
   *
   * The cost is that the PNG is buffered rather than streamed. At 1200x630 that
   * is tens of kilobytes and no crawler is rendering it progressively.
   */
  try {
    return png(
      await render(read.ok ? read.preview : null),
      read.ok ? CARD_CACHE : FAILED_CACHE,
    )
  } catch (error) {
    console.error(`opengraph-image: could not draw wheels/${shareId}.`, error)

    /**
     * One retry, with everything the wheel contributed taken away.
     *
     * Nearly every way this throws is the wheel's own text — an emoji whose
     * asset would not load, a glyph no bundled font covers — so the generic
     * card is not a lesser version of the same gamble, it is the one card that
     * has no user input in it at all. If even that fails the throw stands:
     * there is no PNG left to serve, and a 500 is at least not cached as though
     * it were the wheel's picture.
     */
    return png(await render(null), FAILED_CACHE)
  }
}

/** The card, as PNG bytes. Throws if satori or resvg refuses. */
async function render(preview: WheelPreview | null): Promise<ArrayBuffer> {
  return await new ImageResponse(<WheelCard preview={preview} />, {
    ...size,
    fonts: OG_FONTS,
  }).arrayBuffer()
}

function png(body: ArrayBuffer, cacheControl: string): Response {
  return new Response(body, {
    headers: { 'content-type': contentType, 'cache-control': cacheControl },
  })
}

/**
 * The wheel, and whether READING it worked.
 *
 * `ok: true, preview: null` is a wheel that is genuinely not there — reaped, or
 * a share ID that never existed. `ok: false` is a read that failed: a Firestore
 * call that timed out, credentials missing on a preview deployment.
 *
 * **The two draw the same card and must not share a cache policy.** Design doc
 * section 3 and `wheelMetadata` both argue that a viewer must not be told which
 * of the two happened — "this wheel has expired" pinned into a crawler's cache
 * by one failed read would describe a live wheel as gone. That argument is
 * about the WORDS. Caching is the opposite: an absent wheel is a settled fact
 * worth keeping for a while, and a failed read is the one answer that must
 * never be kept at all. Collapsing them to `null`, as this did, made the
 * failure indistinguishable at exactly the point where the difference decides
 * whether the mistake is permanent.
 */
type Read =
  | { ok: true; preview: WheelPreview | null }
  | { ok: false; preview?: undefined }

async function preview(shareId: string): Promise<Read> {
  try {
    return { ok: true, preview: await readWheelPreview(shareId) }
  } catch (error) {
    console.error(`opengraph-image: could not read wheels/${shareId}.`, error)
    return { ok: false }
  }
}
