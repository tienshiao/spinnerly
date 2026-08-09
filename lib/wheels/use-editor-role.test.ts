// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WheelApi } from './api-client'
import { useEditorRole } from './use-editor-role'

/**
 * The token plus its verification, as one role.
 *
 * ./use-edit-token.test.ts covers the reading. What is left here is the part
 * that cannot be decided in the browser at all: nothing on the client can check
 * a token, because design doc section 5's rules deny every read of
 * `wheelSecrets`, so the server has to be asked and its answer has to be
 * interpreted. Two of those interpretations are load-bearing and neither is
 * obvious — a refusal demotes, and a failure to answer does not.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const OTHER_ID = 'zYxWvUtSrQpOnMlKjIhG'
const TOKEN = 'K3n8x_Qw-2bT4vZ1'

type Verdict = Awaited<ReturnType<WheelApi['verifyEditor']>>

function setHash(hash: string): void {
  globalThis.location.hash = hash
}

/** A `WheelApi` whose verification answers whatever a test tells it to. */
function fakeApi(answer: (shareId: string, token: string) => Promise<Verdict>) {
  const verifyEditor = vi.fn(answer)
  return { api: { verifyEditor } as unknown as WheelApi, verifyEditor }
}

const answering = (verdict: Verdict) => fakeApi(() => Promise.resolve(verdict))

/** A promise a test resolves when it chooses, so `resolving` is observable. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function role(api: WheelApi, shareId = SHARE_ID) {
  return renderHook(({ id }: { id: string }) => useEditorRole(id, api), {
    initialProps: { id: shareId },
  })
}

afterEach(() => {
  cleanup()
  setHash('')
})

describe('a URL with no token', () => {
  it('is a participant immediately, and asks nobody', () => {
    const { api, verifyEditor } = answering('editor')

    const { result } = role(api)

    expect(result.current).toEqual({
      status: 'resolved',
      role: 'participant',
      rejected: false,
      editToken: undefined,
    })
    // A share link is the common case. Making it wait on a network round trip
    // to be told what its own URL already says would be the slowest possible
    // way to learn nothing.
    expect(verifyEditor).not.toHaveBeenCalled()
  })
})

describe('a URL with a token', () => {
  it('resolves to editor, holding the token for writes', async () => {
    setHash(`#e=${TOKEN}`)
    const { api, verifyEditor } = answering('editor')

    const { result } = role(api)

    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(result.current.role).toBe('editor')
    expect(result.current.editToken).toBe(TOKEN)
    expect(result.current.rejected).toBe(false)
    expect(verifyEditor).toHaveBeenCalledWith(SHARE_ID, TOKEN)
  })

  it('reports resolving until the answer arrives', async () => {
    setHash(`#e=${TOKEN}`)
    const pending = deferred<Verdict>()
    const { api } = fakeApi(() => pending.promise)

    const { result } = role(api)

    // The whole point of the state: no role has been decided, so the page has
    // nothing it could render without guessing.
    expect(result.current.status).toBe('resolving')

    pending.resolve('editor')
    await waitFor(() => expect(result.current.role).toBe('editor'))
  })

  /**
   * AC 3. A truncated paste is overwhelmingly how this happens, and the result
   * has to be the shared view rather than an error page — the wheel is fine and
   * the holder can still read it and suggest to it.
   */
  it('degrades to a flagged participant when the server refuses it', async () => {
    setHash(`#e=${TOKEN}`)
    const { api } = answering('not-editor')

    const { result } = role(api)

    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(result.current.role).toBe('participant')
    expect(result.current.rejected).toBe(true)
    // Withheld deliberately: handing a refused token to the session would turn
    // every control into a 403 the user cannot act on.
    expect(result.current.editToken).toBeUndefined()
  })

  /**
   * The one that looks like the cautious choice and is not. A dropped
   * connection is evidence about the network and none at all about the token,
   * and demoting on it silently strips the role from someone holding a good
   * edit link — on a page that then looks like an ordinary share view, giving
   * them no reason to suspect a reload would fix it.
   */
  it('keeps the editor role when the server could not be reached', async () => {
    setHash(`#e=${TOKEN}`)
    const { api } = answering('unknown')

    const { result } = role(api)

    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(result.current.role).toBe('editor')
    expect(result.current.editToken).toBe(TOKEN)
    // Not a rejection, so nothing is said to the user about their link.
    expect(result.current.rejected).toBe(false)
  })

  it('keeps the editor role when verification throws outright', async () => {
    setHash(`#e=${TOKEN}`)
    const { api } = fakeApi(() => Promise.reject(new Error('boom')))

    const { result } = role(api)

    await waitFor(() => expect(result.current.status).toBe('resolved'))
    expect(result.current.role).toBe('editor')
  })
})

/**
 * A verdict answers a question about one token AND one wheel. Both halves
 * matter: a token is only ever a token for a particular wheel, so carrying an
 * `editor` verdict across a navigation would grant edit rights on the strength
 * of an answer about somewhere else.
 */
describe('when the question changes', () => {
  it('returns to resolving on the same render the wheel changes', async () => {
    setHash(`#e=${TOKEN}`)
    const pending = new Map<string, () => void>()
    const { api } = fakeApi(
      (shareId) =>
        new Promise<Verdict>((resolve) => {
          pending.set(shareId, () => resolve('editor'))
        }),
    )

    const { result, rerender } = role(api)
    pending.get(SHARE_ID)?.()
    await waitFor(() => expect(result.current.role).toBe('editor'))

    rerender({ id: OTHER_ID })

    // Synchronously, with no effect having run: the render itself sees that the
    // held verdict answers a question nobody is asking any more.
    expect(result.current.status).toBe('resolving')
    expect(result.current.role).toBe('participant')
  })

  it('ignores an answer that arrives for the previous wheel', async () => {
    setHash(`#e=${TOKEN}`)
    const pending = new Map<string, (verdict: Verdict) => void>()
    const { api } = fakeApi(
      (shareId) =>
        new Promise<Verdict>((resolve) => {
          pending.set(shareId, resolve)
        }),
    )

    const { result, rerender } = role(api)
    rerender({ id: OTHER_ID })

    // The first wheel's answer, landing late and saying "editor". Applying it
    // would put full editor controls over a wheel this token has never been
    // checked against.
    pending.get(SHARE_ID)?.('editor')
    await Promise.resolve()

    expect(result.current.status).toBe('resolving')

    pending.get(OTHER_ID)?.('not-editor')
    await waitFor(() => expect(result.current.rejected).toBe(true))
  })
})
