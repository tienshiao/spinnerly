'use client'

import { useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { createWheelApi, type WheelApi } from '@/lib/wheels/api-client'
import { markWheelCreated } from '@/lib/wheels/new-wheel'

/**
 * How a wheel comes into existence: one click, no account, no form.
 *
 * `POST /api/wheels` and then straight into the new wheel's EDIT url, with the
 * token in the fragment and nowhere else — design doc section 2. The token is
 * emitted exactly once, in that response, and cannot be reissued: there are no
 * accounts and no recovery path, so anything that drops it on the way to the
 * address bar has destroyed the wheel's only key.
 *
 * **Three places the token must never reach, all of them easy to arrive at.**
 * A query string, which is sent to the server and lands in access logs, in
 * `Referer` on every outbound link, and in whatever analytics gets added later.
 * A path segment, same problem with fewer steps. And a log line — including a
 * `console.log` left in during debugging, which on a client component ends up in
 * the browser console of every user rather than in a file someone has to go
 * looking for. The URL is assembled once, here, and the only thing that ever
 * holds it is `router.push`.
 */

/**
 * The claim on "a wheel is being made", and why it is not simply per-button.
 *
 * The invariant the ref below defends is a fact about the PAGE, not about one
 * button: the create response is the token's only carrier, so a second creation
 * that navigates first throws the first wheel's token away and leaves a wheel
 * nobody can ever edit. A guard living in component state defends one button
 * against its own double-click and nothing else, and the landing page renders
 * two of these — hero and closing band — either of which can be clicked while
 * the other's request is out. The old page stays mounted and interactive
 * throughout an App Router transition, and a cold start on the first write is
 * budgeted at 1–2s in api-client, so the window is wide open rather than
 * theoretical.
 *
 * `pending` is shared along with the claim, so the other button says "Making
 * it…" too. That is honest: the page really is making a wheel, and a button
 * that stays live while claiming to be refused would be the more confusing
 * half-measure. `failure` stays local — it belongs beside the button that was
 * actually pressed.
 */
type CreateWheelClaim = {
  pending: boolean
  /** `false` when someone else already holds it. */
  take: () => boolean
  release: () => void
}

const ClaimContext = createContext<CreateWheelClaim | null>(null)

function useClaim(): CreateWheelClaim {
  /**
   * A ref as well as the state, because they answer at different times.
   * `disabled` is applied on the next render; a double-click fast enough to
   * land both events before it would post twice.
   */
  const held = useRef(false)
  const [pending, setPending] = useState(false)

  const take = useCallback(() => {
    if (held.current) return false
    held.current = true
    setPending(true)
    return true
  }, [])

  const release = useCallback(() => {
    held.current = false
    setPending(false)
  }, [])

  return useMemo(() => ({ pending, take, release }), [pending, take, release])
}

/**
 * Wraps the buttons that should share one claim. `children` is passed through
 * untouched, so a server component subtree stays a server component subtree —
 * the landing page keeps its single client boundary rather than gaining one
 * around everything between its two call-to-action buttons.
 */
export function CreateWheelProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const claim = useClaim()
  return <ClaimContext value={claim}>{children}</ClaimContext>
}

export type CreateWheelButtonProps = {
  children: React.ReactNode
  /** The label while the request is in flight. Distinct per call site. */
  pendingLabel?: string
  className?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  /** Injected in tests. The browser wants the real one. */
  api?: WheelApi
}

export function CreateWheelButton({
  children,
  pendingLabel = 'Making it…',
  className,
  variant,
  api: providedApi,
}: CreateWheelButtonProps) {
  const router = useRouter()
  const api = useMemo(() => providedApi ?? createWheelApi(), [providedApi])

  const [failure, setFailure] = useState<string | null>(null)

  /**
   * The shared claim when a provider is above, this button's own when there is
   * not. Both hooks run unconditionally — a lone button is a legitimate call
   * site, and the fallback is what keeps it one.
   */
  const shared = useContext(ClaimContext)
  const own = useClaim()
  const claim = shared ?? own
  const { pending } = claim

  const create = useCallback(() => {
    if (!claim.take()) return
    setFailure(null)

    void api.createWheel().then(
      (created) => {
        // Before the navigation, so the page it lands on can find it. See
        // lib/wheels/new-wheel.ts for why this is not a query parameter.
        markWheelCreated(created.shareId)

        /**
         * Not encoded, and safe rather than lucky: `mintEditToken` emits
         * base64url precisely because a URL fragment is the token's only home,
         * so the alphabet holds nothing a fragment would eat. lib/wheels/tokens.ts
         * carries the same note, and this is the second place a move to plain
         * base64 would break.
         */
        router.push(`/w/${created.shareId}#e=${created.editToken}`)

        // The claim is deliberately NOT released. The request is done but the
        // navigation is not, and a button that springs back to "Make a wheel"
        // for the frames in between invites the second click this whole
        // component is arranged to refuse.
      },
      /**
       * The rejection handler is `then`'s SECOND argument rather than a `.catch`
       * chained after it, and the difference is the wheel. A trailing `.catch`
       * also catches whatever the success handler throws — so a throw out of
       * `router.push` would re-enable the button under "That wheel could not be
       * made", when in fact it was made and its only token has just unwound
       * with the closure. The next click then creates a second wheel and
       * orphans the first, which is the outcome the claim exists to prevent.
       * Here the handler can only see what `createWheel` itself rejected with.
       */
      (error: unknown) => {
        claim.release()
        setFailure(
          error instanceof Error
            ? error.message
            : 'That wheel could not be made. Try again in a moment.',
        )
      },
    )
  }, [api, claim, router])

  return (
    /* `inline-flex flex-col` rather than a bare fragment: the failure has to go
       somewhere, and every call site puts this button in a flex row where a
       loose paragraph would become a sibling column. */
    <span className="inline-flex flex-col items-start gap-1.5">
      <Button
        variant={variant}
        className={className}
        onClick={create}
        disabled={pending}
      >
        {pending ? pendingLabel : children}
      </Button>

      {failure !== null && (
        /* No colour class, deliberately. This button appears both on the page
           ground and inverted on the accent band, and a fixed ink would be
           unreadable on one of them; inheriting is correct on both. */
        <span role="alert" className="max-w-[280px] text-[13px] leading-snug">
          {failure}
        </span>
      )}
    </span>
  )
}
