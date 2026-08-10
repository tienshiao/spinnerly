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

    if (respinTimer.current !== null) clearTimeout(respinTimer.current)
    respinTimer.current = setTimeout(() => {
      respinTimer.current = null
      spin.spin()
    }, SPIN_AGAIN_DELAY_MS)
  }, [spin])

  const onError = useCallback((message: string) => {
    setFailure(message)
  }, [])

  /**
   * Entering the preview closes the result, so it has to say so.
   *
   * `useSpin` freezes the wheel on the snapshot it spun from the click until
   * `dismiss()` runs, and the result strip below — the only thing that calls it
   * — is editor-only. Toggling into the preview with a result on screen would
   * therefore take away the last control that could thaw the wheel, leaving it
   * showing a stale option list for the rest of the session: added options stop
   * appearing, accepted suggestions never show up, and there is no error
   * anywhere to explain it. Found by spinning and then previewing.
   *
   * Safe in the other direction too — `dismiss()` on a wheel with no result is
   * a no-op — so this is one call rather than a condition.
   *
   * **Refused outright mid-spin**, because there `dismiss()` cannot help: it is
   * guarded against running while a spin is in flight, since thawing then would
   * undo the freeze AC 4 is about. Previewing anyway leaves the wheel frozen AND
   * hides the strip that could thaw it, and the result — which lands 4.4s after
   * the click — is set behind the preview and then cleared unseen on the way
   * back, so the editor never learns what the wheel landed on. The header
   * disables the control while `spin.spinning` so there is no dead button; this
   * guard is what makes it a fact about the page rather than about one caller.
   */
  const togglePreview = useCallback(() => {
    if (spin.spinning) return

    /**
     * **A re-spin that has been asked for but not started yet is dropped, not
     * left to fire behind the preview.**
     *
     * "Spin again" closes the card and starts the wheel 120ms later, and for
     * those 120ms `spin.spinning` is false — so the guard above does not refuse
     * and the header's control is not disabled. Previewing in that gap would
     * start a spin under the participant view, where both the winner modal and
     * the live region are editor-only: the result lands four seconds later with
     * nothing to show it, and is then cleared unseen on the way back. Which is
     * the exact failure the guard above exists to prevent, arrived at through
     * the one window where it does not look.
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

          {role === 'editor' ? (
            <>
              <Button
                ref={spinButtonRef}
                size="lg"
                onClick={spin.spin}
                /*
                  Four ways of saying "a spin is coming", earliest first, so the
                  audio device has as long as possible to wake up. Opening one
                  takes time this page does not control — hundreds of
                  milliseconds for a Bluetooth link — and the first tick is 26ms
                  after the click, so a cold device eats the whole opening
                  flurry and leaves the flourish four seconds later sounding
                  fine.

                  A hover or a focus is worth far more than a press: seconds
                  rather than the length of a click. Neither grants user
                  activation on its own, which is why `warm` checks for it and
                  declines on a page nobody has touched — see its note. The
                  press is the backstop that always works, and it covers touch,
                  where there is no hover to have.
                */
                onPointerEnter={spin.warm}
                onFocus={spin.warm}
                onPointerDown={spin.warm}
                onKeyDown={spin.warm}
                disabled={!spin.canSpin}
                className="px-[46px] py-4 text-xl shadow-[var(--shadow-md)]"
              >
                {spin.spinning ? 'Spinning…' : 'Spin the wheel'}
              </Button>

              {/*
                AC 5, and it is a live region rather than the modal's own
                announcement for two reasons. A `role="status"` only announces
                CHANGES to a region that was already there, so one shipped
                inside the card — which arrives with its text already in it —
                would be silent on the browser and screen reader pairs that read
                the spec strictly. And the modal is suppressed by nothing, but
                its *entrance* is: under reduced motion the card appears with no
                animation at all, and this is what guarantees the result is
                spoken either way.

                The wording matches the modal rather than repeating its whole
                contents, so the two do not read as different events.

                `aria-live` and `aria-atomic` rather than `role="status"`, which
                is exactly what that role expands to. The notice strip above is
                the page's one element with the status ROLE, and leaving it that
                way keeps "the page is telling you something" and "the wheel
                landed on this" distinguishable — to a screen reader user moving
                by role, and to anyone querying for either.
              */}
              <p aria-live="polite" aria-atomic className="sr-only">
                {spin.result === null
                  ? ''
                  : `Landed on ${spin.result.option.label}`}
              </p>

              {/*
                `onClose` is `dismiss`, and that is not a detail: the wheel
                holds its frozen snapshot from spin start until something calls
                it, so a modal that closed on its own state would leave the
                wheel showing a stale option list for the rest of the session —
                added options stop appearing, and it reads as a broken listener
                rather than a missing call.

                Rendered unconditionally with `open` doing the work, rather
                than behind `spin.result !== null`. Base UI restores focus when
                its dialog CLOSES; a tree yanked out from under it never gets
                that far, and AC 4's return to the spin button would be left to
                the inert workaround's fallback alone.

                The empty `label` on the closed pass is not a hole in that: the
                modal holds the last one it was given for exactly this, because
                "the card leaves in the same commit" is very nearly true and not
                quite — see the note on `lastLabel`.
              */}
              <WinnerModal
                open={spin.result !== null}
                label={spin.result?.option.label ?? ''}
                onClose={spin.dismiss}
                onSpinAgain={spinAgain}
                returnFocusTo={spinButtonRef}
              />

              {/* Editor-only, in the corner of the card whose wheel makes the
                  noise. Decision 13 keeps the spin in the spinning browser in
                  v1, so a participant has nothing to mute and a control offered
                  to them would be a promise the page does not keep. */}
              <SoundToggle className="absolute right-3 bottom-3" />
            </>
          ) : (
            /*
              AC 6. The prototype's "Watching live" is gone: decision 13 keeps
              the spin in the spinning browser alone in v1, so any copy hinting
              at a rotation about to happen here describes a feature that does
              not exist, and a participant watching a still wheel for it would
              reasonably conclude the page is broken. What is left says what a
              participant can actually do.
            */
            <p className="max-w-[420px] text-center text-[15px] leading-[1.55] text-neutral-600">
              {previewing
                ? 'This is what everyone with the share link sees.'
                : 'Have a look at what is on the wheel, and suggest an option if something is missing.'}
            </p>
          )}
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
