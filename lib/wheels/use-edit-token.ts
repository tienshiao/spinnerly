'use client'

import { useSyncExternalStore } from 'react'

/**
 * The edit token, read out of the URL fragment and from nowhere else.
 *
 * Design doc section 2 puts it in the fragment because fragments are never sent
 * to a server: it stays out of `Referer`, out of access logs, out of any error
 * reporter added later, and out of Slack's crawler when someone pastes their
 * edit URL. Everything awkward about this module follows from that one choice —
 * the server cannot see the token, so the page cannot know its own role until
 * JavaScript has run.
 *
 * **Do not "fix" that by moving the token into a route segment.** Design doc
 * section 3 says so at length; it puts the token straight back into the request
 * path and into every server and platform log.
 */

/**
 * Three states, and the third one is the whole point.
 *
 * `undefined` — not read yet: the server render, and the hydrating client
 * render that must match it.
 * `null` — read, and there was no token. An ordinary share link.
 * `string` — read, and there was one. Whether it is VALID is a different
 * question, answered by ./use-editor-role.ts.
 *
 * Collapsing `undefined` into `null` is the tempting simplification and it
 * breaks AC 5: "no token" would then be the answer during the frame before
 * anything has been read, so every editor's page would render the participant
 * view first and visibly flip. The distinction is what makes the loading state
 * a state rather than a wrong answer.
 */
export type EditTokenState = string | null | undefined

/** The fragment parameter, per design doc section 2's URL structure. */
const TOKEN_PARAM = 'e'

/**
 * `hashchange` rather than a one-shot read in an effect.
 *
 * A fragment change does not reload the page, so an effect that read once would
 * leave the role frozen at whatever the URL said on mount — an editor who
 * pasted their edit URL into the address bar of an already-open share view
 * would stay a participant with no indication why.
 */
function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener?.('hashchange', onChange)
  return () => globalThis.removeEventListener?.('hashchange', onChange)
}

/**
 * Parsed with `URLSearchParams`, which decodes `+` as a space.
 *
 * Safe here, and deliberately so rather than by luck: `mintEditToken` emits
 * base64url precisely because the token's only home is a URL fragment, so the
 * alphabet is `[A-Za-z0-9_-]` and contains no `+`. See the note in ./tokens.ts
 * — if that ever changes to plain base64, this is the second place that breaks,
 * and it breaks silently, as a token that verifies for nobody.
 */
function getSnapshot(): EditTokenState {
  const hash = globalThis.location?.hash ?? ''
  if (hash === '') return null

  const token = new URLSearchParams(hash.slice(1)).get(TOKEN_PARAM)

  // An empty value is no value. `#e=` is what a truncated copy-paste produces,
  // and treating it as a token would send an empty bearer to the API for an
  // answer we already have.
  return token === null || token === '' ? null : token
}

/**
 * `undefined` on the server, which is the honest answer: the fragment did not
 * arrive with the request and cannot be inferred.
 *
 * React also uses this for the hydrating render, which is what keeps the
 * markup identical on both sides and then re-renders with the real value once
 * hydration is done.
 */
function getServerSnapshot(): EditTokenState {
  return undefined
}

export function useEditToken(): EditTokenState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
