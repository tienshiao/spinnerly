import type { Suggestion, Wheel, WheelOption, WheelPatch } from './model'
import { bySubmissionOrder } from './snapshot'

/**
 * The optimistic layer, and the thing design doc section 3 calls "the single
 * most likely 'why does this feel bad' regression".
 *
 * Firestore normally echoes a client's own write into its local cache before
 * the round trip, so edits look instant. This application gives that up on
 * purpose: writes go through route handlers so the server can do the things
 * rules cannot (§3), which makes the path client → API → Firestore → snapshot
 * back. Nothing an editor does appears until the last hop. This module is what
 * puts it on screen in the meantime.
 *
 * Pure and React-free, so the whole reconciliation is testable without a DOM,
 * a listener, or a clock. The hooks in ./use-wheel-session.ts supply the live
 * state and the current time and do nothing else with it.
 *
 * ## When an optimistic entry retires
 *
 * The one decision everything else follows from. **An entry is retired when the
 * change appears in a SNAPSHOT — never when the HTTP response arrives.**
 *
 * Retiring on the response is the obvious implementation and it is the flicker:
 * the 201 comes back, the local row is dropped, and the real row does not exist
 * yet because the snapshot is still in flight. The option vanishes and returns
 * a moment later. On a wheel, that is a slice disappearing and reappearing.
 *
 * Recognising the change takes two kinds of evidence, and the second is what
 * makes the first safe.
 *
 * **Identity.** The change is visibly there: the option carries the ID the 201
 * returned, the rejected row is gone, the queue row reads accepted. Identity is
 * the earliest possible signal and it can never fire too soon — a row that is
 * there IS the landing.
 *
 * **Version.** Every mutating route answers with the `updatedAt` its write
 * stored on the wheel document, in the `WHEEL_VERSION_HEADER` (./model.ts). Once
 * a snapshot carries an `updatedAt` at or past that value, we are looking at a
 * document that already includes our write — whatever it does or does not show.
 * That is the only statement strong enough to mean "and the answer is no": the
 * option is not there because it was removed again, not because we have not
 * seen it yet.
 *
 * | Mutation          | Landed when                                                       |
 * | ----------------- | ----------------------------------------------------------------- |
 * | add option        | the ID the 201 returned is in options, **or** the version caught up |
 * | remove option     | that ID is gone from options, **or** the version caught up          |
 * | patch wheel       | the field equals what we asked for, **or** the version caught up    |
 * | submit suggestion | the ID the 201 returned is in the queue, **or** the version caught up and the queue has since delivered |
 * | reject suggestion | that ID is gone from the queue. Identity alone — see below         |
 * | accept suggestion | an option carries `fromSuggestion` AND the row reads accepted, **or** the same |
 *
 * Three of these are less obvious than they look.
 *
 * **Accept answers 204,** so unlike an add there is no new option ID to wait
 * for. `fromSuggestion` — written by the accept transaction itself — is the only
 * key available, which makes that field load-bearing for the UI and not only
 * for provenance. Accept also needs BOTH halves: it writes the wheel document
 * and the suggestion document, they arrive as two independent snapshots, and
 * retiring on the first would let the queue row flip back to pending in between.
 *
 * **The version is the WHEEL's, even for the suggestion routes.** That works
 * because TASK-14 slides `expiresAt` on the wheel for every mutation there is,
 * so one field versions the whole wheel, subcollection included. What it does
 * not tell us is whether the QUEUE listener has caught up — that is a separate
 * subscription — so a queue mutation that needs the version additionally
 * requires a queue delivery since the write settled. Without that, an optimistic
 * suggestion row would vanish the moment the wheel caught up and reappear when
 * the queue arrived, which is the flicker again in the other panel.
 *
 * **Reject needs no version at all,** and the asymmetry with its two neighbours
 * is deliberate. A reject deletes the row, so every snapshot at or after the
 * commit lacks it: the identity signal is guaranteed to arrive, and there is no
 * negative conclusion left for a version to reach. Submit and accept both have
 * one — a suggestion that was created and deleted unseen, an option another
 * editor has since removed — which is why they carry the extra evidence and
 * reject does not.
 *
 * **A patch has no identity to match on at all,** so the version is not a
 * fallback there but the whole mechanism. Value matching stays as the early
 * signal: it is what retires a patch the instant its own snapshot arrives, and
 * it also covers the case where the value we asked for was already the stored
 * one.
 *
 * ## Why an unlanded entry is never abandoned
 *
 * There is deliberately no timeout that gives up on a settled entry and drops
 * it. A write that succeeded is a change that exists, so the optimistic row is
 * the CORRECT thing to draw whether or not the listener ever delivers it —
 * dropping it after ten seconds would mean the editor's own successful edit
 * disappearing off their screen. What is bounded instead is the request: see
 * `DEFAULT_TIMEOUT_MS` in ./api-client.ts. A failed write is rolled back
 * immediately, which is a different thing entirely.
 *
 * The version is what keeps that from stranding a row. A suggestion submitted
 * and rejected inside one round trip may never appear in any snapshot this
 * client receives — Firestore does not promise to deliver every intermediate
 * version — and before the routes returned a version there was no way to tell
 * that from "not delivered yet". The row, its `pendingCount` and its `slow`
 * affordance stayed forever. Now the wheel catching up says the write happened
 * and the row is not there, which is an answer rather than a guess.
 *
 * ## What is still not certain
 *
 * A response with no version leaves an entry on identity alone. That is sound
 * and never retires early; it simply cannot rule out the stranded row above.
 * `WheelVersion` in ./model.ts lists what produces the null.
 *
 * **`queueMoved` is a delivery count, and counts carry the weakness this module
 * replaced one to avoid.** A queue delivery arriving after the response can
 * still have been generated before the commit, so a submit or an accept whose
 * wheel half has already caught up can retire against stale queue data — an
 * optimistic row disappearing for one delivery cycle before the real one lands.
 * The queue has no version of its own to compare against, because a collection
 * is not a document and there is nothing to put a field on. The window is one
 * delivery wide and self-healing, and it is bounded to the two mutations that
 * genuinely need a negative conclusion: reject, which does not, uses identity
 * alone and has no such window.
 *
 * And the wheel's `updatedAt` is the route's wall clock rather than Firestore's
 * (see `writeVersion` in ./store.ts), so two writes from two function instances
 * are ordered by clocks that may differ by a few milliseconds. Against our own
 * write the comparison is exact — it is the value we were handed. Against a
 * concurrent editor's it is exact to within that skew, on writes that would
 * have to land within it of each other.
 */

