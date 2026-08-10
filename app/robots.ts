import type { MetadataRoute } from 'next'

/**
 * `robots.txt` — keep search engines out of `/w/`, keep unfurlers in.
 *
 * A share URL is the capability (design doc §2): holding it is what grants
 * access, and there are no accounts to check it against. Nothing stops someone
 * pasting one into a public page, and once a crawler follows that link every
 * wheel it reaches is a search result — which turns "unguessable" into
 * "searchable" for anything indexed.
 *
 * **This is a search-results measure, not a security one.** robots.txt is a
 * request that well-behaved crawlers honour; it is not an access control, and
 * nothing here should be treated as one. The security model is §5's rules and
 * the edit token, unchanged.
 *
 * **The obvious stronger fix would break the unfurls.** `noindex` on the wheel
 * page keeps a URL out of results even when it is linked from elsewhere, which
 * robots.txt does not — a disallowed URL can still be listed, without a
 * snippet, on the strength of an inbound link. But the unfurlers read the same
 * `<head>` a search engine does and several are reported to decline a card on a
 * noindexed page, so a `noindex` here would silently cost the previews that
 * app/w/[shareId]/opengraph-image.tsx exists to produce. Between a URL that can
 * be listed without a snippet and a share link that unfurls as nothing, this
 * app wants the first. Do not "upgrade" this to a meta tag.
 */

/**
 * The crawlers that fetch a link to draw a preview rather than to index it.
 *
 * Named explicitly because **they honour robots.txt too** — Twitter's, Slack's
 * and Discord's documentation all say so — so a bare `Disallow: /w/` would take
 * the unfurls down with the search results, which is the whole product (design
 * doc §3). A named group wins over `*` for the bot it names, so each of these
 * reads its own group and ignores the restriction below.
 *
 * Both Slack agents are listed: it expands links under
 * `Slackbot-LinkExpanding` and fetches under `Slackbot` depending on the path
 * through their system, and the two are separate tokens as far as a robots
 * parser is concerned.
 *
 * **Applebot is deliberately absent**, though iMessage is one of the four
 * unfurlers design doc §3 names. Applebot is Apple's crawler for Siri and
 * Spotlight Suggestions — an indexer, and excepting it would hand exactly the
 * access this file exists to deny to exactly the kind of program it is denying
 * it to. iMessage loses nothing: its rich links are fetched by the device
 * rather than by Applebot, and that fetch does not consult robots.txt.
 *
 * The list is unavoidably a list of names. A crawler not on it gets the `*`
 * group and will not preview a wheel — so add to it rather than weakening the
 * rule below when a new one turns up, and check first that what you are adding
 * only ever draws previews.
 */
const UNFURLERS = [
  'Twitterbot',
  'facebookexternalhit',
  'Slackbot',
  'Slackbot-LinkExpanding',
  'Discordbot',
  'LinkedInBot',
  'WhatsApp',
  'TelegramBot',
]

/** The paths no indexing crawler has any business in. */
const OFF_LIMITS = [
  // Every wheel, and its Open Graph image with it.
  '/w/',
  // Writes, plus one authenticated GET. A crawler would only ever collect 401s
  // and 405s here, and the ones it did not would be edit-token decisions.
  '/api/',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // First, though matching is by specificity rather than by order — a
      // parser that took the first matching group instead would still get this
      // right, and the exception reads better before the rule it excepts.
      { userAgent: UNFURLERS, allow: '/' },
      { userAgent: '*', allow: '/', disallow: OFF_LIMITS },
    ],
  }
}
