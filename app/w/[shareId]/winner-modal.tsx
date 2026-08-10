'use client'

import { Dialog } from '@base-ui/react/dialog'
import { useCallback, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Confetti } from '@/components/wheel/confetti'
import { useReducedMotion } from '@/components/wheel/use-spin'
import { useInertBackground } from '@/lib/base-ui-inert'
import { cn } from '@/lib/utils'

/**
 * The payoff moment: the wheel landed, and this says so.
 *
 * Built on Base UI's dialog primitives rather than on components/ui/dialog.tsx,
 * which is a deliberate exception rather than an oversight. `DialogContent`
 * hard-codes shadcn's entrance — `data-open:animate-in fade-in-0 zoom-in-95` —
 * and this card's entrance is the prototype's 320ms overshoot. Both write the
 * `animation` shorthand, and a variant-prefixed class and a plain one are not
 * something tailwind-merge can reconcile, so the pair would resolve by source
 * order in the emitted stylesheet: a coin toss decided somewhere other than
 * here. Everything that made `DialogContent` worth having beyond its styling —
 * the portal, the focus trap, the background-inert workaround — is a primitive
 * or a hook this file uses directly.
 *
 * What this does NOT own is the wheel's frozen snapshot. `useSpin` thaws on
 * `dismiss()` and on nothing else, so `onClose` must be wired to it; see the
 * note on `SpinState.dismiss`.
 */

/**
 * The beat between "Spin again" closing this and the wheel starting to move.
 *
 * Long enough that the card is visibly gone before the rotation begins — the
 * two animations overlapping reads as a glitch rather than as a re-spin — and
 * short enough that the button still feels like it did the thing.
 *
 * **The timer belongs to whatever renders this, not to this component.** A
 * `setTimeout` here would be cleaned up on unmount, and closing IS this
 * component unmounting: the cleanup would clear the timer it just set, every
 * time, and "Spin again" would close the modal and do nothing else.
 */
export const SPIN_AGAIN_DELAY_MS = 120

export type WinnerModalProps = {
  /** The winning label. Rendered as the dialog's title. */
  label: string
  open: boolean
  /** Must reach `useSpin`'s `dismiss`, whatever else it does. */
  onClose: () => void
  /**
   * Close, and spin again. The 120ms beat between the two belongs to the
   * caller — see the note at the call site for why it cannot live here.
   */
  onSpinAgain: () => void
  /**
   * The spin button. AC 4: focus goes back to the control that opened this,
   * and there is no `Dialog.Trigger` here to infer it from — the dialog opens
   * four seconds after the click, from a timer.
   */
  returnFocusTo: React.RefObject<HTMLElement | null>
}

