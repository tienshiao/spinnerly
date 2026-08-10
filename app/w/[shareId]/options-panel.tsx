'use client'

import { useState, type Dispatch, type SetStateAction } from 'react'

import { sliceColors } from '@/app/wheel-palette'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ProjectedOption } from '@/lib/wheels/optimistic'
import type { WheelRole } from '@/lib/wheels/use-wheel-session'
import {
  countCharacters,
  OPTION_LABEL_MAX,
  OPTIONS_MAX,
  toStoredForm,
} from '@/lib/wheels/validation'

/**
 * The Options panel, in both variants. Design doc section 2 and the prototype's
 * upper-right panel.
 *
 * One component rather than two, driven by the `role` the page has already
 * resolved — so an editor who opens the participant preview loses the add
 * field, the remove buttons AND the Picked badge in one step, which is what
 * makes the preview honest.
 *
 * It takes data and callbacks and never the session, which is not only taste:
 * every case below is then a matter of rendering this component with props,
 * rather than of driving a wheel through Firestore to arrive at the state under
 * test.
 *
 * **Two decisions from TASK-1 are settled here and the prototype disagrees with
 * both.** Decision 10: labels are static text, and the input the prototype puts
 * on every row is dropped — the API has add and remove and nothing between
 * them, so an editable row would be an affordance for a request that does not
 * exist. Decision 15: the Picked badge is local client state in the spinning
 * browser, with no field and no endpoint behind it.
 *
 * The chrome is deliberately not shared with the Suggestions panel next door
 * (TASK-19). That panel differs in fill, border, shadow, header size and count
 * colour, so the common ancestor would be a box with a `tone` prop and nothing
 * else. If the second one turns out to match after all, extract it then.
 */

export type OptionsPanelProps = {
  /**
   * Live projected options — NOT `useSpin`'s frozen snapshot.
   *
   * The freeze exists to stop the picture reflowing mid-rotation (decision 2).
   * Handing it to this panel as well would make an editor's own add invisible
   * for the 4.4 seconds of a spin, and its optimistic row would appear only
   * once the result was dismissed, which reads as a write that did not go
   * through. The cost is that a removal during a spin shifts the dot colours
   * here while the wheel keeps the ones it froze: the one-to-one with the
   * slices holds outside the spin window rather than inside it.
   */
  options: ProjectedOption[]
  role: WheelRole
  /** Option ids this browser has landed on, from `useSpin`. */
  picked: ReadonlySet<string>
  /** Rejects with `ApiError`; this component reports the failure. */
  onAdd: (label: string) => Promise<void>
  onRemove: (optionId: string) => Promise<void>
  onError: (message: string) => void
}

export function OptionsPanel({
  options,
  role,
  picked,
  onAdd,
  onRemove,
  onError,
}: OptionsPanelProps) {
  const isEditor = role === 'editor'
  const full = options.length >= OPTIONS_MAX

  /**
   * The add field's draft, held here rather than inside `AddRow`, because
   * `AddRow` is unmounted at the cap and state does not survive that.
   *
   * The case is not hypothetical and it is the one where losing the text hurts
   * most: on a wheel at 49, submitting takes the optimistic count to 50, so the
   * add row goes; the server answers 409 `options_full`; the entry rolls back to
   * 49 and the row returns. Were the draft `AddRow`'s own, the restore below
   * would be setting state on an unmounted component and the label would be
   * gone. A concurrent editor filling the wheel while this one is typing costs
   * the same draft for the same reason.
   *
   * Held here, the text waits for the field: remove an option and it comes back
   * as it was typed.
   */
  const [draft, setDraft] = useState('')

  return (
    <section className="border-divider rounded-[var(--radius-lg)] border bg-neutral-100 p-6 shadow-[var(--shadow-sm)]">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-[26px] leading-none">Options</h2>
        <span className="text-[13px] whitespace-nowrap text-neutral-600">
          {countLabel(options.length)}
        </span>
      </div>

      {options.length === 0 ? (
        <p className="text-[15px] leading-[1.55] text-neutral-700">
          {isEditor
            ? 'Nothing on the wheel yet. Add the first option below, then one more — a wheel needs two to spin.'
            : 'Nothing on the wheel yet. The organiser has not added anything to spin for.'}
        </p>
      ) : isEditor ? (
        <EditorList
          options={options}
          picked={picked}
          onRemove={onRemove}
          onError={onError}
        />
      ) : (
        /* `picked` is not passed, so AC 10's "absent from the participant
           variant" is a fact about the tree rather than about a condition
           somebody could later invert. */
        <ParticipantList options={options} />
      )}

      {isEditor &&
        (full ? (
          <p className="mt-3.5 text-[13px] leading-[1.5] text-neutral-600">
            That is the {OPTIONS_MAX}-option maximum. Remove one to add another.
          </p>
        ) : (
          <AddRow
            draft={draft}
            setDraft={setDraft}
            onAdd={onAdd}
            onError={onError}
          />
        ))}
    </section>
  )
}

