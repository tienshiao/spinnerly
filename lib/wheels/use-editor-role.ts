'use client'

import { useEffect, useMemo, useState } from 'react'

import { createWheelApi, type WheelApi } from './api-client'
import { useEditToken } from './use-edit-token'
import type { WheelRole } from './use-wheel-session'

/**
 * Which role this browser holds, resolved. Design doc section 2.
 *
 * Two questions, joined because a page has no use for either alone: does the
 * URL carry an edit token (./use-edit-token.ts), and does the server agree it
 * is this wheel's (`GET /api/wheels/{shareId}/editor`)?
 *
 * The second is not optional. Nothing on the client can check a token itself —
 * section 5's rules deny every read of `wheelSecrets` — so a page that skipped
 * it would render a complete editor from a truncated URL and only discover the
 * truth when the user pressed something. AC 3 asks for the opposite: degrade to
 * the participant view, and say why.
 *
 * The check costs no perceptible time, which is worth knowing before anyone
 * tries to optimise it away. It races the Firestore listener the page is
 * already waiting on, and that listener has further to go.
 */

export type EditorRoleState = {
  /** `'resolving'` until the answer cannot change. Render a skeleton, not a role. */
  status: 'resolving' | 'resolved'
  role: WheelRole
  /**
   * The URL carried a token and the server refused it — AC 3's case, and the
   * only one that deserves a message. An absent token is a participant, which
   * is a role rather than a failure, so it leaves this false.
   */
  rejected: boolean
  /**
   * The token to write with, or undefined. Never a rejected one: handing it to
   * `useWheelSession` would turn every control into a 403 the user cannot act
   * on, when refusing locally says the same thing immediately.
   */
  editToken: string | undefined
}

/** What the server said, or null while it has not answered. */
type Verdict = 'editor' | 'not-editor' | 'unknown' | null

const RESOLVING: EditorRoleState = {
  status: 'resolving',
  role: 'participant',
  rejected: false,
  editToken: undefined,
}

const PARTICIPANT: EditorRoleState = {
  status: 'resolved',
  role: 'participant',
  rejected: false,
  editToken: undefined,
}

const REJECTED: EditorRoleState = {
  status: 'resolved',
  role: 'participant',
  rejected: true,
  editToken: undefined,
}

/**
 * @param shareId From the path.
 * @param api     Injected in tests. The browser wants the real one.
 */
export function useEditorRole(
  shareId: string,
  api?: WheelApi,
): EditorRoleState {
  const token = useEditToken()
  const providedApi = api
  const client = useMemo(() => providedApi ?? createWheelApi(), [providedApi])

  /**
   * The verdict held alongside the request it answers, exactly as `useWheel`
   * holds its state alongside the `shareId` it describes.
   *
   * A bare `verdict` state would be a race the render loses: when the token or
   * the wheel changes, the effect that clears the old answer runs AFTER the
   * render that would have used it, so wheel A's `editor` verdict is briefly
   * applied to wheel B. Pairing makes the staleness visible during render
   * instead — the key stops matching and the hook reports `resolving` on the
   * very same pass.
   */
  const [held, setHeld] = useState<{ key: string; verdict: Verdict }>({
    key: '',
    verdict: null,
  })

  /**
   * What a held verdict is an answer to. Both halves, because a token is only
   * ever a token FOR a wheel — a `not-editor` verdict on one says nothing about
   * the next. The separator is a space, which neither half can contain: a share
   * ID is `[A-Za-z0-9]{20}` and an edit token is base64url.
   */
  const key = typeof token === 'string' ? `${shareId} ${token}` : ''

  useEffect(() => {
    if (typeof token !== 'string') return

    /**
     * Guards an answer already in flight when the inputs change.
     *
     * The pairing above covers a navigation on its own, since a late verdict
     * lands under the old key and the render discards it. What it cannot cover
     * is StrictMode double-invoking this effect for the SAME key: both answers
     * carry the right key, so the pairing cannot tell them apart and a slower
     * first invocation would overwrite a faster second. Closed over per
     * invocation, which can.
     */
    let live = true

    void client.verifyEditor(shareId, token).then(
      (verdict) => {
        if (live) setHeld({ key, verdict })
      },
      () => {
        // `verifyEditor` answers rather than throws for every refusal it can
        // interpret, so reaching here means something it could not classify.
        // Treated as no evidence, for the reason given on `unknown` below.
        if (live) setHeld({ key, verdict: 'unknown' })
      },
    )

    return () => {
      live = false
    }
  }, [client, key, shareId, token])

  return useMemo(() => {
    // The fragment has not been read: the server render, and the frame that
    // hydrates it. Any role here is a guess, and for an editor a wrong one.
    if (token === undefined) return RESOLVING

    // Read, and there was no token. Resolved immediately and with no request —
    // a share link is the common case and should not wait on a network.
    if (token === null) return PARTICIPANT

    if (held.key !== key) return RESOLVING

    switch (held.verdict) {
      case null:
        return RESOLVING

      case 'editor':
        return {
          status: 'resolved',
          role: 'editor',
          rejected: false,
          editToken: token,
        }

      case 'not-editor':
        return REJECTED

      /**
       * No answer, so no demotion.
       *
       * A dropped connection, a cold start that timed out, a 502 from the
       * platform: all evidence about the network and none about the token. The
       * cautious-looking reading — "we could not confirm it, so treat them as a
       * participant" — is the harmful one, because it silently strips the role
       * from someone holding a perfectly good edit link and leaves them on a
       * page that looks like an ordinary share view, with no reason to suspect
       * a reload would fix it.
       *
       * Nothing is risked by trusting the token instead. Every write is
       * authorised server-side on its own merits, so a token that really is bad
       * fails at the point of use with a message the user can act on — strictly
       * more informative than a view that quietly lost its controls.
       */
      case 'unknown':
        return {
          status: 'resolved',
          role: 'editor',
          rejected: false,
          editToken: token,
        }
    }
  }, [held, key, token])
}
