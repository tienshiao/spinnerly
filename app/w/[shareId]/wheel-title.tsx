'use client'

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { countCharacters, TITLE_MAX } from '@/lib/wheels/validation'

/**
 * The wheel title in the header: click-to-edit for an editor, static text for a
 * participant. Design doc decision 16 puts it here rather than in a settings
 * panel — renaming a wheel is something you do while looking at its name.
 *
 * The idle state is a button rather than a div with an `onClick`, so it is
 * reachable by keyboard and announced as something that can be activated. The
 * visual is the same either way: Caprasimo at 24px, no chrome until hover.
 */

export type WheelTitleProps = {
  title: string
  editable: boolean
  /** An unlanded title write is outstanding — from `view.saving.title`. */
  saving: boolean
  /** Rejects with `ApiError`; this component reports the failure and reverts. */
  onRename: (title: string) => Promise<void>
  onError: (message: string) => void
}

export function WheelTitle({
  title,
  editable,
  saving,
  onRename,
  onError,
}: WheelTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * Focus AND select, in that order, and both explicitly.
   *
   * `select()` alone is not enough: the spec has it set the selection range and
   * says nothing about moving focus, so the field opens with its text
   * highlighted and the keyboard still pointed at the button that opened it —
   * everything the editor then types goes nowhere. Browsers mostly focus as a
   * side effect and jsdom does not, which is the kind of difference that ships.
   *
   * The selection is worth having on top of the focus: the field opens holding
   * the existing title, and an editor who just pressed "rename" usually means
   * to replace it rather than append to it.
   */
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  /**
   * `editable` is checked before `editing` rather than being synchronised into
   * it. An editor who opens the viewer preview mid-rename sees the static title
   * for as long as the preview lasts, and gets their draft back on the way out;
   * a token the server has just refused takes the input away and never returns
   * it. Neither needs an effect, and an effect that reset `editing` would be
   * one render behind on the way in.
   */
  if (!editable || !editing) {
    const label = (
      <span className="font-heading text-[24px] leading-none">{title}</span>
    )

    if (!editable) return label

    return (
      <button
        type="button"
        onClick={() => {
          setDraft(title)
          setEditing(true)
        }}
        className={cn(
          'cursor-pointer rounded-md px-1 py-0.5 text-left transition-colors',
          'hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)]',
          // The only sign a rename is in flight. The optimistic layer has
          // already put the new title on screen, so without this the header
          // looks identical whether the write has landed or not.
          saving && 'opacity-60',
        )}
        // Hover is the whole affordance otherwise, which says nothing to a
        // screen reader and nothing at all on a touch screen.
        aria-label={`Rename wheel — currently “${title}”`}
      >
        {label}
      </button>
    )
  }

  const trimmed = draft.trim()
  const tooLong = countCharacters(trimmed) > TITLE_MAX

  /**
   * Commit, or don't, and be clear about which.
   *
   * Three of the four cases send nothing. An unchanged title is not an edit; an
   * empty one is a cancel, because a wheel must have a title — `validateTitle`
   * rejects the empty string, so sending it would earn a 400 in answer to what
   * the user meant as "never mind"; and an over-length one is refused here so
   * the editor can shorten what they wrote, rather than after a round trip that
   * throws it away.
   */
  function commit() {
    if (tooLong) return

    setEditing(false)
    if (trimmed === '' || trimmed === title) return

    void onRename(trimmed).catch((error: unknown) => {
      onError(
        error instanceof Error
          ? error.message
          : 'That rename did not go through.',
      )
    })
  }

  return (
    <span className="flex flex-col gap-1">
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        /**
         * Blur is a cancel when the draft is too long, rather than the refusal
         * `commit()` answers with.
         *
         * Refusing is right for Enter — the editor is still in the field and can
         * shorten what they wrote — but blur has already taken the focus away,
         * and `commit()` returns before clearing `editing`. The field would stay
         * open, invalid, and unreachable except by clicking back into something
         * the editor has no reason to think is still live. Reverting matches
         * Escape, and matches the empty draft being a cancel below.
         */
        onBlur={() => (tooLong ? setEditing(false) : commit())}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setEditing(false)
          }
        }}
        aria-label="Wheel title"
        aria-invalid={tooLong}
        className={cn(
          'font-heading border-divider bg-surface w-[min(320px,60vw)] rounded-md',
          'border px-2 py-0.5 text-[24px] leading-none',
          'focus-visible:border-accent focus-visible:outline-offset-0',
          tooLong && 'border-accent-600',
        )}
      />
      {tooLong && (
        // Not a live region: the input is already `aria-invalid` and this is
        // its own visible description, so announcing it twice is noise.
        <span className="text-accent-700 text-xs">
          Titles are {TITLE_MAX} characters at most.
        </span>
      )}
    </span>
  )
}
