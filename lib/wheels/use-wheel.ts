'use client'

import { doc, onSnapshot, type FirestoreError } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'

import { getClientDb } from '@/lib/firebase/client'
import { isShareId, WHEELS, type Wheel } from './model'
import { decodeWheel } from './snapshot'

/**
 * A live listener on `wheels/{shareId}`.
 *
 * The read half of design doc section 3, and the reason this application is on
 * Firestore at all: the browser subscribes to the document directly, so every
 * editor's change reaches every participant with no websocket layer to build.
 * Writes do not come back this way — they go out through ./api-client.ts and
 * arrive here a round trip later, which is what ./optimistic.ts papers over.
 *
 * One document, one listener, one read per update. Design doc section 4 keeps
 * `options` as an array inside the wheel rather than as a subcollection
 * precisely so that stays true.
 */

export type WheelStatus = 'loading' | 'ready' | 'not-found' | 'error'

export type WheelState = {
  status: WheelStatus
  /** Non-null exactly when `status` is `'ready'`. */
  wheel: Wheel | null
  /** Non-null exactly when `status` is `'error'`. */
  error: FirestoreError | null
  /**
   * How many snapshots have arrived for this wheel.
   *
   * Nothing in the reconciliation depends on it — the wheel carries its own
   * version in `updatedAt`, which is a far stronger signal than a count (see
   * `WheelVersion` in ./model.ts). Kept because it is the one honest way for a
   * component to say "we have heard from the server at least once", which a
   * status of `ready` does not distinguish from a stale render.
   */
  seq: number
}

function settling(shareId: string): WheelState {
  return {
    // An ID that cannot name a Firestore document is `not-found` without a
    // listener ever being opened. There is nothing to wait for, and reporting
    // `loading` would leave a typo'd URL spinning forever.
    status: isShareId(shareId) ? 'loading' : 'not-found',
    wheel: null,
    error: null,
    seq: 0,
  }
}

export function useWheel(shareId: string): WheelState {
  /**
   * Held alongside the ID it describes rather than on its own.
   *
   * That pairing is what makes AC 2 structural instead of a race the listener
   * usually wins: when `shareId` changes, the held state stops matching and the
   * hook returns a fresh loading state on the very same render, so wheel A's
   * title can never appear under wheel B's URL while the new listener opens.
   */
  const [held, setHeld] = useState<{ shareId: string; state: WheelState }>(
    () => ({ shareId, state: settling(shareId) }),
  )

  /** Counted in a ref so the callback below does not have to read its own state. */
  const seqRef = useRef(0)

  useEffect(() => {
    // `doc()` treats a slash as a path separator and throws on a path with the
    // wrong segment count, so an unvalidated ID out of a URL is both a crash
    // here and, on the server, the traversal `isShareId` exists to stop.
    if (!isShareId(shareId)) return

    seqRef.current = 0

    /**
     * Guards a callback already queued when we unsubscribe.
     *
     * `unsubscribe()` stops future deliveries, but one already in flight can
     * still land. For a navigation the pairing below covers it — a late
     * callback writes wheel A's ID, and the render then discards it. What the
     * pairing CANNOT cover is two listeners on the same wheel with the older
     * one dead, because both callbacks carry the right ID: StrictMode's
     * double-invoked effect produces exactly that, and a stale snapshot would
     * overwrite a newer one. This flag is closed over per effect invocation,
     * which is what tells the two apart.
     */
    let live = true

    const unsubscribe = onSnapshot(
      doc(getClientDb(), WHEELS, shareId),
      (snapshot) => {
        if (!live) return
        seqRef.current += 1

        setHeld({
          shareId,
          state: {
            // A document that is not there is `not-found` — not an error, and
            // not a permanent loading state. It is also the ordinary end of a
            // wheel's life: design doc section 8 reaps an idle wheel after 30
            // days and the share link outlives it (AC 7).
            status: snapshot.exists() ? 'ready' : 'not-found',
            wheel: snapshot.exists()
              ? decodeWheel(shareId, snapshot.data())
              : null,
            error: null,
            seq: seqRef.current,
          },
        })
      },
      (error) => {
        if (!live) return
        // Firestore ends a listener itself on error and does not retry, so
        // there is nothing left to tear down and nothing more will arrive.
        // `permission-denied` is the one to expect: it is what a rules change
        // looks like from the browser.
        setHeld({
          shareId,
          state: {
            status: 'error',
            wheel: null,
            error,
            // Not incremented: an error is not a delivery.
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

  // Memoised so a component holding this in a dependency array does not see a
  // new object on every render during the window before the first snapshot.
  const fresh = useMemo(() => settling(shareId), [shareId])
  const state = held.shareId === shareId ? held.state : fresh

  return state
}