/**
 * How long a mutation may be outstanding before the UI should say so.
 *
 * Design doc section 3 accepts a one-to-two-second stall on the first write
 * after a quiet period — Vercel has no always-warm option — so this sits well
 * below that: a warm round trip is comfortably under it, and a cold start is
 * comfortably over. The point is not to predict the cold start but to have
 * said something before the user decides the click did not register.
 */
export const SLOW_AFTER_MS = 600

/**
 * The prefix on every locally-minted ID.
 *
 * Server IDs are UUIDs (options) or 20-character Firestore auto-IDs
 * (suggestions), so a prefixed key cannot collide with one. It also makes an
 * optimistic ID recognisable in a React key, in a DOM attribute and in a
 * screenshot of a bug report.
 *
 * **Nothing local may be sent back to the API.** `DELETE /options/{optionId}`
 * with one of these would 400 at best; the UI should disable a row's controls
 * while `optimistic` is true, and `isOptimisticId` is here so a caller can
 * assert it rather than infer it.
 */
const OPTIMISTIC_ID_PREFIX = 'local:'

export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX)
}

let mutationCounter = 0

/** Mint a key for one mutation. Unique per tab, which is all it has to be. */
export function newMutationKey(): string {
  mutationCounter += 1
  return `${OPTIMISTIC_ID_PREFIX}${mutationCounter}`
}

