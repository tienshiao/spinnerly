// @vitest-environment jsdom

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useEditToken } from './use-edit-token'

/**
 * Reading the edit token out of the URL fragment. Design doc section 2.
 *
 * Two things are being proved here and only one of them is parsing. The other
 * is the three-state return: a hook that answered `null` before it had read
 * anything would render the participant view for a frame on every editor's
 * page, which is the wrong-role flash AC 5 forbids and which no parsing test
 * would catch.
 */

const TOKEN = 'K3n8x_Qw-2bT4vZ1'

/** jsdom keeps the fragment on a real Location, so this is the real API. */
function setHash(hash: string): void {
  globalThis.location.hash = hash
}

afterEach(() => {
  cleanup()
  setHash('')
})

describe('parsing the fragment', () => {
  it.each([
    { label: 'no fragment at all', hash: '', expected: null },
    { label: 'the documented shape', hash: `#e=${TOKEN}`, expected: TOKEN },
    {
      label: 'a token alongside other parameters',
      hash: `#tab=options&e=${TOKEN}`,
      expected: TOKEN,
    },
    {
      label: 'a fragment naming something else entirely',
      hash: '#options',
      expected: null,
    },
    // What a truncated copy-paste out of a chat client produces. Sending it
    // would be an empty bearer to the API for an answer we already have.
    { label: 'an empty value', hash: '#e=', expected: null },
    {
      label: 'a percent-encoded value',
      hash: '#e=a%2Bb',
      expected: 'a+b',
    },
  ])('reads $label', ({ hash, expected }) => {
    setHash(hash)

    expect(renderHook(() => useEditToken()).result.current).toBe(expected)
  })
})

/**
 * The distinction AC 5 rests on, and the one a parsing test cannot reach.
 *
 * `null` and `undefined` both look falsy, so the tempting simplification is to
 * return one of them. Collapsing them means "there is no token" is the answer
 * during the render that has not looked yet — which is the server render, and
 * the client render that must match it to hydrate. Every editor's page would
 * then be built as a participant's first and visibly rebuilt a moment later.
 */
describe('before the fragment has been read', () => {
  it('answers undefined on the server even when a token is in the URL', () => {
    setHash(`#e=${TOKEN}`)

    function Probe() {
      const token = useEditToken()
      return createElement('span', null, token === undefined ? 'unread' : token)
    }

    // Rendered through react-dom/server, which is what makes React take the
    // `getServerSnapshot` path — the same path the hydrating client render
    // takes, and the only one where the answer can be wrong for free.
    expect(renderToStaticMarkup(createElement(Probe))).toContain('unread')
  })
})

/**
 * A fragment change does not reload the page, so a hook that read once in an
 * effect would leave the role frozen at whatever the URL said on mount — an
 * editor pasting their edit URL into the address bar of an already-open share
 * view would stay a participant with nothing to explain why.
 */
describe('following the fragment', () => {
  it('picks up a token that arrives after mount', async () => {
    const { result } = renderHook(() => useEditToken())
    expect(result.current).toBeNull()

    setHash(`#e=${TOKEN}`)

    await waitFor(() => expect(result.current).toBe(TOKEN))
  })

  it('drops a token that is removed from the URL', async () => {
    setHash(`#e=${TOKEN}`)
    const { result } = renderHook(() => useEditToken())
    expect(result.current).toBe(TOKEN)

    setHash('#')

    await waitFor(() => expect(result.current).toBeNull())
  })
})
