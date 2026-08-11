'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Wheel } from '@/components/wheel/wheel'
import { SoundToggle } from '@/components/wheel/sound-toggle'
import { useSpin } from '@/components/wheel/use-spin'
import { cn } from '@/lib/utils'
import type { WheelApi } from '@/lib/wheels/api-client'
import { DEFAULT_TITLE } from '@/lib/wheels/validation'
import { consumeWheelCreated, markWheelCreated } from '@/lib/wheels/new-wheel'
import { useEditorRole } from '@/lib/wheels/use-editor-role'
import { useWheelSession } from '@/lib/wheels/use-wheel-session'

import { OptionsPanel } from './options-panel'
import { SuggestionsPanel } from './suggestions-panel'
import { WheelHeader } from './wheel-header'
import { SPIN_AGAIN_DELAY_MS, WinnerModal } from './winner-modal'

/**
 * The wheel page, for both roles. Design doc section 2.
 *
 * Everything role-dependent happens here rather than in the server component
 * next door, because role comes from the edit token in the URL fragment and a
 * fragment never reaches a server. Two things resolve before anything renders —
 * the wheel's first snapshot and the token's verification — and they run
 * concurrently, so the wait is the slower of the two rather than their sum.
 *
 * **Both gates, not one.** Rendering as soon as the wheel arrives would show
 * whichever role happened to be the default for a frame and then correct it,
 * which is the flash AC 5 forbids — and it is not a small one here, because
 * role decides the spin button, both panel variants and every control in the
 * header. Waiting for an answer costs a skeleton; guessing costs a page that
 * visibly rearranges itself under the pointer.
 */

export type WheelPageProps = {
  shareId: string
  /** Injected in tests. The browser wants the real one. */
  api?: WheelApi
}

/**
 * The decorative circles, bleeding off two corners. Purely ornamental, so
 * `aria-hidden` and `pointer-events-none`: they are large enough to sit over
 * the header's right-hand controls otherwise.
 */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="bg-accent-200 absolute -top-[140px] -right-[120px] size-[420px] rounded-full opacity-55" />
      <div className="bg-accent-2-200 absolute -bottom-[180px] -left-[100px] size-[380px] rounded-full opacity-50" />
    </div>
  )
}

/** The page ground, shared by the shell and by every state that replaces it. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    /* overflow-x-clip, not -hidden, for the reason app/page.tsx records: the
       negatively positioned circles need clipping, but `hidden` makes this a
       scroll container, which breaks any future position:sticky descendant and
       leaves the page programmatically scrollable sideways. */
    <div className="bg-bg text-foreground relative min-h-screen overflow-x-clip">
      <Backdrop />
      {children}
    </div>
  )
}

/** A whole-page message, for the states with no wheel to draw. */
function Standalone({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <Page>
      <main className="relative mx-auto flex min-h-screen max-w-[520px] flex-col items-center justify-center gap-3 px-5 text-center">
        <h1 className="font-heading text-[32px] leading-tight">{heading}</h1>
        <p className="text-[15px] leading-[1.55] text-neutral-700">
          {children}
        </p>
        {/* `buttonVariants()` on the Link rather than `<Button render={...}>`.
            Base UI's Button defaults `nativeButton` to true and warns when its
            render prop is an anchor, which is correct of it — this is a
            navigation and should be a link with a button's clothes on. */}
        <Link href="/" className={cn(buttonVariants(), 'mt-2')}>
          Make a new wheel
        </Link>
      </main>
    </Page>
  )
}