/** What was asked for. One variant per mutating endpoint in design doc §6. */
export type Mutation =
  | { kind: 'add-option'; label: string }
  | { kind: 'remove-option'; optionId: string }
  | { kind: 'submit-suggestion'; label: string }
  | { kind: 'reject-suggestion'; suggestionId: string }
  | { kind: 'accept-suggestion'; suggestionId: string; label: string }
  | { kind: 'patch-wheel'; patch: WheelPatch }

/** What the server said, once it has said it. */
export type Settlement = {
  /** The ID a 201 returned, for the two mutations that create something. */
  serverId?: string
  /**
   * The wheel version this write produced, or null when there was none to be
   * had — `WheelVersion` in ./model.ts lists what produces that. A null costs
   * the entry its version evidence and leaves it on identity alone.
   */
  wheelUpdatedAt: Date | null
  /**
   * Queue deliveries at the moment the response resolved.
   *
   * Only submit and accept use it, and only to answer "has the
   * queue listener said anything since?" — the wheel's version cannot speak for
   * a separate subscription.
   */
  queueSeq: number
}

export type PendingEntry = {
  key: string
  mutation: Mutation
  /** `Date.now()` at the click. Only ./use-wheel-session.ts's timer reads it. */
  startedAt: number
  /** Null while the request is in flight. */
  settled: Settlement | null
  /**
   * Set once this mutation has been outstanding past `SLOW_AFTER_MS`.
   *
   * A stored flag rather than a comparison against the current time, because
   * `project` runs during render and `Date.now()` there is impure — the same
   * render would produce different output depending on when React happened to
   * run it, which is exactly what `react-hooks/purity` refuses. The clock is
   * read in a timer instead, and this field is what that timer sets.
   */
  slow: boolean
}

/**
 * The live state, exactly as the two listeners deliver it.
 *
 * `queueSeq` counts deliveries of the suggestions collection rather than
 * measuring anything. The wheel needs no counterpart: its version is a value in
 * the document itself.
 */
export type LiveState = {
  wheel: Wheel | null
  suggestions: Suggestion[]
  queueSeq: number
}

export type ProjectedOption = WheelOption & {
  /** A mutation touching this option is outstanding. */
  pending: boolean
  /** This row exists only locally. Its `id` is not addressable by the API. */
  optimistic: boolean
  /** That mutation has been outstanding past `SLOW_AFTER_MS`. */
  slow: boolean
}

export type ProjectedSuggestion = Suggestion & {
  pending: boolean
  optimistic: boolean
  slow: boolean
}

/**
 * A wheel with the outstanding mutations folded in — what a component renders.
 *
 * On an option row `pending` and `optimistic` coincide today, because the only
 * mutation that leaves an option row on screen while it is outstanding is the
 * one that invented the row. They are kept apart because they answer different
 * questions and diverge on suggestions already: an accept marks a real row
 * `pending` without it ever being `optimistic`.
 */
export type ProjectedWheel = {
  wheel: (Omit<Wheel, 'options'> & { options: ProjectedOption[] }) | null
  suggestions: ProjectedSuggestion[]
  /**
   * Which wheel-level fields have an unlanded write against them, for the
   * inline title editor and the suggestions kill switch.
   */
  saving: { title: boolean; suggestionsOpen: boolean }
  pendingCount: number
  /** Any outstanding mutation past `SLOW_AFTER_MS`. */
  slow: boolean
}

/**
 * Whether the server's version of this mutation is visible in `live` yet.
 *
 * An unsettled entry has not landed by definition: we have no answer, so there
 * is nothing to recognise. Waiting for the settlement also means a snapshot
 * that happens to satisfy the predicate for an unrelated reason — a second
 * editor adding an option with the same label, an accept of the same
 * suggestion from another device — cannot retire our entry early.
 */