export function WinnerModal({
  label,
  open,
  onClose,
  onSpinAgain,
  returnFocusTo,
}: WinnerModalProps) {
  /**
   * AC 3. The card still appears, and appears instantly — reduced motion is a
   * request to drop the movement, not to drop the announcement. Nothing else
   * has to change with it: the pop animates `scale` alone, so the centring is
   * the translate utility's whether or not the animation runs.
   */
  const reducedMotion = useReducedMotion()

  /**
   * The last label worth showing, so the card cannot be caught with an empty
   * title.
   *
   * The caller drops `label` to `''` in the same commit that sets `open` to
   * false, on the reasoning that the card leaves in that commit and the empty
   * string is never painted. It is not that tight: Base UI keeps the popup
   * mounted and merely `hidden` until its own effect decides the exit
   * animations are done, and that effect is passive — the browser is free to
   * paint the commit before it runs. What would be on screen for that frame is
   * the whole card, kicker and buttons and all, with nothing where the winner
   * goes.
   *
   * State adjusted during render — React's own pattern for a value derived
   * from props that has to survive a prop it should ignore. Not a ref, which
   * `react-hooks/refs` refuses to let a render read, and not an effect, which
   * would be a render behind and so would show the PREVIOUS winner for a frame
   * every time the card opens. That is the same flash this is here to prevent,
   * moved to the moment anyone is actually looking.
   *
   * The condition converges on the first re-render, which is what makes it
   * legal: it only fires while the card is open, and only when the label it is
   * holding is not the one it was given.
   */
  const [shown, setShown] = useState(label)

  if (open && label !== shown) setShown(label)

  // A ref for `initialFocus`, which needs one, and state so that the popup
  // mounting — which happens when this opens, long after this component does —
  // re-runs the inert effect. Identical to the pattern in components/ui/dialog.
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupEl, setPopupEl] = useState<HTMLDivElement | null>(null)
  const attachPopup = useCallback((node: HTMLDivElement | null) => {
    popupRef.current = node
    setPopupEl(node)
  }, [])

  /**
   * Makes the page behind untabbable, which Base UI does not do on its own, and
   * carries the focus-restore fallback the workaround costs — on the Escape
   * path the library's own restore fires while the spin button is still inert
   * and the browser drops it. Without this, Escape leaves focus on `<body>` and
   * a keyboard user starts again from the top of the page.
   */
  useInertBackground(popupEl, open, returnFocusTo)

  return (
    <Dialog.Root
      open={open}
      /**
       * Every close is the same close. Escape, a click on the backdrop, either
       * button — all of them arrive here, and all of them have to reach
       * `dismiss()`, because the wheel stays frozen on its spun snapshot until
       * it runs. A modal that closed on its own state and told nobody would
       * leave the wheel showing a stale option list for the rest of the
       * session, with no error anywhere to explain it.
       */
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <Dialog.Portal>
        {/* The prototype's #2e2b25 at 45%, re-derived from this theme's ink
            rather than copied. theme.css makes the same argument for the
            shadows: Organic's warm literal is stale against a cool ground, and
            the prototype pages override the palette without ever revisiting it.

            **Fades in and does not fade out**, which is a statement about what
            is possible here rather than a preference. Base UI unmounts the
            whole portal once the POPUP's animations are finished, and the popup
            deliberately has no exit animation — so an exit written on the
            backdrop is torn down before it can run. Left in, it would read as
            a fade that somebody had simply failed to notice was not happening.
            The card leaves at once, as it does in the prototype. */}
        <Dialog.Backdrop
          data-slot="winner-backdrop"
          className={cn(
            'fixed inset-0 z-40',
            'bg-[color-mix(in_srgb,var(--color-neutral-900)_45%,transparent)]',
            'duration-100',
            'data-open:animate-in data-open:fade-in-0',
          )}
        />

        {/* Between the backdrop and the card, exactly as the prototype layers
            it: the pieces fall in front of the dimmed page and behind the thing
            being celebrated.

            **Gated on `open`, and that gate is the burst.** The layer takes
            itself out of the DOM once the pieces have landed and only comes
            back on a remount, so what has to be true is that closing unmounts
            it — and the portal is the wrong thing to trust for that. Base UI
            keeps a closed popup mounted until its exit animations are done,
            which it settles on an animation frame; a burst tied to that
            lifetime replays only as reliably as the frame arrives, and in a
            browser window that was merely occluded it never did — the first
            spin burst and no later one, with nothing in the DOM to say why.
            The `open` gate is the dialog's own state and needs no frame.

            It is also what stops a burst that is still falling when the card is
            dismissed early from carrying on over a page with no backdrop. */}
        {open && <Confetti />}

        <Dialog.Popup
          ref={attachPopup}
          // The container, not the first button. The card is announced whole on
          // open — kicker, winner, and what happens next — and the first Tab
          // then lands on "Nice" rather than skipping past it.
          initialFocus={popupRef}
          finalFocus={returnFocusTo}
          data-slot="winner-modal"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[min(460px,92vw)] px-9 pt-10 pb-8',
            'rounded-[var(--radius-lg)] bg-neutral-100 text-center shadow-lg',
            // As on components/ui/dialog.tsx: this element takes focus
            // programmatically, and a ring around the whole card is not the
            // intent. Focus indication inside it is the global :focus-visible.
            'outline-none',
            /**
             * `data-open:`, not a bare class. The pop fills `both`, so written
             * plainly it stays applied to a closed popup and holds it at the
             * final frame — and Base UI decides when a closed popup may leave
             * the DOM by waiting on the animations still attached to it. There
             * is no reason to hand it a filling enter animation to reason
             * about. Scoped to the open state, the animation is gone in the
             * same commit that closes the dialog.
             *
             * There is deliberately no exit animation to replace it: without
             * one the card leaves in the closing commit, which is what makes
             * the empty `label` its caller passes on the way out unpaintable.
             */
            !reducedMotion && 'data-open:animate-winner-pop',
          )}
        >
          {/* Not "Lunch is decided". The prototype's copy narrows the product
              to the one use case its mockup happens to show, and design doc
              section 10 asks the wheel's own vocabulary to be used instead. */}
          <p className="text-accent-700 text-[13px] leading-none font-bold tracking-[0.14em] uppercase">
            The wheel has decided
          </p>

          <Dialog.Title
            className="font-heading text-accent-800 mt-3.5 mb-1.5 text-[44px] leading-[1.05]"
            // The title is the only thing on this card whose length is not
            // known, and a long option would otherwise push the buttons off a
            // short viewport. Breaking mid-word is the lesser evil against a
            // 44px face.
            style={{ overflowWrap: 'anywhere' }}
          >
            {shown}
          </Dialog.Title>

          {/* Decision 15: the badge is this browser's own and the wheel keeps
              every option, which is the one thing people ask about at this
              moment — "is it gone now?". */}
          <Dialog.Description className="mb-[26px] text-[15px] leading-[1.55] text-neutral-700">
            Marked as picked in the list. The wheel keeps every option.
          </Dialog.Description>

          <div className="flex justify-center gap-2.5">
            <Button onClick={onClose} className="px-7 py-3">
              Nice
            </Button>
            <Button
              variant="secondary"
              onClick={onSpinAgain}
              className="px-7 py-3"
            >
              Spin again
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