export function WheelPage({ shareId, api }: WheelPageProps) {
  const router = useRouter()
  const editor = useEditorRole(shareId, api)
  const session = useWheelSession({ shareId, editToken: editor.editToken, api })

  /**
   * An editor looking at what a participant sees. A view of the page and not a
   * change of rights: the token is still held and still valid, which is why the
   * real role is kept separately and the preview toggle survives into it.
   */
  const [previewing, setPreviewing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)

  /**
   * The notice strip: one message at a time, derived rather than stored.
   *
   * AC 3's rejected-token message is a FACT about the URL — it is true for as
   * long as the page is open — so it is computed from `editor.rejected` rather
   * than copied into state by an effect. Copying it would also be a render
   * behind, and would put the message back every time anything else re-rendered
   * after a dismissal.
   *
   * **A dismissal belongs to the notice it dismissed, and the three sources are
   * dismissed differently.** A failure is dismissed by CLEARING it, so the next
   * failure shows even when it carries the same words as the one dismissed
   * before it. The other two get their own flags, because there is nothing to
   * clear — each stays true for the life of the page.
   *
   * One shared `dismissed` boolean is what a previous version had, and it made
   * an unrelated dismissal swallow AC 3's message outright: dismiss a clipboard
   * failure on a plain share link, then paste an edit URL into the address bar,
   * and the refusal is never explained — the page silently stays a viewer.
   */
  const [failure, setFailure] = useState<string | null>(null)
  const [rejectionDismissed, setRejectionDismissed] = useState(false)
  const [creationDismissed, setCreationDismissed] = useState(false)

  const isEditor = editor.role === 'editor'
  const role = isEditor && !previewing ? 'editor' : 'participant'

  const options = session.view.wheel?.options ?? []
  const spin = useSpin(options)

  /**
   * The spin button, so the winner modal has somewhere to put focus back. AC 4
   * asks for the control that opened the modal, and there is no trigger element
   * to infer it from — the modal opens from a timer, four seconds after the
   * click that started the spin.
   */
  const spinButtonRef = useRef<HTMLButtonElement>(null)

  /**
   * "Spin again": close, wait a beat, spin.
   *
   * The timer lives here rather than in the modal because closing unmounts the
   * modal, and an effect cleanup there would clear the timer on the way out —
   * see the note on `SPIN_AGAIN_DELAY_MS`. This component stays mounted across
   * the close, so it is the one that can hold it.
   *
   * `spin()` re-freezes from live options, so it does not matter that
   * `dismiss()` has already thawed the wheel in between.
   */
  const respinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleared on unmount for the same reason `useSpin` clears its settle timer:
  // it is trivial to leave this page inside 120ms, and a callback landing after
  // the tree has gone would spin a wheel nobody is looking at.
  useEffect(() => {
    return () => {
      if (respinTimer.current !== null) clearTimeout(respinTimer.current)
    }
  }, [])

  const spinAgain = useCallback(() => {
    spin.dismiss()

    /**
     * Nothing to queue on a wheel that cannot spin. The freeze is view-only —
     * `live` keeps flowing while the result is up — so a concurrent editor can
     * delete the wheel down to one option during the four seconds this card
     * covers. `spin()` would refuse anyway; skipping the timer means the modal
     * closes onto a wheel whose disabled spin button is already explaining
     * why nothing is moving, rather than onto 120ms of pending nothing.
     */
    if (!spin.canSpin) return

    if (respinTimer.current !== null) clearTimeout(respinTimer.current)
    respinTimer.current = setTimeout(() => {
      respinTimer.current = null
      spin.spin()
    }, SPIN_AGAIN_DELAY_MS)
  }, [spin])

  /**
   * The spin button's own path in, and it exists to kill the queued re-spin.
   *
   * "Spin again" leaves `spin.spin()` sitting on a 120ms timer, and for that
   * beat `spinning` is false — Base UI's `finalFocus` has just put focus back
   * on this very button, enabled, so a second Enter inside the beat is not
   * even clumsy. The press starts a spin at once; then the timer fires a
   * callback CAPTURED while nothing was spinning, whose stale `spinning`
   * sails through `spin()`'s guard and launches a second spin over the first —
   * rotation retargeted mid-flight, a second whoosh and tick train over the
   * one still playing, the settle timer replaced.
   *
   * Dropped rather than deferred, for the same reason `togglePreview` drops
   * it: the direct press is the newer of the two intentions, and it is asking
   * for exactly what the timer was going to do.
   */
  const startSpin = useCallback(() => {
    if (respinTimer.current !== null) {
      clearTimeout(respinTimer.current)
      respinTimer.current = null
    }
    spin.spin()
  }, [spin])

  const onError = useCallback((message: string) => {
    setFailure(message)
  }, [])

  /**
   * Entering the preview closes the result, and refuses outright mid-spin.
   *
   * **Both were once load-bearing and TASK-36 demoted them.** The winner modal
   * and the spin button used to be editor-only, so previewing with a result on
   * screen took away the only control that could call `dismiss()` — the wheel
   * stayed frozen on the snapshot it spun for the rest of the session, added
   * options stopped appearing, and nothing anywhere explained it. Both controls
   * now follow the page into the preview, so neither failure is reachable.
   *
   * They are kept anyway, and it is worth being straight about why, because the
   * comment that used to justify them no longer applies to the code underneath:
   *
   * - `dismiss()` stays because entering the preview is a change of what the
   *   page is showing, and a result card from the editor view riding along into
   *   it is the previous view's leftovers. Safe unconditionally — `dismiss()`
   *   on a wheel with no result is a no-op — so it is one call, not a branch.
   * - The mid-spin refusal stays because rearranging the page under a wheel in
   *   flight is disorienting, not because anything is lost by it. The header
   *   disables the control while `spin.spinning` so there is no dead button;
   *   this guard is what makes it a fact about the page rather than about one
   *   caller.
   */
  const togglePreview = useCallback(() => {
    if (spin.spinning) return

    /**
     * **A re-spin that has been asked for but not started yet is dropped, not
     * left to fire behind the preview.**
     *
     * "Spin again" closes the card and starts the wheel 120ms later, and for
     * those 120ms `spin.spinning` is false — so the guard above does not refuse
     * and the header's control is not disabled. Left alone, the wheel would
     * start moving a tenth of a second into a view the editor asked for and
     * then hold them there, since the way back out is refused for as long as
     * the spin runs.
     *
     * Dropped rather than refused, because the preview is the newer of the two
     * intentions — and a control that ignores a click for a tenth of a second
     * after an unrelated one is worse than a re-spin that did not happen.
     */
    if (respinTimer.current !== null) {
      clearTimeout(respinTimer.current)
      respinTimer.current = null
    }

    spin.dismiss()
    setPreviewing((current) => !current)
  }, [spin])

  /**
   * Fork, then go. Open to both roles by decision 5 — it is the escape hatch
   * for a wheel whose editor has vanished, so the person most likely to need it
   * is a participant.
   */
  const duplicate = useCallback(() => {
    setDuplicating(true)
    void session.duplicate().then(
      (fork) => {
        /**
         * Marked exactly as the create flow marks a new wheel, because a fork
         * is one: `POST /wheels/{shareId}/duplicate` mints its token once, in
         * this response, and there is no way to reissue it. Without this the
         * person who lands on the fork — very often a participant, since the
         * duplicate button is the escape hatch for a wheel whose editor has
         * vanished — becomes its only editor with nothing having told them the
         * URL is the key. Before the navigation, so the page it lands on can
         * find it.
         */
        markWheelCreated(fork.shareId)
        router.push(`/w/${fork.shareId}#e=${fork.editToken}`)
      },
      // Second argument rather than a trailing `.catch`, so this cannot fire
      // for something the success handler threw — see the same note in
      // app/create-wheel-button.tsx. Saying "could not be duplicated" about a
      // fork that exists would strand its token.
      (error: unknown) => {
        setDuplicating(false)
        onError(
          error instanceof Error
            ? error.message
            : 'That wheel could not be duplicated.',
        )
      },
    )
  }, [onError, router, session])

  // Both gates. See the note at the top of this file for why neither is
  // sufficient on its own.
  if (session.status === 'loading' || editor.status === 'resolving') {
    return (
      <Page>
        <main
          className="relative flex min-h-screen items-center justify-center"
          aria-busy
        >
          <p className="text-[15px] text-neutral-600">Loading this wheel…</p>
        </main>
      </Page>
    )
  }

  if (session.status === 'not-found') {
    return (
      <Standalone heading="This wheel is gone">
        A wheel is removed after thirty days without activity, and a share link
        outlives it. Whoever sent you this one may still have a copy.
      </Standalone>
    )
  }

  if (session.status === 'error' || session.view.wheel === null) {
    return (
      <Standalone heading="This wheel could not be loaded">
        Something went wrong reading it. A refresh is worth trying — nothing has
        been changed.
      </Standalone>
    )
  }

  const wheel = session.view.wheel
  const shareUrl = `${globalThis.location?.origin ?? ''}/w/${shareId}`

  /**
   * TASK-21 AC 5: did this tab just make this wheel?
   *
   * **Below every gate above, and that position is the whole point.** The
   * signal is one-shot — `consumeWheelCreated` empties the storage slot — so
   * spending it on a render that cannot show the notice loses the warning
   * outright. Read at the top of the component it was spent during the loading
   * render, which meant a wheel whose first snapshot 404'd or errored returned
   * one of the two branches above, and the reload that then succeeded had
   * nothing left to find: no warning, on the one page whose URL is the only
   * key to the wheel. Here it is only reached on the render that draws the
   * strip.
   *
   * A plain call during render rather than a `useState` initializer, now that
   * it sits after early returns where a hook could not go. Nothing is lost:
   * the answer is memoised per share ID for the life of the page (see the note
   * in lib/wheels/new-wheel.ts on React double-invoking initializers), so every
   * later render — including one caused by a failure showing over this notice —
   * gets the same answer rather than re-spending the slot.
   *
   * It cannot disagree with a server render either. Both gates wait on
   * something asynchronous, so no render that reaches this line happens before
   * hydration is over.
   */
  const created = consumeWheelCreated(shareId)

  /**
   * Three sources, in priority order, and the order is the argument for tagging
   * the notice with its kind rather than reducing it to a string: the dismiss
   * button has to know which state it is dismissing, and a ternary on
   * `failure === null` stopped being readable at two.
   *
   * - A failure first. It is the newest thing to have happened and the only one
   *   the user's own action produced.
   * - Then AC 3's refusal: the URL carried a token and the server would not
   *   have it, so the page has degraded to the participant view rather than to
   *   an error page. The message names the fragment specifically, because a
   *   truncated paste is overwhelmingly the way this happens and "the part
   *   after the #" is the part people drop.
   * - Then TASK-21 AC 5's warning, on a wheel this tab has just created.
   *
   * Only the first pair can genuinely collide — a wheel created here holds the
   * token the create response minted, so it cannot also be a refused one. And
   * because the answer above is remembered rather than re-read, a failure
   * showing over the warning does not consume it: dismiss the failure and the
   * warning is still there, which matters when the failure is the copy button
   * and the warning is about the link they were trying to copy.
   */
  type Notice = { kind: 'failure' | 'rejection' | 'created'; message: string }

  const notice: Notice | null =
    failure !== null
      ? { kind: 'failure', message: failure }
      : editor.rejected && !rejectionDismissed
        ? {
            kind: 'rejection',
            message:
              'That edit link is not valid for this wheel, so you are seeing the shared view. Check you copied the whole link — the part after the # matters.',
          }
        : created && !creationDismissed
          ? {
              kind: 'created',
              message:
                'Bookmark this page before you share it. This URL is your edit key — there are no accounts, so if you lose it there is no way back in. Use Copy share link to send people the view-only version.',
            }
          : null

  /**
   * Clearing the failure rather than flagging it is what lets an identical
   * message announce itself again the next time it happens. The other two have
   * nothing to clear.
   */
  function dismissNotice(kind: Notice['kind']) {
    if (kind === 'failure') setFailure(null)
    else if (kind === 'rejection') setRejectionDismissed(true)
    else setCreationDismissed(true)
  }

  return (
    <Page>
      <WheelHeader
        title={wheel.title === '' ? DEFAULT_TITLE : wheel.title}
        role={role}
        isEditor={isEditor}
        previewing={previewing}
        onTogglePreview={togglePreview}
        spinning={spin.spinning}
        savingTitle={session.view.saving.title}
        /* The same signal the notice below is drawn from. A wheel arrives
           called "Untitled wheel" and naming it is the first thing its creator
           came here to do, so the field opens on it rather than waiting to be
           discovered behind a hover state. `WheelTitle` reads this once, on
           mount, so dismissing the field does not re-open it. */
        titleStartsInEdit={created && isEditor}
        onRename={session.setTitle}
        onDuplicate={duplicate}
        duplicating={duplicating}
        shareUrl={shareUrl}
        onError={onError}
      />

      {notice !== null && (
        <div
          role="status"
          className="border-accent-300 bg-accent-100 text-accent-800 relative mx-5 mt-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm sm:mx-10"
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => {
              dismissNotice(notice.kind)
            }}
            className="cursor-pointer text-lg leading-none"
            aria-label="Dismiss this message"
          >
            ×
          </button>
        </div>
      )}

      {/* Wheel first in the DOM, which is also wheel first when the grid
          collapses — decision 14. No `min-width` on either column below `lg`,
          so nothing can force a horizontal scrollbar at 320px. */}
      <main className="relative grid items-start gap-[34px] px-5 pt-[34px] pb-[60px] sm:px-10 lg:grid-cols-[minmax(380px,1fr)_minmax(400px,1fr)]">
        <section className="border-divider relative flex flex-col items-center gap-5 rounded-[var(--radius-lg)] border bg-neutral-100 p-5 shadow-[var(--shadow-sm)] sm:p-7">
          <div className="w-full max-w-[480px]">
            <Wheel
              options={spin.options}
              rotation={spin.rotation}
              transition={spin.transition}
              title={wheel.title}
            />
          </div>

          {/*
            Both roles, and TASK-36 is where that changed. The spin was editor
            only, which left a viewer reading a list beside a wheel that never
            moved — and the reason it was withheld does not survive inspection.
            Decision 13 answers "does a participant see the EDITOR's spin", and
            that answer is still no; a spin of their OWN is the same local,
            unpropagated thing an editor's already is. Nothing is written,
            nothing is read, and nobody else's page changes.

            `focusableWhenDisabled`, because this button DISABLES ITSELF under
            the keyboard user most entitled to be on it. Closing the winner card
            puts focus back here — AC 4 — and both a direct press and the queued
            "Spin again" then set `spinning` within the beat. A natively
            disabled button is dropped from the tab order, so the browser moves
            focus to `<body>`: a screen reader announces nothing, or reads from
            the top of the document, for the whole 4.4 seconds of a spin that
            user just started. Kept focusable, the button holds focus and reads
            as what it is — "Spinning…", unavailable — until the modal's
            `initialFocus` takes over at the settle.

            TASK-17 AC 5's announcement itself lives with the winner modal,
            inside its portal — see the note there for why the page proper
            cannot carry a live region that survives the modal opening.
          */}
          <Button
            ref={spinButtonRef}
            size="lg"
            onClick={startSpin}
            disabled={!spin.canSpin}
            focusableWhenDisabled
            className="px-[46px] py-4 text-xl shadow-[var(--shadow-md)]"
          >
            {spin.spinning ? 'Spinning…' : 'Spin the wheel'}
          </Button>

          {/*
            Under the button rather than instead of it, and the wording carries
            the whole of design doc section 6's copy rule.

            The rule used to be "leave the spin out of it", because there was no
            spin here to describe. Now there is, and what the copy must not
            imply is that it is SHARED — the prototype's "Watching live" would be
            wrong in the other direction now, promising an editor's rotation
            that still never arrives. So the line names the spin and denies the
            propagation in the same breath, which is also the honest answer to
            the question a viewer actually has: did everyone just see that?

            Nothing equivalent for an editor. Their spin is equally local, but
            they are the one person on the page who already knows what the wheel
            is for, and a standing disclaimer under the primary action of the
            product reads as an apology for it.
          */}
          {role === 'participant' && (
            /*
              `pb-7` reserves the corner the sound toggle sits in, and it is not
              cosmetic. The toggle is 36px at `bottom-3`, so it rises 48px from
              the section's padding edge while the content box stops at `p-5`'s
              20px — it intrudes 28px into the flow, over whatever the last
              in-flow child is. That used to be a centred button, which is never
              wide enough to reach the corner; it is now this paragraph, and at
              320px — the narrowest width the grid above is built to survive —
              its final line runs under the toggle. Measured, not guessed: the
              collision is at 320 and the clearance at 360 is 39px, which is one
              re-wrap away from being nothing.

              On the paragraph rather than on the section, because only the
              participant view has a last child that can reach that far, and
              padding the card would move the toggle with it.
            */
            <p className="max-w-[420px] pb-7 text-center text-[15px] leading-[1.55] text-neutral-600">
              {previewing
                ? 'This is what everyone with the share link sees. A spin here is your own — it is not sent anywhere.'
                : 'Spin it as often as you like — the result is yours alone and is not sent to anyone else. Suggest an option below if something is missing.'}
            </p>
          )}

          {/*
            `onClose` is `dismiss`, and that is not a detail: the wheel holds its
            frozen snapshot from spin start until something calls it, so a modal
            that closed on its own state would leave the wheel showing a stale
            option list for the rest of the session — added options stop
            appearing, and it reads as a broken listener rather than a missing
            call.

            Rendered unconditionally with `open` doing the work, rather than
            behind `spin.result !== null`. Base UI restores focus when its dialog
            CLOSES; a tree yanked out from under it never gets that far, and AC
            4's return to the spin button would be left to the inert
            workaround's fallback alone.

            The empty `label` on the closed pass is not a hole in that: the modal
            holds the last one it was given for exactly this, because "the card
            leaves in the same commit" is very nearly true and not quite — see
            the note on `lastLabel`.
          */}
          <WinnerModal
            open={spin.result !== null}
            label={spin.result?.option.label ?? ''}
            /* The PREVIEWED role, so an editor checking the participant view is
               told what a participant is told — including that the "Picked"
               badge they are about to not see is not missing. */
            role={role}
            onClose={spin.dismiss}
            onSpinAgain={spinAgain}
            returnFocusTo={spinButtonRef}
          />

          {/* In the corner of the card whose wheel makes the noise. Offered to
              both roles because both roles can now make it — a viewer who can
              spin can wake the ticks, and a mute they cannot reach is worse
              than no mute at all. */}
          <SoundToggle className="absolute right-3 bottom-3" />
        </section>

        <section className="flex flex-col gap-[22px]">
          {/* `options`, not `spin.options`. The freeze is about the picture;
              see the note on `OptionsPanelProps.options` for what handing the
              frozen snapshot to the panel would cost. */}
          <OptionsPanel
            options={options}
            role={role}
            picked={spin.picked}
            onAdd={session.addOption}
            onRemove={session.removeOption}
            onError={onError}
          />
          {/* `wheel.suggestionsOpen`, which is the PROJECTED value — the
              optimistic layer has already applied an outstanding toggle, so
              the switch flips on the click rather than on the snapshot. */}
          <SuggestionsPanel
            suggestions={session.view.suggestions}
            role={role}
            suggestionsOpen={wheel.suggestionsOpen}
            savingSuggestionsOpen={session.view.saving.suggestionsOpen}
            onAccept={session.acceptSuggestion}
            onReject={session.rejectSuggestion}
            onSubmit={session.submitSuggestion}
            onSetSuggestionsOpen={session.setSuggestionsOpen}
            onError={onError}
          />
        </section>
      </main>
    </Page>
  )
}