export function hasLanded(entry: PendingEntry, live: LiveState): boolean {
  const settled = entry.settled
  if (settled === null) return false

  const options = live.wheel?.options ?? []
  const mutation = entry.mutation

  /**
   * Whether the wheel we can see already includes this write.
   *
   * Exact against our OWN write: `settled.wheelUpdatedAt` is the value the
   * route told us it stored, so equality means we are looking at the document
   * our write produced. Greater means someone has written since, which is just
   * as conclusive — either way the snapshot is not one that predates us.
   *
   * False while the wheel is null, which covers the frame before the first
   * snapshot as well as a wheel that is genuinely gone. Retiring everything
   * during initial load would empty the optimistic layer before it had anything
   * to reconcile against; the callers that really do mean "the wheel is gone"
   * say so themselves below.
   */
  const versionCaughtUp =
    settled.wheelUpdatedAt !== null &&
    live.wheel !== null &&
    live.wheel.updatedAt !== null &&
    live.wheel.updatedAt.getTime() >= settled.wheelUpdatedAt.getTime()

  /**
   * Whether the QUEUE listener has said anything since the write settled.
   *
   * The wheel's version cannot speak for a separate subscription, so without
   * this an optimistic suggestion row would be retired the moment the wheel
   * caught up and redrawn when the queue finally delivered.
   */
  const queueMoved = live.queueSeq > settled.queueSeq

  switch (mutation.kind) {
    case 'add-option':
      // Identity first, because a row that is there is the landing and cannot
      // be premature. The version answers the other case: the option is not
      // there and, since our write is already in this document, it is not going
      // to be — it was added and removed again.
      return (
        options.some((option) => option.id === settled.serverId) ||
        versionCaughtUp
      )

    case 'remove-option':
      // A wheel that is gone entirely counts as landed: there is no row left to
      // draw, so holding the entry would only keep a hidden option hidden.
      return (
        live.wheel === null ||
        !options.some((option) => option.id === mutation.optionId) ||
        versionCaughtUp
      )

    case 'submit-suggestion':
      return (
        live.suggestions.some(
          (suggestion) => suggestion.id === settled.serverId,
        ) ||
        (versionCaughtUp && queueMoved)
      )

    case 'reject-suggestion':
      // Identity ALONE, unlike the other two queue mutations, and the asymmetry
      // is not an oversight. A reject deletes the row, so every snapshot at or
      // after our commit lacks it and the identity signal is guaranteed to
      // arrive — there is no negative conclusion left for a version to reach.
      // Adding the fallback would only widen the window in which a stale queue
      // delivery could retire the entry and flicker the row back.
      return !live.suggestions.some(
        (suggestion) => suggestion.id === mutation.suggestionId,
      )

    case 'accept-suggestion': {
      // Both halves, and not just the option. The accept transaction writes the
      // wheel document and the suggestion document, which reach this client as
      // two independent snapshots — retiring on whichever arrives first would
      // show the queue row flipping back to pending until the other caught up.
      const optionArrived = options.some(
        (option) => option.fromSuggestion === mutation.suggestionId,
      )
      const rowAccepted = live.suggestions.every(
        (suggestion) =>
          suggestion.id !== mutation.suggestionId ||
          suggestion.status === 'accepted',
      )
      return (optionArrived && rowAccepted) || (versionCaughtUp && queueMoved)
    }

    case 'patch-wheel': {
      if (live.wheel === null) return true

      // Value matching is the early signal — it retires a patch the instant its
      // own snapshot arrives, and it also covers a patch that asked for the
      // value already stored. The version is what terminates the other case: a
      // second editor writing after us means the value we asked for never
      // appears at all, and design doc section 2 makes that ordinary.
      const wheel = live.wheel
      const patch = mutation.patch
      const valueMatches = (['title', 'suggestionsOpen'] as const).every(
        (field) => !(field in patch) || wheel[field] === patch[field],
      )

      return valueMatches || versionCaughtUp
    }
  }
}

/**
 * Drop every entry whose change is now visible in `live`.
 *
 * Returns the SAME array reference when nothing is retired, which is not a
 * micro-optimisation: ./use-wheel-session.ts calls this from an effect whose
 * dependencies include the entries themselves, so a fresh array on every call
 * is an infinite render loop.
 *
 * Worth knowing what breaking it looks like, because it is not a failing test.
 * React does not depth-limit an effect-to-dispatch-to-effect chain the way it
 * does a setState during render, so there is no "Maximum update depth" to read
 * — the suite simply never finishes, and CI times out with no failure to point
 * at. The identity assertions in ./optimistic.test.ts exist to fail first, in
 * milliseconds, on the pure function rather than in the hook.
 */
