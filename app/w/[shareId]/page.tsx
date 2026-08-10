import type { Metadata } from 'next'

import { wheelMetadata } from '@/app/og/preview'
import { SITE_NAME } from '@/lib/site'
import { readWheelPreview } from '@/lib/wheels/store'

import { WheelPage } from './wheel-page'

/**
 * Pinned for the same reason every Firestore-reaching route pins it: the Admin
 * SDK is gRPC over native bindings and cannot run on the Edge Runtime. The
 * import is indirect — through lib/wheels/store.ts — so
 * `spinnerly/require-nodejs-runtime` does not fire here, and the line is a
 * statement of intent rather than a lint fix.
 */
export const runtime = 'nodejs'

/**
 * The `<head>` a crawler reads. Design doc section 3, and the other half of
 * ./opengraph-image.tsx.
 *
 * **Runs on the server, where the edit token does not exist**, which is the
 * happy version of the constraint that makes the rest of this page a client
 * component: the token lives in the URL fragment and is never sent, so pasting
 * an *edit* link into Slack unfurls it as an ordinary share preview and the
 * token never reaches Slack at all.
 *
 * The words come from app/og/preview.ts, which the image route also uses — a
 * card reading "6 options on the wheel" beside an `og:description` saying five
 * is a mismatch no local check would catch, because the two are read by
 * different programs.
 *
 * **A wheel that cannot be read is not a 404 here.** `notFound()` would replace
 * the page with the not-found route, and this page's client half already has a
 * missing-wheel state that says so properly — and can recover if the read
 * failed for a reason that was not the wheel's absence. The metadata simply
 * falls back to generic copy; see `wheelMetadata`.
 */
export async function generateMetadata({
  params,
}: PageProps<'/w/[shareId]'>): Promise<Metadata> {
  const { shareId } = await params

  let preview = null
  try {
    preview = await readWheelPreview(shareId)
  } catch (error) {
    // Never rethrown: metadata failing must not take the page with it. A
    // visitor with a working share link should still get their wheel, with a
    // duller tab title than they deserved.
    console.error(`generateMetadata: could not read wheels/${shareId}.`, error)
  }

  const { title, description } = wheelMetadata(preview)

  // `title` alone, so the layout's `%s · Spinnerly` template gives the tab and
  // the unfurl the same shape as every other page.
  const shareTitle = `${title} · ${SITE_NAME}`

  return {
    title,
    description,
    /**
     * **`openGraph` and `twitter` replace the layout's wholesale — they do not
     * merge field by field.** Anything the root layout sets and this object does
     * not restate is simply absent from this page's `<head>`, which is why
     * `type`, `siteName` and `card` are repeated here rather than inherited.
     *
     * `twitter.card` is the one that costs something to get wrong, and it fails
     * quietly: without `summary_large_image` X renders the 1200x630 card as a
     * small square thumbnail beside the text, on the page that matters most.
     * Nothing in a build or a type check notices, and the tag reads plausibly.
     *
     * `openGraph.title` does inherit the page `title` when omitted — but only
     * its literal value, not the layout's template — so an unfurl would read
     * "Team lunch" with nothing saying where the link goes.
     */
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: shareTitle,
      description,
      // Relative, resolved against `metadataBase`. The fragment holding the
      // edit token cannot appear here and must not: this is the URL a crawler
      // records as canonical for the page.
      url: `/w/${shareId}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: shareTitle,
      description,
    },
  }
}

/**
 * `/w/{shareId}` — the wheel, for both roles.
 *
 * A server component that renders one client component and nothing else, and
 * the split is load-bearing rather than habit. This half stays on the server so
 * TASK-23 can hang Open Graph metadata off it — an unfurled share link is how
 * most people meet a wheel, and metadata generated in the browser arrives long
 * after Slack has stopped reading.
 *
 * The other half cannot be here. Role comes from the edit token in the URL
 * fragment (design doc section 2), which browsers never send to a server, so
 * every decision that depends on it happens in ./wheel-page.tsx after mount.
 * Nothing role-dependent may move up into this file: it would be rendered for
 * the wrong role and then corrected, which is the flash AC 5 forbids.
 */
export default async function Page({ params }: PageProps<'/w/[shareId]'>) {
  const { shareId } = await params

  /**
   * Keyed on `shareId`, which is a correctness point rather than a hint.
   *
   * Duplicating a wheel navigates with `router.push` inside this same route
   * segment, so without a key React keeps the component instance and every
   * piece of local state in it — and `copyableOptions` in lib/wheels/store.ts
   * **preserves option ids** through a fork, so the Picked badges from the
   * source wheel would land on the copy's identical ids. The rotation, the
   * notice strip and the preview toggle are facts about the wheel that was left
   * behind in exactly the same way.
   *
   * `useWheelSession` still resets its own pending entries on a `shareId`
   * change, and should: it is a hook, and it cannot assume its caller was
   * remounted.
   */
  return <WheelPage key={shareId} shareId={shareId} />
}
