'use client'

import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { FirestoreError } from 'firebase/firestore'

import { ApiError, createWheelApi, type WheelApi } from './api-client'
import type { CreatedWheel } from './model'
import {
  newMutationKey,
  pendingReducer,
  project,
  SLOW_AFTER_MS,
  type LiveState,
  type Mutation,
  type PendingEntry,
  type ProjectedWheel,
} from './optimistic'
import { useSuggestions } from './use-suggestions'
import { useWheel, type WheelStatus } from './use-wheel'

/**
 * The whole client data path for one wheel, assembled.
 *
 * Two live listeners (./use-wheel.ts, ./use-suggestions.ts), the write client
 * (./api-client.ts) and the reconciliation (./optimistic.ts) joined into the
 * one object the wheel page and its panels consume. Everything interesting is
 * in those four modules; this hook is the wiring, and it is deliberately the
 * only place in the read path that owns a timer.
 *
 * Mutations reject with `ApiError` after rolling their optimistic entry back,
 * so a caller can `catch` and raise a toast (TASK-20) without this hook
 * knowing what a toast is.
 */

/** Which URL the holder has. Design doc section 2 — there is no other identity. */
export type WheelRole = 'editor' | 'participant'

export type WheelSession = {
  /** The wheel document's listener status. `not-found` covers a reaped wheel. */
  status: WheelStatus
  /** Set when either listener has failed. Both are refusals to read, not writes. */
  error: FirestoreError | null
  role: WheelRole
  /** Live state with every outstanding mutation folded in. Render from this. */
  view: ProjectedWheel

  addOption: (label: string) => Promise<void>
  removeOption: (optionId: string) => Promise<void>
  setTitle: (title: string) => Promise<void>
  setSuggestionsOpen: (open: boolean) => Promise<void>
  submitSuggestion: (label: string) => Promise<void>
  acceptSuggestion: (suggestionId: string, label: string) => Promise<void>
  rejectSuggestion: (suggestionId: string) => Promise<void>
  /** Fork. Unauthenticated, so a participant may call it too (decision 5). */
  duplicate: () => Promise<CreatedWheel>
}

export type WheelSessionInput = {
  shareId: string
  /**
   * From `location.hash`, and from nowhere else.
   *
   * Design doc section 2 puts the token in the fragment because fragments are
   * never sent to a server — it stays out of `Referer`, out of access logs, and
   * out of Slack's crawler when someone pastes their edit URL. Absent means
   * participant, which is a role and not a degraded state.
   */
  editToken?: string
  /** Injected in tests. The browser wants the real one. */
  api?: WheelApi
}

const NO_ENTRIES: PendingEntry[] = []