export function retireLanded(
  entries: PendingEntry[],
  live: LiveState,
): PendingEntry[] {
  const kept = entries.filter((entry) => !hasLanded(entry, live))
  return kept.length === entries.length ? entries : kept
}

/**
 * Fold the outstanding mutations into the live state.
 *
 * Pure in the strict sense React requires: no clock, no randomness, and the
 * same inputs give the same output however many times a render is replayed.
 * The passage of time reaches it only as the `slow` flag an entry already
 * carries.
 */
export function project(
  live: LiveState,
  entries: PendingEntry[],
): ProjectedWheel {
  const outstanding = entries.filter((entry) => !hasLanded(entry, live))

  const saving = { title: false, suggestionsOpen: false }
  const removedOptions = new Set<string>()
  const rejectedSuggestions = new Set<string>()
  const acceptedSuggestions = new Map<string, PendingEntry>()
  const addedOptions: ProjectedOption[] = []
  const addedSuggestions: ProjectedSuggestion[] = []
  let title: string | undefined
  let suggestionsOpen: boolean | undefined

  for (const entry of outstanding) {
    const mutation = entry.mutation
    switch (mutation.kind) {
      case 'add-option':
        addedOptions.push({
          id: entry.key,
          label: mutation.label,
          // Not `new Date(now)`. Nothing renders `addedAt` in v1, and a
          // fabricated timestamp is a value a later feature would order by
          // without knowing it was invented here.
          addedAt: null,
          fromSuggestion: null,
          pending: true,
          optimistic: true,
          slow: entry.slow,
        })
        break

      case 'remove-option':
        removedOptions.add(mutation.optionId)
        break

      case 'submit-suggestion':
        addedSuggestions.push({
          id: entry.key,
          label: mutation.label,
          status: 'pending',
          // Null sorts last in `bySubmissionOrder`, which puts a just-submitted
          // row at the end of the queue — where it would land anyway once the
          // server timestamp arrives, so the row does not jump on reconcile.
          createdAt: null,
          expiresAt: null,
          pending: true,
          optimistic: true,
          slow: entry.slow,
        })
        break

      case 'reject-suggestion':
        rejectedSuggestions.add(mutation.suggestionId)
        break

      case 'accept-suggestion':
        acceptedSuggestions.set(mutation.suggestionId, entry)
        addedOptions.push({
          id: entry.key,
          label: mutation.label,
          addedAt: null,
          // Set to the real suggestion ID, so the projected option carries the
          // same provenance the server is in the middle of writing. It is also
          // what stops an accept and a plain add of the same label being told
          // apart only by their labels.
          fromSuggestion: mutation.suggestionId,
          pending: true,
          optimistic: true,
          slow: entry.slow,
        })
        break

      case 'patch-wheel':
        // Applied in order, so the last write wins locally exactly as it will
        // on the server. Two rapid toggles of the kill switch settle on the
        // second, not on whichever response happens to come back last.
        if ('title' in mutation.patch) {
          title = mutation.patch.title
          saving.title = true
        }
        if ('suggestionsOpen' in mutation.patch) {
          suggestionsOpen = mutation.patch.suggestionsOpen
          saving.suggestionsOpen = true
        }
        break
    }
  }

  const wheel =
    live.wheel === null
      ? null
      : {
          ...live.wheel,
          title: title ?? live.wheel.title,
          suggestionsOpen: suggestionsOpen ?? live.wheel.suggestionsOpen,
          options: [
            ...live.wheel.options
              .filter((option) => !removedOptions.has(option.id))
              .map((option) => ({
                ...option,
                pending: false,
                optimistic: false,
                slow: false,
              })),
            // Appended, because `arrayUnion` appends and Firestore preserves
            // array order (design doc section 6). A new option arriving at the
            // end of the local list is where the snapshot will put it too, so
            // the row does not move when the optimistic entry retires.
            ...addedOptions.filter(
              // An accept whose option has already arrived but whose queue row
              // has not is still outstanding, and drawing its optimistic row
              // alongside the real one is the duplicate this module exists to
              // prevent.
              (added) =>
                added.fromSuggestion === null ||
                !live.wheel?.options.some(
                  (option) => option.fromSuggestion === added.fromSuggestion,
                ),
            ),
          ],
        }

  const suggestions = [
    ...live.suggestions
      .filter((suggestion) => !rejectedSuggestions.has(suggestion.id))
      .map((suggestion) => {
        const accepting = acceptedSuggestions.get(suggestion.id)
        return {
          ...suggestion,
          status: accepting === undefined ? suggestion.status : 'accepted',
          pending: accepting !== undefined,
          optimistic: false,
          slow: accepting?.slow === true,
        } satisfies ProjectedSuggestion
      }),
    ...addedSuggestions,
  ].sort(bySubmissionOrder)

  return {
    wheel,
    suggestions,
    saving,
    pendingCount: outstanding.length,
    slow: outstanding.some((entry) => entry.slow),
  }
}

