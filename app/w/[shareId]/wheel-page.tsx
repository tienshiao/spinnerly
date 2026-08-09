'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useCallback, useState } from 'react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Wheel } from '@/components/wheel/wheel'
import { useSpin } from '@/components/wheel/use-spin'
import { cn } from '@/lib/utils'
import type { WheelApi } from '@/lib/wheels/api-client'
import { DEFAULT_TITLE } from '@/lib/wheels/validation'
import { useEditorRole } from '@/lib/wheels/use-editor-role'
import { useWheelSession } from '@/lib/wheels/use-wheel-session'

import { OptionsPanel } from './options-panel'
import { SuggestionsPanel } from './suggestions-panel'
import { WheelHeader } from './wheel-header'

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
   * **A dismissal belongs to the notice it dismissed, and the two sources are
   * dismissed differently.** A failure is dismissed by CLEARING it, so the next
   * failure shows even when it carries the same words as the one dismissed
   * before it. The rejection gets its own flag, because there is nothing to
   * clear — it stays true for the life of the page.
   *
   * One shared `dismissed` boolean is what a previous version had, and it made
   * an unrelated dismissal swallow AC 3's message outright: dismiss a clipboard
   * failure on a plain share link, then paste an edit URL into the address bar,
   * and the refusal is never explained — the page silently stays a viewer.
   */
  const [failure, setFailure] = useState<string | null>(null)
  const [rejectionDismissed, setRejectionDismissed] = useState(false)

  const isEditor = editor.role === 'editor'
  const role = isEditor && !previewing ? 'editor' : 'participant'

  const options = session.view.wheel?.options ?? []
  const spin = useSpin(options)

  /**
   * AC 3: the URL carried a token, the server refused it, and the page has
   * degraded to the participant view rather than to an error page. The message
   * names the fragment specifically, because a truncated paste is overwhelmingly
   * the way this happens and "the part after the #" is the part people drop.
   */
  const notice =
    failure ??
    (editor.rejected && !rejectionDismissed
      ? 'That edit link is not valid for this wheel, so you are seeing the shared view. Check you copied the whole link — the part after the # matters.'
      : null)

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
    void session
      .duplicate()
      .then((created) => {
        // Straight into the new wheel's EDIT url. The fork's token is emitted
        // exactly once, in this response, and is unrecoverable if dropped.
        router.push(`/w/${created.shareId}#e=${created.editToken}`)
      })
      .catch((error: unknown) => {
        setDuplicating(false)
        onError(
          error instanceof Error
            ? error.message
            : 'That wheel could not be duplicated.',
        )
      })
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
          <span>{notice}</span>
          <button
            type="button"
            // Which state to touch follows from which notice is showing, and
            // `failure` takes precedence above. Clearing the failure rather
            // than flagging it is what lets an identical message announce
            // itself again the next time it happens.
            onClick={() =>
              failure === null ? setRejectionDismissed(true) : setFailure(null)
            }
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
        <section className="border-divider flex flex-col items-center gap-5 rounded-[var(--radius-lg)] border bg-neutral-100 p-5 shadow-[var(--shadow-sm)] sm:p-7">
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
                size="lg"
                onClick={spin.spin}
                disabled={!spin.canSpin}
                className="px-[46px] py-4 text-xl shadow-[var(--shadow-md)]"
              >
                {spin.spinning ? 'Spinning…' : 'Spin the wheel'}
              </Button>

              {/*
                TASK-20 replaces this with the winner modal and the confetti.
                It is here rather than left to that task because `dismiss()` is
                not optional: the wheel holds its frozen snapshot from spin
                start until something calls it, so a spin button shipped without
                one leaves the wheel showing a stale option list for the rest of
                the session — added options stop appearing, and it reads as a
                broken listener rather than a missing call.
              */}
              {spin.result !== null && (
                <div
                  role="status"
                  className="border-accent-2-300 bg-accent-2-100 flex w-full max-w-[480px] items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3"
                >
                  <span className="text-[15px]">
                    Landed on{' '}
                    <strong className="font-heading">
                      {spin.result.option.label}
                    </strong>
                  </span>
                  <Button variant="secondary" size="sm" onClick={spin.dismiss}>
                    Dismiss
                  </Button>
                </div>
              )}
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
                : 'Have a look at what is on the wheel, and suggest a spot if something is missing.'}
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
