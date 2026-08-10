/**
 * Who the site says it is, and where it says it lives.
 *
 * Small, and separate from app/og/preview.ts on purpose: that module is about
 * what an unfurl says about a *wheel*, while these three are facts about the
 * product that the root layout, the landing card and the wheel card all state.
 * Free of `server-only` and of anything Firestore, so a client component can
 * import the name without pulling a route's worth of dependencies behind it.
 */

export const SITE_NAME = 'Spinnerly'

/** The one-line pitch. Also the site's `og:description` and the landing card's. */
export const SITE_TAGLINE =
  'Build a wheel, share the link, let the room watch it land.'

/**
 * The origin that `metadataBase` resolves relative metadata URLs against.
 *
 * It has to be absolute and it has to be right: `og:image` is fetched by a
 * crawler that has no page context to resolve a relative path against, so a
 * wrong origin here is an unfurl with no picture — and crawlers cache that
 * result against the share URL exactly as they cache a good one.
 *
 * Three sources, most explicit first:
 *
 *  - `NEXT_PUBLIC_SITE_URL`, set per environment in the Vercel dashboard
 *    (TASK-25). The override that always wins, and the only one that knows
 *    about a custom domain before Vercel does.
 *  - **On Vercel, whichever host this deployment actually answers on.** In
 *    production that is `VERCEL_PROJECT_PRODUCTION_URL`, the project's stable
 *    hostname — not `VERCEL_URL`, which is the immutable per-deployment host and
 *    would mint a fresh `og:image` URL on every push, cache-busting the one
 *    thing this app wants cached, while naming a `*.vercel.app` host rather than
 *    the domain people paste links from. Anywhere else — a preview, a branch
 *    deploy — it is `VERCEL_URL`, because the production hostname is set on
 *    those builds too and using it there is a quiet, specific bug: a wheel
 *    created on a preview deployment would advertise its card at
 *    `https://production/w/{shareId}/opengraph-image`, where that wheel does not
 *    exist. Production serves the generic card, and the crawler caches it
 *    against the preview link.
 *  - localhost, for `npm run dev`. Wrong in production, which is why the two
 *    above exist, but harmless locally where no crawler is looking.
 *
 * Throws on an unparseable override rather than falling back. A typo in this
 * variable should stop a deployment, not produce a site whose every share card
 * quietly points at localhost.
 */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) {
    try {
      return new URL(explicit)
    } catch {
      throw new Error(
        `NEXT_PUBLIC_SITE_URL is not a valid absolute URL: ${explicit}. ` +
          'It needs a scheme — https://spinnerly.example, not spinnerly.example.',
      )
    }
  }

  const vercel =
    process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL
  if (vercel) return new URL(`https://${vercel}`)

  return new URL(`http://localhost:${process.env.PORT ?? 3000}`)
}
