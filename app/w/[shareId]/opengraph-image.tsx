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
 * What a card that came out RIGHT is served with — and it is deliberately the
 * value Next was already sending, restated rather than chosen.
 *
 * Constructing the response by hand (see below) means nothing writes a
 * `Cache-Control` for us any more, so leaving this out would silently drop the
 * route to no header at all and let every intermediary apply its own default.
 * Matching `next-metadata-route-loader`'s `CACHE_HEADERS.REVALIDATE` keeps the
 * caching behaviour of this route exactly what it was before the render
 * changed.
 *
 * **There is a longer story here and it is a correction.** The compiled
 * @vercel/og bundle sets `public, immutable, no-transform, max-age=31536000` in
 * production, and this file briefly carried a ten-minute TTL justified by
 * "otherwise a failed read is pinned for a year". That justification was wrong:
 * Next's metadata route layer replaces @vercel/og's header, so the immutable
 * value never reaches a client. Measured on a production build of the code as
 * it stood before that change — `public, max-age=0, must-revalidate`, not the
 * year. What made the mistake stick was a coincidence: the dev server answers
 * `no-cache, no-store`, which is @vercel/og's development string AND Next's own
 * `CACHE_HEADERS.NO_CACHE`, so seeing it looked like proof that @vercel/og's
 * header was the one getting through. It was not evidence of anything.
 *
 * Do not "restore" a longer TTL here without measuring a real deployment
 * first. A cached card cannot be corrected (design doc section 3), so the bias
 * on this route runs towards revalidating, not towards saving a read.
 */
const CARD_CACHE = 'public, max-age=0, must-revalidate'

/**
 * A card built from a FAILED READ is not stored at all.
 *
 * This is the one place the header genuinely departs from what Next would send,
 * and it is a small claim rather than the large one above: `must-revalidate`
 * already prevents a stale generic card being served without a check, so what
 * `no-store` adds is only that nothing keeps a copy to revalidate. The card is
 * a placeholder for a wheel we could not read; there is nothing in it worth
 * holding, and re-reading is the cheapest correct thing.
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
   * **Rendered to bytes here rather than handed back as an `ImageResponse`.**
   *
   * This, and not the header above, is what this route was rewritten for.
   * `new ImageResponse(...)` returns at once: satori and resvg run inside the
   * body's `ReadableStream`, which is to say AFTER the 200 and the headers have
   * gone out. A throw in there cannot fall back to anything — it aborts the
   * stream, and what a crawler receives is a truncated PNG, cached as the
   * wheel's picture. Awaiting the bytes moves that work in front of the
   * response, so a failure is still a decision we get to make.
   *
   * It is not a theoretical failure. @vercel/og resolves an emoji by fetching
   * it from cdn.jsdelivr.net at render time, and unlike the CJK font branch
   * directly beside it that fetch is not wrapped — so any wheel whose title
   * carries an emoji depends on a third-party CDN answering, mid-render.
   * Verified by giving a wheel an emoji title and watching the glyph appear on
   * the card, which is only possible if that fetch happened.
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
 * **The two draw the same card and are not owed the same cache policy.** Design
 * doc section 3 and `wheelMetadata` both argue that a viewer must not be told
 * which of the two happened — "this wheel has expired" pinned into a crawler's
 * cache by one failed read would describe a live wheel as gone. That argument
 * is about the WORDS, and it still stands. Caching is a separate question: an
 * absent wheel is a settled fact, and a failed read is not a fact at all.
 * Keeping them apart costs one type and makes `no-store` expressible.
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
