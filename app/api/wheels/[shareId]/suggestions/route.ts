import { z } from 'zod'

import { domainCheck, parseBody } from '@/lib/wheels/request'
import { EditorAuthError, submitSuggestion } from '@/lib/wheels/store'
import {
  validateSuggestionLabel,
  ValidationError,
} from '@/lib/wheels/validation'

/**
 * POST /api/wheels/{shareId}/suggestions — submit a suggestion. Design doc
 * section 6.
 *
 * **Unauthenticated, and the only route in the application that is.** Anyone
 * holding the share URL may call it, which is the point: participants arrive
 * from a group chat with no account and nothing to sign in to (design doc
 * section 2).
 *
 * That also makes it the one endpoint an attacker can call without a credential,
 * so it is a billing surface as much as a correctness one (design doc section
 * 7). Three things bound it, and none of them is rate limiting, which is
 * deferred out of v1 for want of a state store to keep the counters in:
 *
 *  - The share URL is an unguessable capability, so reaching this route at all
 *    means someone gave you the link or you scraped it from where it was pasted.
 *  - `suggestionsOpen` is the editor's kill switch, checked in `submitSuggestion`.
 *  - `PENDING_SUGGESTIONS_MAX` caps what one wheel can be made to hold.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

/**
 * The body this endpoint accepts: a label, and nothing else.
 *
 * `z.unknown()` rather than `z.string()` because the type check belongs to the
 * validator that reports it — see the layering note in lib/wheels/request.ts.
 * What comes out of the parse is the sanitised label, so the handler cannot
 * write the raw one.
 *
 * `validateSuggestionLabel` and not `validateOptionLabel`, even though the two
 * enforce the same cap. Accepting a suggestion copies its label into `options`
 * (design doc section 4), so the two rules have to agree — but the message a
 * participant sees should say "suggestion", and keeping the call sites distinct
 * is what lets the wording differ without the limits drifting.
 *
 * `.strict()` so `status`, `createdAt` or anything else a client invents is
 * refused rather than ignored. Every other field of a suggestion is the
 * server's, and there is no second field here for a caller to set.
 */
const SubmitSuggestionBody = z
  .object({
    label: z.unknown().transform(domainCheck(validateSuggestionLabel)),
  })
  .strict()

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/suggestions'>,
): Promise<Response> {
  const { shareId } = await ctx.params

  try {
    // The body is parsed BEFORE anything is read from Firestore, which reverses
    // the order every editor route uses. There, authorization runs first so a
    // caller without the token learns nothing about whether their body was well
    // formed. Here there is no token and so nothing to protect, and the ordering
    // that matters instead is the billing one: a malformed submission is refused
    // by CPU we were spending anyway rather than by a document read we pay for.
    const { label } = await parseBody(request, SubmitSuggestionBody)

    // `shareId` from the path, as everywhere else — see the confused-deputy
    // note in store.ts.
    const suggestion = await submitSuggestion(shareId, { label })

    return Response.json(
      {
        id: suggestion.id,
        label: suggestion.label,
        status: suggestion.status,
        // No `createdAt`. It is a server timestamp, so the only value this
        // handler could put here is one it made up locally, which would differ
        // from what was stored and would order the queue wrongly for whoever
        // trusted it. The snapshot listener delivers the real one.
      },
      {
        status: 201,
        headers: { 'cache-control': 'no-store' },
      },
    )
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error('POST /api/wheels/[shareId]/suggestions failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong submitting that suggestion.',
      },
      { status: 500 },
    )
  }
}