export function useWheelSession(input: WheelSessionInput): WheelSession {
  const { shareId, editToken } = input

  const wheelState = useWheel(shareId)
  const suggestionsState = useSuggestions(shareId)
  const [entries, dispatch] = useReducer(pendingReducer, NO_ENTRIES)

  const providedApi = input.api
  const api = useMemo(() => providedApi ?? createWheelApi(), [providedApi])

  const live: LiveState = useMemo(
    () => ({
      wheel: wheelState.wheel,
      suggestions: suggestionsState.suggestions,
      queueSeq: suggestionsState.seq,
    }),
    [wheelState.wheel, suggestionsState.suggestions, suggestionsState.seq],
  )

  /**
   * Drop the entries the latest snapshot has made visible.
   *
   * This is housekeeping, not correctness. `project` filters landed entries out
   * on its own, so what renders is right whether or not this has run — which is
   * deliberate, because an effect runs after the commit and a view that waited
   * for it would be wrong for exactly one frame. What this prevents is the
   * pending list growing for the life of the page: without it, every mutation
   * an editor ever makes stays in the array and is re-examined on every render.
   *
   * `entries` is in the dependency list because an entry can settle AFTER its
   * own snapshot has already arrived — the two race, and the snapshot wins
   * often enough to matter. Keyed on `live` alone, such an entry would wait for
   * a change nobody is going to make and never be swept.
   *
   * That is only safe because `pendingReducer` returns the IDENTICAL array when
   * it retires nothing, so React bails out of the re-render and this effect
   * does not run again. A reducer that returned a fresh array loops forever,
   * and it does so silently — see the note on `retireLanded` for why there is
   * no error to read when it happens.
   */
  useEffect(() => {
    dispatch({ type: 'reconcile', live })
  }, [live, entries])

  /** A different wheel is a different set of pending mutations. */
  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [shareId])

  /**
   * The queue's delivery count, asked for at the moment a write settles.
   *
   * Read through the listener's own accessor rather than copied into a local
   * ref, and that is a correctness point rather than a shortcut. A settle is a
   * resolved promise, so it can land between a delivery and any passive effect
   * that would have copied the new count across — recording one behind, which
   * `hasLanded` then reads as "the queue has delivered since" against the very
   * delivery the entry was already looking at.
   *
   * Asking at settle time rather than depending on the value also keeps the
   * mutation callbacks from being rebuilt on every snapshot. They are handed to
   * memoised components, and a new `onClick` identity per incoming suggestion
   * would re-render the whole option list every time anyone touched the wheel.
   */
  const latestQueueSeq = suggestionsState.latestSeq

  /**
   * The only clock in the read path.
   *
   * `project` cannot compare `startedAt` against the current time, because it
   * runs during render and `Date.now()` there is impure — React may replay a
   * render, and the same inputs would then produce different output. So the
   * comparison happens here, in an effect, and the result is stored on the
   * entry.
   *
   * One timer per pass, aimed at the NEXT deadline rather than a polling
   * interval: with several writes outstanding they cross the threshold at
   * different moments, each dispatch changes `entries`, and the effect re-runs
   * and aims at the one after it. When nothing is left to wake for there is no
   * timer at all, which is what keeps an idle wheel idle.
   *
   * Entries already past the threshold are dispatched immediately rather than
   * scheduled — the case is a remount, where `startedAt` is older than this
   * component.
   */
  useEffect(() => {
    const now = Date.now()
    const overdue: string[] = []
    let soonest: number | null = null

    for (const entry of entries) {
      if (entry.slow) continue
      const due = entry.startedAt + SLOW_AFTER_MS
      if (due <= now) overdue.push(entry.key)
      else if (soonest === null || due < soonest) soonest = due
    }

    if (overdue.length > 0) {
      dispatch({ type: 'slow', keys: overdue })
      return
    }
    if (soonest === null) return

    // Captured at schedule time, so the reducer never has to consult a clock.
    // Entries with a later deadline are picked up by the next pass.
    const deadline = soonest
    const due = entries
      .filter(
        (entry) => !entry.slow && entry.startedAt + SLOW_AFTER_MS <= deadline,
      )
      .map((entry) => entry.key)

    const timer = setTimeout(
      () => dispatch({ type: 'slow', keys: due }),
      deadline - now,
    )
    return () => clearTimeout(timer)
  }, [entries])

  const view = useMemo(() => project(live, entries), [live, entries])

  /**
   * Run one mutation optimistically.
   *
   * The order is the contract: the entry exists BEFORE the request goes out, so
   * the row is on screen from the click; it settles with whatever identity the
   * response carried, which is what lets ./optimistic.ts recognise the change
   * arriving in a snapshot; and it is dropped outright on failure, which is the
   * rollback. The error is then re-thrown, because the caller is the one that
   * knows how to tell the user.
   */
  const run = useCallback(
    // Every mutating call returns a version, and the constraint says so rather
    // than trusting it: a method that stopped carrying one would silently give
    // its entries no evidence but identity, and the only symptom would be a row
    // that occasionally never clears.
    async <T extends { updatedAt: Date | null }>(
      mutation: Mutation,
      perform: () => Promise<T>,
      serverIdOf?: (result: T) => string,
    ): Promise<T> => {
      const key = newMutationKey()
      dispatch({ type: 'begin', key, mutation, at: Date.now() })

      let result: T
      try {
        result = await perform()
      } catch (error) {
        dispatch({ type: 'fail', key })
        throw error
      }

      dispatch({
        type: 'settle',
        key,
        serverId: serverIdOf?.(result),
        wheelUpdatedAt: result.updatedAt,
        queueSeq: latestQueueSeq(),
      })
      return result
    },
    [latestQueueSeq],
  )

  /**
   * Refuse an editor mutation with no token, locally and without a round trip.
   *
   * A participant view should not render these controls at all, so reaching
   * here is a bug rather than a user error — but a silent no-op would be a
   * button that does nothing, and sending the request would be a 401 the user
   * has no way to act on. Failing with the same `missing_token` code the server
   * uses keeps one vocabulary for the condition.
   */
  const requireToken = useCallback((): string => {
    if (editToken === undefined || editToken === '') {
      throw new ApiError(
        401,
        'missing_token',
        'This view has no edit token, so it cannot change the wheel.',
      )
    }
    return editToken
  }, [editToken])

  const addOption = useCallback(
    async (label: string): Promise<void> => {
      const token = requireToken()
      await run(
        { kind: 'add-option', label },
        () => api.addOption(shareId, { label }, token),
        (result) => result.option.id,
      )
    },
    [api, requireToken, run, shareId],
  )

  const removeOption = useCallback(
    async (optionId: string): Promise<void> => {
      const token = requireToken()
      await run({ kind: 'remove-option', optionId }, () =>
        api.removeOption(shareId, optionId, token),
      )
    },
    [api, requireToken, run, shareId],
  )

  const setTitle = useCallback(
    async (title: string): Promise<void> => {
      const token = requireToken()
      await run({ kind: 'patch-wheel', patch: { title } }, () =>
        api.updateWheel(shareId, { title }, token),
      )
    },
    [api, requireToken, run, shareId],
  )

  const setSuggestionsOpen = useCallback(
    async (open: boolean): Promise<void> => {
      const token = requireToken()
      await run({ kind: 'patch-wheel', patch: { suggestionsOpen: open } }, () =>
        api.updateWheel(shareId, { suggestionsOpen: open }, token),
      )
    },
    [api, requireToken, run, shareId],
  )

  /** Unauthenticated: this is the one write a participant makes. */
  const submitSuggestion = useCallback(
    async (label: string): Promise<void> => {
      await run(
        { kind: 'submit-suggestion', label },
        () => api.submitSuggestion(shareId, { label }),
        (result) => result.suggestion.id,
      )
    },
    [api, run, shareId],
  )

  /**
   * `label` is passed in rather than looked up, because the optimistic option
   * row needs it before any snapshot confirms the accept — and looking it up
   * from the live queue here would go stale in exactly the case that matters,
   * a second editor rejecting the same suggestion mid-click.
   */
  const acceptSuggestion = useCallback(
    async (suggestionId: string, label: string): Promise<void> => {
      const token = requireToken()
      await run({ kind: 'accept-suggestion', suggestionId, label }, () =>
        api.acceptSuggestion(shareId, suggestionId, token),
      )
    },
    [api, requireToken, run, shareId],
  )

  const rejectSuggestion = useCallback(
    async (suggestionId: string): Promise<void> => {
      const token = requireToken()
      await run({ kind: 'reject-suggestion', suggestionId }, () =>
        api.rejectSuggestion(shareId, suggestionId, token),
      )
    },
    [api, requireToken, run, shareId],
  )

  /**
   * No optimistic entry, because a fork changes nothing about THIS wheel — it
   * mints a second one, and what the caller does with the result is navigate.
   */
  const duplicate = useCallback(
    (): Promise<CreatedWheel> => api.duplicateWheel(shareId),
    [api, shareId],
  )

  return {
    status: wheelState.status,
    error: wheelState.error ?? suggestionsState.error,
    role:
      editToken === undefined || editToken === '' ? 'participant' : 'editor',
    view,
    addOption,
    removeOption,
    setTitle,
    setSuggestionsOpen,
    submitSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    duplicate,
  }
}