/** "N on the wheel", per the prototype, with something sensible at zero. */
function countLabel(count: number): string {
  if (count === 0) return 'Nothing on it yet'
  return `${count} on the wheel`
}

function EditorList({
  options,
  picked,
  onRemove,
  onError,
}: {
  options: ProjectedOption[]
  picked: ReadonlySet<string>
  onRemove: (optionId: string) => Promise<void>
  onError: (message: string) => void
}) {
  return (
    // Named, because the wheel beside it renders the same labels as SVG text —
    // so "the options" needs to be somewhere a reader, and a test, can address.
    <ul aria-label="Options on the wheel" className="flex flex-col gap-2">
      {options.map((option, index) => (
        <li key={option.id}>
          <EditorRow
            option={option}
            index={index}
            picked={picked.has(option.id)}
            onRemove={onRemove}
            onError={onError}
          />
        </li>
      ))}
    </ul>
  )
}

function EditorRow({
  option,
  index,
  picked,
  onRemove,
  onError,
}: {
  option: ProjectedOption
  index: number
  picked: boolean
  onRemove: (optionId: string) => Promise<void>
  onError: (message: string) => void
}) {
  function remove() {
    /**
     * Guarded here as well as by the `disabled` below, because the reason is a
     * fact about the row and not about the button: an optimistic id is
     * `local:n` and `DELETE /options/local:n` addresses nothing. See
     * `isOptimisticId` in lib/wheels/optimistic.ts.
     */
    if (option.optimistic) return

    void onRemove(option.id).catch((error: unknown) => {
      onError(
        error instanceof Error
          ? error.message
          : 'That option could not be removed.',
      )
    })
  }

  return (
    <div
      // Undefined rather than false: `aria-busy="false"` is a state a screen
      // reader may announce, and every settled row would carry it.
      aria-busy={option.pending || undefined}
      className={cn(
        'border-divider rounded-pill flex items-center gap-2.5 border py-[7px] pr-2.5 pl-3',
        picked ? 'bg-accent-2-100' : 'bg-neutral-200',
        // The only sign a write is outstanding. The optimistic layer has
        // already drawn the row, so without this an unlanded add is
        // indistinguishable from a landed one.
        option.pending && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        data-slot="option-dot"
        className="rounded-pill size-4 shrink-0"
        // Inline because the value is a palette index, not a theme token — the
        // Nth option is the Nth slice colour, and the wheel indexes the same
        // array the same way.
        style={{ background: sliceColors(index).fill }}
      />

      {/* `break-words`, not `truncate`. A label may be 60 characters and this
          column is 320px wide on a phone; wrapping makes the pill taller,
          truncating hides text with nothing to reveal it. */}
      <span className="min-w-0 flex-1 text-[15px] break-words">
        {option.label}
      </span>

      {picked && (
        <span className="bg-accent-2-200 text-accent-2-800 rounded-pill shrink-0 px-2.5 py-1 text-[11px] font-bold tracking-[0.06em] uppercase">
          Picked
        </span>
      )}

      {option.slow && (
        // Not a live region. Several rows can cross the threshold at once, and
        // announcing each would talk over whatever the editor is doing.
        <span className="shrink-0 text-xs text-neutral-600">Saving…</span>
      )}

      {/* A bare button rather than <Button>: this is a neutral, chromeless 30px
          circle, and every variant we have is either accent-filled or carries a
          divider hairline. */}
      <button
        type="button"
        onClick={remove}
        disabled={option.optimistic}
        // Hover and a × are the whole affordance otherwise, and neither says
        // which option is about to go.
        aria-label={`Remove ${option.label}`}
        className={cn(
          'rounded-pill size-[30px] shrink-0 cursor-pointer text-[18px] leading-none',
          'text-neutral-600 transition-colors',
          'hover:bg-[color-mix(in_srgb,var(--color-text)_9%,transparent)]',
          'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        )}
      >
        ×
      </button>
    </div>
  )
}

/**
 * The read-only variant, and the one most people will meet: a share link opened
 * on a phone in a group chat (decision 14).
 *
 * A vertical stack rather than the prototype's wrapping row of pills. The list
 * is read, not operated: one option per line puts every label at the same left
 * edge, so the eye scans a column instead of hunting along a ragged row whose
 * rhythm changes with each label's length. It also matches the editor variant
 * beside it, which means the preview toggle no longer relayouts the panel. At
 * 320px the wrapping version had already collapsed to one column anyway — this
 * makes that the layout everywhere rather than an accident of narrowness.
 */
function ParticipantList({ options }: { options: ProjectedOption[] }) {
  return (
    <ul aria-label="Options on the wheel" className="flex flex-col gap-2">
      {options.map((option, index) => (
        <li
          key={option.id}
          // The editor row's geometry minus the controls: same dot, same gap,
          // same left edge, so the two variants line up on the same grid. The
          // right padding is the editor's remove button's width given back.
          className="border-divider rounded-pill flex items-center gap-2.5 border bg-neutral-200 py-2 pr-4 pl-3 text-[15px]"
        >
          <span
            aria-hidden
            data-slot="option-dot"
            className="rounded-pill size-4 shrink-0"
            style={{ background: sliceColors(index).fill }}
          />
          <span className="min-w-0 flex-1 break-words">{option.label}</span>
        </li>
      ))}
    </ul>
  )
}

function AddRow({
  draft,
  setDraft,
  onAdd,
  onError,
}: {
  /** Owned by `OptionsPanel` — see there for why it cannot live here. */
  draft: string
  setDraft: Dispatch<SetStateAction<string>>
  onAdd: (label: string) => Promise<void>
  onError: (message: string) => void
}) {
  /**
   * Measured — and sent — as the server will store it, which takes two things
   * and lib/wheels/validation.ts exists in part to argue both.
   *
   * `toStoredForm` normalises to NFC and collapses whitespace, exactly as
   * `validateText` does before it counts. Without it a decomposed `é` — what a
   * Mac produces — counts two code points here and one there, so a 60-character
   * label is refused locally with a message the server would not have sent.
   *
   * `countCharacters`, never `.length`: the server counts code points, so 40
   * emoji read 80 as UTF-16 units and a counter built on `.length` refuses
   * labels that were always going to be accepted.
   */
  const label = toStoredForm(draft)
  const tooLong = countCharacters(label) > OPTION_LABEL_MAX

  function submit() {
    // An empty draft is a stray Enter, not an error worth a message.
    if (tooLong || label === '') return

    /**
     * Cleared first, so the next option can be typed against an empty field —
     * which is how a list actually gets entered — and restored if the write
     * fails, because losing what was typed is the worse half of a failed add.
     *
     * Restored ONLY into a field the editor has left alone. They can type the
     * next option while this one is in flight, and putting the failed label
     * back over it would take away a second one.
     */
    setDraft('')
    void onAdd(label).catch((error: unknown) => {
      setDraft((current) => (current === '' ? label : current))
      onError(
        error instanceof Error ? error.message : 'That option was not added.',
      )
    })
  }

  return (
    // A form rather than the prototype's keydown handler: Enter submits by
    // definition, and a phone keyboard offers Go instead of a newline key.
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
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add an option…"
          aria-label="Add an option"
          aria-invalid={tooLong}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={label === '' || tooLong}
        >
          Add
        </Button>
      </div>
      {tooLong && (
        // Not a live region: the field is already `aria-invalid` and this is
        // its visible description, so announcing it twice is noise.
        <span className="text-accent-700 text-xs">
          Options are {OPTION_LABEL_MAX} characters at most.
        </span>
      )}
    </form>
  )
}
