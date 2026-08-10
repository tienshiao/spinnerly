import type { Metadata } from 'next'
import { SITE_NAME, SITE_TAGLINE, siteUrl } from '@/lib/site'
import { fontVariables } from './fonts'
import './globals.css'

/**
 * The site's metadata, and the defaults every route inherits.
 *
 * Three parts are load-bearing for the unfurls in design doc section 3:
 *
 *  - **`metadataBase`.** `og:image` is an absolute URL by the time a crawler
 *    reads it, and the crawler has no page to resolve a relative one against.
 *    Next composes the file-convention images in app/opengraph-image.tsx and
 *    app/w/[shareId]/opengraph-image.tsx against this; without it the build
 *    guesses at localhost and warns, and the guess ships.
 *  - **The title template.** `generateMetadata` in w/[shareId]/page.tsx returns
 *    a bare wheel title, and this is what makes it read as "Team lunch ·
 *    Spinnerly" in a tab and in an unfurl without every route restating the
 *    product name.
 *  - **`twitter.card`.** Without `summary_large_image` an unfurl on X renders
 *    the 1200x630 card as a small square thumbnail beside the text, which is
 *    not what either card is composed for.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_TAGLINE,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={fontVariables}>
      <body>{children}</body>
    </html>
  )
}
