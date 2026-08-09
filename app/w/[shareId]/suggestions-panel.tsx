'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ProjectedSuggestion } from '@/lib/wheels/optimistic'
import type { WheelRole } from '@/lib/wheels/use-wheel-session'
import {
  countCharacters,
  PENDING_SUGGESTIONS_MAX,
  SUGGESTION_LABEL_MAX,
  toStoredForm,
} from '@/lib/wheels/validation'

/**
 * The Suggestions panel, in both variants. Design doc section 2 and the
 * prototype's lower-right panel.
 *
 * One component driven by the resolved `role`, as `OptionsPanel` is next door,
 * and props rather than the session for the same reason: every state below — a
 * queue at its cap, an accept in flight, a wheel with suggestions closed — is an
 * object literal in the test instead of a wheel driven through Firestore.
 *
 * **The queue is public** (decision 3). Both roles read the same list: it
 * prevents duplicate submissions and makes curation feel collaborative rather
 * than opaque. What differs between them is who may act on a row, not what is
 * on it.
 *
 * Two decisions constrain what a row may show, and both are absences rather
 * than branches:
 *
 * - **Decision 11 — there is no rejected state.** Reject is a hard delete, so a
 *   rejected suggestion vanishes from every viewer rather than turning into a
 *   tombstone. The prototype's Declined chip does not survive into the real app,
 *   and `SuggestionStatus` holds only `pending` and `accepted` — so the absence
 *   is a fact about the type rather than a case somebody could reinstate here.
 * - **Decision 12 — there is no attribution.** No submitter name, no by-line.
 *   `clientHint` was removed outright when section 5 made this subcollection
 *   publicly readable, so there is not even a field to decline to display.
 *
 * The accent-2 chrome is the prototype's and is what visually separates this
 * panel from Options above it: a tinted fill on a tinted border, a smaller
 * heading, and cards whose dashed edge says these are proposals rather than
 * things on the wheel.
 */

export type SuggestionsPanelProps = {
  /** Projected, oldest first. Accepted rows stay in the list — decision 3. */
  suggestions: ProjectedSuggestion[]
  role: WheelRole
  /**
   * The projected value, not the raw one.
   *
   * The optimistic layer applies an outstanding `suggestionsOpen` patch to the
   * wheel it hands back, so this flips on the click rather than on the snapshot
   * — which is what makes the kill switch feel like a switch.
   */
  suggestionsOpen: boolean
  /** A `suggestionsOpen` write is outstanding — from `view.saving`. */
  savingSuggestionsOpen: boolean
  /** All four reject with `ApiError`; this component reports the failure. */
  onAccept: (suggestionId: string, label: string) => Promise<void>
  onReject: (suggestionId: string) => Promise<void>
  onSubmit: (label: string) => Promise<void>
  onSetSuggestionsOpen: (open: boolean) => Promise<void>
  onError: (message: string) => void
}