export type PendingAction =
  | { type: 'begin'; key: string; mutation: Mutation; at: number }
  | {
      type: 'settle'
      key: string
      serverId?: string
      wheelUpdatedAt: Date | null
      queueSeq: number
    }
  | { type: 'fail'; key: string }
  | { type: 'reconcile'; live: LiveState }
  /**
   * Mark these entries as having passed `SLOW_AFTER_MS`.
   *
   * The keys are decided by whoever read the clock, not here — see the note on
   * `PendingEntry.slow` for why the comparison cannot happen during a render.
   */
  | { type: 'slow'; keys: string[] }
  /** Every entry belongs to one wheel; changing wheels discards all of them. */
  | { type: 'reset' }

/**
 * The pending list as a reducer.
 *
 * A rollback is `fail`, which simply drops the entry — there is no failed state
 * to render. The row disappearing IS the rollback, and the error reaches the
 * caller as a rejected promise from ./api-client.ts, which is what
 * TASK-20's toast catches. A failed entry kept around to animate would have to
 * be swept by something, and nothing here owns a timer.
 */
export function pendingReducer(
  entries: PendingEntry[],
  action: PendingAction,
): PendingEntry[] {
  switch (action.type) {
    case 'begin':
      return [
        ...entries,
        {
          key: action.key,
          mutation: action.mutation,
          startedAt: action.at,
          settled: null,
          slow: false,
        },
      ]

    case 'settle':
      // Identity-stable when the key has already gone, as `reset` and `slow`
      // are and for the same reason. A write in flight across a `shareId`
      // change settles after `reset` has emptied the list, and an unguarded
      // `map` would hand back a different empty array — re-firing both effects
      // that depend on this one for a pass that can change nothing.
      if (!entries.some((entry) => entry.key === action.key)) return entries

      return entries.map((entry) =>
        entry.key === action.key
          ? {
              ...entry,
              settled: {
                serverId: action.serverId,
                wheelUpdatedAt: action.wheelUpdatedAt,
                queueSeq: action.queueSeq,
              },
            }
          : entry,
      )

    case 'fail':
      return entries.filter((entry) => entry.key !== action.key)

    case 'reconcile':
      return retireLanded(entries, action.live)

    case 'slow': {
      const keys = new Set(action.keys)
      // Identity-stable when the flag is already set on every named entry, or
      // when the entry has been retired since the timer was scheduled. The
      // effect that dispatches this depends on the list it returns.
      if (!entries.some((entry) => keys.has(entry.key) && !entry.slow)) {
        return entries
      }
      return entries.map((entry) =>
        keys.has(entry.key) && !entry.slow ? { ...entry, slow: true } : entry,
      )
    }

    case 'reset':
      // Identity-stable for the same reason `retireLanded` is: this runs from
      // an effect that also depends on the list it returns.
      return entries.length === 0 ? entries : []
  }
}
