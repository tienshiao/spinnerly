'use client'

import { collection, onSnapshot, type FirestoreError } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { getClientDb } from '@/lib/firebase/client'
import { isShareId, SUGGESTIONS, WHEELS, type Suggestion } from './model'
import { bySubmissionOrder, decodeSuggestion } from './snapshot'

/**
 * A live listener on `wheels/{shareId}/suggestions`.
 *
 * The second half of the read path. Separate from the wheel document because
 * design doc section 4 keeps suggestions in a subcollection — different write
 * policy, different lifecycle — and separate here for the same reason: the two
 * arrive as independent snapshots, and pretending otherwise is what makes an
 * accept flicker (see the accept case in ./optimistic.ts).
 *
 * The queue is public. Every participant holding the share URL can read it,
 * which is decision 3 rather than an oversight: a visible queue prevents
 * duplicate submissions and makes curation feel collaborative. Security rules
 * allow `get` and `list` here for exactly this listener.
 *
 * **Unordered on the wire, sorted here.** An `orderBy('createdAt')` would
 * exclude from the result every document that lacks the field rather than
 * merely sorting it oddly — a suggestion with no timestamp would be invisible
 * to the editor who has to action it. See `bySubmissionOrder`.
 */

export type SuggestionsStatus = 'loading' | 'ready' | 'error'

export type SuggestionsState = {
  status: SuggestionsStatus
  /**
   * Oldest first. Empty is a legitimate answer and not a missing one — there is
   * no `not-found` here, because a subcollection of a wheel that does not exist
   * reads as empty rather than as absent, and the wheel listener is what says
   * whether the wheel is there.
   */
  suggestions: Suggestion[]
  error: FirestoreError | null
  /**
   * How many deliveries this listener has had.
   *
   * The wheel document carries its own version in `updatedAt`, so nothing needs
   * to count its snapshots. The queue has no such field — a collection has no
   * document of its own — and ./optimistic.ts needs one question answered about
   * it: has this listener said anything since a write settled? A suggestion the
   * wheel's version says was written and deleted is only known to be gone once
   * the queue itself has spoken.
   */
  seq: number
  /**
   * The same count as of right now, rather than as of this render.
   *
   * `seq` is state, so it becomes visible on the render that follows a
   * delivery; this reads the counter the `onSnapshot` callback has already
   * bumped. ./use-wheel-session.ts records the count when a WRITE SETTLES, and
   * a settle is a resolved promise, which can land between a delivery and any
   * effect that would have copied the new value out. Recording one behind would
   * make "the queue has delivered since" true against the very delivery the
   * entry was already looking at.
   *
   * **Call it from an event handler or an effect, never during a render.** It
   * changes without a render, which is why it is a function over a ref rather
   * than a field — a shape `react-hooks/refs` correctly refuses.
   */
  latestSeq: () => number
}

const NONE: Suggestion[] = []

/** Everything above except the accessor, which is attached on the way out. */
type Delivered = Omit<SuggestionsState, 'latestSeq'>

function settling(shareId: string): Delivered {
  return {
    status: isShareId(shareId) ? 'loading' : 'ready',
    suggestions: NONE,
    error: null,
    seq: 0,
  }
}

export function useSuggestions(shareId: string): SuggestionsState {
  // Paired with its ID for the same reason as in ./use-wheel.ts: wheel A's
  // queue must never render under wheel B's URL, not even for one frame.
  const [held, setHeld] = useState<{
    shareId: string
    state: Delivered
  }>(() => ({ shareId, state: settling(shareId) }))

  const seqRef = useRef(0)
  const latestSeq = useCallback(() => seqRef.current, [])

  useEffect(() => {
    if (!isShareId(shareId)) return

    // A new wheel counts from zero, so a count recorded against the previous
    // one can never be compared with this one's. The pending mutations holding
    // such a count are discarded on the same change — see the reset in
    // ./use-wheel-session.ts.
    seqRef.current = 0

    // Per effect invocation, for the reason spelled out in ./use-wheel.ts: the
    // ID pairing covers a navigation, and only this covers two listeners on the
    // same wheel with the older one already torn down.
    let live = true

    const unsubscribe = onSnapshot(
      collection(getClientDb(), WHEELS, shareId, SUGGESTIONS),
      (snapshot) => {
        if (!live) return
        // Before `setHeld`, and that ordering is the point: a write settling
        // between here and the next render must see the count this delivery
        // produced, not the one before it.
        seqRef.current += 1

        setHeld({
          shareId,
          state: {
            status: 'ready',
            seq: seqRef.current,
            suggestions: snapshot.docs
              .map((document) => decodeSuggestion(document.id, document.data()))
              .sort(bySubmissionOrder),
            error: null,
          },
        })
      },
      (error) => {
        if (!live) return
        setHeld({
          shareId,
          // Not incremented: an error is not a delivery.
          state: {
            status: 'error',
            suggestions: NONE,
            error,
            seq: seqRef.current,
          },
        })
      },
    )

    return () => {
      live = false
      unsubscribe()
    }
  }, [shareId])

  const fresh = useMemo(() => settling(shareId), [shareId])
  const state = held.shareId === shareId ? held.state : fresh

  return useMemo(() => ({ ...state, latestSeq }), [state, latestSeq])
}