export function SuggestionsPanel({
  suggestions,
  role,
  suggestionsOpen,
  savingSuggestionsOpen,
  onAccept,
  onReject,
  onSubmit,
  onSetSuggestionsOpen,
  onError,
}: SuggestionsPanelProps) {
  const isEditor = role === 'editor'
  const pending = suggestions.filter(
    (suggestion) => suggestion.status === 'pending',
  ).length

  /**
   * The submit row's draft and its confirmation, held here rather than inside
   * `SubmitRow`, because `SubmitRow` is unmounted by both conditions below and
   * state does not survive that. `OptionsPanel` hoists its own draft for the
   * same reason, and both failures are ordinary rather than hypothetical.
   *
   * **The editor throws the kill switch mid-sentence.** The snapshot arrives,
   * `suggestionsOpen` goes false, the row is replaced by the closed note — and
   * a participant who was halfway through typing loses it. Reopened a moment
   * later, the field would come back empty.
   *
   * **The queue fills to the cap.** The same shape, reachable without an editor
   * at all: another participant's submission takes the projected pending count
   * to `PENDING_SUGGESTIONS_MAX` and the row goes. Worse on this one's own
   * submission — the optimistic entry crosses the cap, the server answers 409
   * `suggestions_full`, the entry rolls back and the row remounts, so the
   * restore below would have been setting state on a component that had gone.
   *
   * Held here, the text waits for the field to come back.
   */
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState(false)

  return (
    <section className="border-accent-2-300 bg-accent-2-100 rounded-[var(--radius-lg)] border p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {/* 22px against the Options panel's 26px, per the prototype. The two
            panels are peers, but this one is the second voice on the page. */}
        <h2 className="font-heading text-[22px] leading-none">Suggestions</h2>
        <span className="text-accent-2-700 text-[13px] whitespace-nowrap">
          {countLabel(pending)}
        </span>
      </div>

      {isEditor && (
        <OpenSwitch
          open={suggestionsOpen}
          saving={savingSuggestionsOpen}
          onToggle={onSetSuggestionsOpen}
          onError={onError}
        />
      )}

      {suggestions.length === 0 ? (
        <p className="text-[15px] leading-[1.55] text-neutral-700">
          {isEditor
            ? 'Nothing waiting. Anyone with the share link can propose a spot, and you decide what lands on the wheel.'
            : 'Nothing suggested yet.'}
        </p>
      ) : (
        // Named, because "the suggestions" has to be addressable by a reader
        // moving through the page by landmark and by a test asserting what is
        // in the queue rather than what is anywhere on screen.
        <ul
          aria-label="Suggestions for this wheel"
          className="flex flex-col gap-2"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <SuggestionRow
                suggestion={suggestion}
                isEditor={isEditor}
                onAccept={onAccept}
                onReject={onReject}
                onError={onError}
              />
            </li>
          ))}
        </ul>
      )}

      {/* AC 5: the submit row belongs to the participant view and to nothing
          else. An editor previewing gets it, because the preview is a claim
          about what a participant sees and an editor may in fact submit — the
          route is unauthenticated. */}
      {!isEditor &&
        (!suggestionsOpen ? (
          <ClosedNote>
            The organiser has closed suggestions on this wheel.
          </ClosedNote>
        ) : pending >= PENDING_SUGGESTIONS_MAX ? (
          /* The field is replaced rather than disabled, for the reason the
             Options panel replaces its add row at the cap: a field that accepts
             typing and then answers 409 wastes the effort it invited. */
          <ClosedNote>
            This wheel already has {PENDING_SUGGESTIONS_MAX} suggestions
            waiting. Ask the organiser to clear some.
          </ClosedNote>
        ) : (
          <SubmitRow
            draft={draft}
            setDraft={setDraft}
            sent={sent}
            setSent={setSent}
            onSubmit={onSubmit}
            onError={onError}
          />
        ))}
    </section>
  )
}

/**
 * The prototype's label, counting PENDING rows only.
 *
 * An accepted suggestion stays in the public queue but is no longer anything
 * anyone has to do, so a wheel whose every suggestion has been actioned reads
 * "all caught up" with rows still on screen. That is the intended reading: the
 * count is a to-do list, not a length.
 */
function countLabel(pending: number): string {
  if (pending === 0) return 'all caught up'
  return `${pending} waiting`
}

/** A message where the submit row would have been. */
function ClosedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-accent-2-300 mt-3.5 rounded-[var(--radius-md)] border border-dashed px-4 py-3 text-[14px] leading-[1.5] text-neutral-700">
      {children}
    </p>
  )
}

/**
 * The `suggestionsOpen` kill switch. Editor-only, and here rather than in the
 * header's overflow menu by decision 16.
 *
 * Design doc section 7 is explicit about why: with rate limiting deferred out of
 * v1, this is the only tool an editor has while a wheel is actively being
 * spammed, so it needs to be within reach of the thing going wrong rather than
 * two clicks deep behind an icon.
 *
 * `role="switch"` with `aria-checked` rather than a `Button` with
 * `aria-pressed`. A pressed button is a toggle whose effect is momentary; this
 * is a persistent setting on the wheel that other people can see the effect of,
 * which is what `switch` means. The accessible name stays "Accepting
 * suggestions" in both states — a name that changed with the state would leave
 * `aria-checked` describing something that had already been renamed under it.
 *
 * **Deliberately not disabled while saving.** The optimistic layer applies the
 * patches in order, so two rapid toggles settle on the second exactly as they
 * will on the server (see `patch-wheel` in lib/wheels/optimistic.ts). Disabling
 * would take the control away for a round trip in the one case where the editor
 * most wants it back — the mis-click during a spam wave.
 */
