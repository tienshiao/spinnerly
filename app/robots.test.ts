import type { MetadataRoute } from 'next'
import { describe, expect, it } from 'vitest'

import robots from './robots'

/**
 * The one rule worth a test: `/w/` is closed to indexers and open to unfurlers.
 *
 * Both halves fail silently and slowly. Losing the restriction puts share URLs
 * into search results, which nobody notices until a wheel turns up in a Google
 * query. Losing an unfurler puts it into the `*` group, and its previews stop —
 * discovered when somebody pastes a link and gets a bare URL, weeks later, with
 * no error anywhere.
 */

type Rules = NonNullable<MetadataRoute.Robots['rules']>

// One group, from whichever arm of `rules` produced it. The two arms are not
// the same type — the single-group form leaves `userAgent` optional and the
// array form requires it — so this is a union rather than one `infer`.
type Group = Exclude<Rules, unknown[]> | Extract<Rules, unknown[]>[number]

/** Every group, whatever shape `rules` came back in. */
function groups(): Group[] {
  const { rules } = robots()
  return Array.isArray(rules) ? rules : [rules]
}

/** The group a bot with this name would obey: its own, else `*`. */
function groupFor(userAgent: string): Group | undefined {
  const named = groups().find((group) =>
    [group.userAgent].flat().includes(userAgent),
  )
  return named ?? groups().find((group) => group.userAgent === '*')
}

function disallowedBy(group: Group | undefined): string[] {
  return group?.disallow === undefined ? [] : [group.disallow].flat()
}

const UNFURLERS = [
  'Twitterbot',
  'facebookexternalhit',
  'Slackbot',
  'Slackbot-LinkExpanding',
  'Discordbot',
]

describe('robots', () => {
  it('closes the wheel pages to a crawler it does not recognise', () => {
    expect(disallowedBy(groupFor('Googlebot'))).toContain('/w/')
  })

  it('closes the API too', () => {
    expect(disallowedBy(groupFor('Googlebot'))).toContain('/api/')
  })

  it.each(UNFURLERS.map((userAgent) => ({ label: userAgent, userAgent })))(
    'leaves the wheel pages open to $label',
    ({ userAgent }) => {
      // These honour robots.txt like any other crawler, so the exception is
      // what keeps a pasted share link unfurling at all — design doc §3.
      const group = groupFor(userAgent)
      expect(
        group?.userAgent,
        `${userAgent} fell through to the * group`,
      ).not.toBe('*')
      expect(disallowedBy(group)).not.toContain('/w/')
    },
  )

  it('does not except a crawler that also indexes', () => {
    // Applebot draws iMessage's rich links AND feeds Siri and Spotlight, so
    // excepting it would hand a search crawler the access the `*` rule exists
    // to deny. iMessage loses nothing — the device fetches those previews
    // itself, and does not consult robots.txt.
    expect(disallowedBy(groupFor('Applebot'))).toContain('/w/')
  })

  it('leaves the rest of the site open to everyone', () => {
    for (const group of groups()) {
      expect([group.allow].flat()).toContain('/')
    }
  })
})