function OpenSwitch({
  open,
  saving,
  onToggle,
  onError,
}: {
  open: boolean
  saving: boolean
  onToggle: (open: boolean) => Promise<void>
  onError: (message: string) => void
}) {
  function toggle() {
    void onToggle(!open).catch((error: unknown) => {
      onError(
        error instanceof Error
          ? error.message
          : 'That setting could not be changed.',
      )
    })
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={open}
        onClick={toggle}
        className="flex cursor-pointer items-center gap-2.5 text-[13px] text-neutral-700"
      >
        <span
          aria-hidden
          className={cn(
            'rounded-pill relative h-[22px] w-[38px] shrink-0 transition-colors',
            open ? 'bg-accent-2-500' : 'bg-neutral-400',
            // The optimistic value is already on screen, so without this the
            // switch looks identical whether the write has landed or not.
            saving && 'opacity-60',
          )}
        >
          <span
            className={cn(
              'absolute top-[3px] size-4 rounded-full bg-neutral-100 transition-[left]',
              open ? 'left-[19px]' : 'left-[3px]',
            )}
          />
        </span>
        Accepting suggestions
      </button>
    </div>
  )
}

function SuggestionRow({
  suggestion,
  isEditor,
  onAccept,
  onReject,
  onError,
}: {
  suggestion: ProjectedSuggestion
  isEditor: boolean
  onAccept: (suggestionId: string, label: string) => Promise<void>
  onReject: (suggestionId: string) => Promise<void>
  onError: (message: string) => void
}) {
  /**
   * Both controls go while anything about this row is outstanding, and the two
   * reasons are different.
   *
   * `optimistic` is the same fact `EditorRow` guards on in the Options panel: a
   * locally-minted id is `local:n`, and `POST /suggestions/local:n/accept`
   * addresses nothing.
   *
   * `pending` is AC 3's double-click. An accept is a transaction that writes an
   * option and flips the row, and a second one issued before the first lands
   * projects a second optimistic option — TASK-32 has the projection-level fix,
   * and this is the half that belongs to the caller regardless of it: a control
   * for a decision already taken should not be offered again.
   */
  const busy = suggestion.pending || suggestion.optimistic
  const accepted = suggestion.status === 'accepted'

  function accept() {
    if (busy) return
    void onAccept(suggestion.id, suggestion.label).catch((error: unknown) => {
      onError(
        error instanceof Error
          ? error.message
          : 'That suggestion could not be added.',
      )
    })
  }

  function reject() {
    if (busy) return
    void onReject(suggestion.id).catch((error: unknown) => {
      onError(
        error instanceof Error
          ? error.message
          : 'That suggestion could not be removed.',
      )
    })
  }

  return (
    <div
      // Undefined rather than false, as on an option row: `aria-busy="false"`
      // is a state a screen reader may announce, and every settled row in a
      // 200-row queue would carry it.
      aria-busy={suggestion.pending || undefined}
      className={cn(
        // Dashed, which is the panel's whole visual argument: these are
        // proposals, and the solid pills above are what is on the wheel.
        //
        // `flex-wrap` with a basis on the label below is AC 10. The Approve and
        // Reject pair is ~145px of a 248px row at 320px, which left the label
        // about ninety and broke "The bahn mi cart" over four lines. Wrapping
        // the controls onto their own line instead gives the label the width.
        'border-accent-2-400 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-dashed bg-neutral-100 py-2.5 pr-2.5 pl-4',
        suggestion.pending && 'opacity-60',
      )}
    >
      {/* `break-words` rather than `truncate`, for the reason an option row
          gives: a 60-character label in a 320px column has to wrap, and
          truncating hides text with nothing to reveal it.

          There is nothing beside the label — no submitter, no timestamp, no
          second line. Decision 12. */}
      {/* `basis-32` is the width the label asks for before the row wraps, and
          it is tuned to fall between the two control widths at 320px: a state
          chip (~64px) still fits beside it, the Approve and Reject pair
          (~166px) does not and takes the line below. */}
      <span className="min-w-0 flex-1 basis-32 text-[16px] break-words">
        {suggestion.label}
      </span>

      {suggestion.slow && (
        <span className="shrink-0 text-xs text-neutral-600">Saving…</span>
      )}

      {isEditor && !accepted ? (
        // `ml-auto` does nothing on a single line — the label has already taken
        // the slack — and right-aligns the pair against the row's edge on the
        // line of its own it takes at 320px.
        <div className="ml-auto flex shrink-0 gap-1.5">
          {/* Bare buttons rather than <Button>: these are the prototype's
              13px pill pair in the accent-2 voice, and every variant we have
              speaks in the accent-1 one. */}
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            // Names the row, as the option row's remove control does. "Approve"
            // alone is four identical buttons to anyone not looking at them.
            aria-label={`Approve ${suggestion.label}`}
            className={cn(
              'rounded-pill bg-accent-2-500 font-heading cursor-pointer px-[15px] py-[7px] text-[13px] text-neutral-100',
              'hover:bg-accent-2-600 transition-colors',
              'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={busy}
            aria-label={`Reject ${suggestion.label}`}
            className={cn(
              'rounded-pill border-divider font-heading cursor-pointer border px-[15px] py-[7px] text-[13px] text-neutral-700',
              'transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)]',
              'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
            )}
          >
            Reject
          </button>
        </div>
      ) : (
        <StateChip accepted={accepted} />
      )}
    </div>
  )
}

/**
 * What a row says when there is nothing to press: the participant's view of
 * every row, and both roles' view of an accepted one.
 *
 * Two states, and there will never be a third. Decision 11 makes reject a hard
 * delete, so the only way a row leaves `pending` is by being accepted — and a
 * rejected one is not a state at all but an absence.
 */
function StateChip({ accepted }: { accepted: boolean }) {
  return (
    <span
      className={cn(
        'rounded-pill shrink-0 px-3 py-[5px] text-[11px] font-bold tracking-[0.05em] uppercase',
        accepted
          ? 'bg-accent-2-200 text-accent-2-800'
          : 'bg-neutral-200 text-neutral-700',
      )}
    >
      {accepted ? 'Added' : 'Waiting'}
    </span>
  )
}

/**
 * The participant's submit row. Present only in the participant view, and only
 * while the wheel is taking suggestions.
 */
function SubmitRow({
  draft,
  setDraft,
  sent,
  setSent,
  onSubmit,
  onError,
}: {
  /** Both owned by `SuggestionsPanel` — see there for why they cannot live here. */
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  /**
   * The confirmation, cleared on the next keystroke rather than by a timer.
   *
   * There is no unmount hazard left to clean up after, and the message is true
   * until the participant does something else — a confirmation that expires on
   * a clock disappears exactly while somebody is reading it.
   */
  sent: boolean
  setSent: Dispatch<SetStateAction<boolean>>
  onSubmit: (label: string) => Promise<void>
  onError: (message: string) => void
}) {
  /**
   * Measured — and sent — as the server will store it, which `AddRow` in
   * ./options-panel.tsx argues at length: `toStoredForm` so the client and the
   * server count the same string, and `countCharacters` so they count in the
   * same unit. A counter built on `.length` refuses 40 emoji the server would
   * have taken.
   */
  const label = toStoredForm(draft)
  const tooLong = countCharacters(label) > SUGGESTION_LABEL_MAX

  function submit() {
    if (tooLong || label === '') return

    // Cleared first so the next suggestion is typed against an empty field, and
    // restored only into a field the participant has left alone — putting a
    // failed label back over what they have since typed takes away a second one.
    setDraft('')
    setSent(false)
    void onSubmit(label)
      .then(() => setSent(true))
      .catch((error: unknown) => {
        setDraft((current) => (current === '' ? label : current))
        onError(
          error instanceof Error
            ? error.message
            : 'That suggestion was not sent.',
        )
      })
  }

  return (
    // A form rather than a keydown handler, as in the Options panel: Enter
    // submits by definition, and a phone keyboard offers Go instead of a
    // newline key — which matters more here, since the participant view is the
    // mobile one (decision 14).
    <form
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="mt-3.5 flex flex-col gap-1"
    >
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setSent(false)
          }}
          placeholder="Suggest a spot…"
          aria-label="Suggest an option"
          aria-invalid={tooLong}
          className="flex-1"
        />
        <Button type="submit" disabled={label === '' || tooLong}>
          Suggest
        </Button>
      </div>

      {tooLong && (
        // Not a live region: the field is already `aria-invalid` and this is
        // its visible description, so announcing it twice is noise.
        <span className="text-accent-700 text-xs">
          Suggestions are {SUGGESTION_LABEL_MAX} characters at most.
        </span>
      )}

      {sent && !tooLong && (
        /* A live region, unlike the message above, because nothing else says
           this happened where the participant is looking: the optimistic row
           lands at the END of a queue that may be off screen. TASK-20 owns
           toasts and the Toaster is not mounted on this page, so the
           confirmation is local — the same call `WheelHeader`'s copy button
           makes. */
        <span role="status" className="text-accent-2-700 text-xs">
          Sent. The organiser decides what lands on the wheel.
        </span>
      )}
    </form>
  )
}
