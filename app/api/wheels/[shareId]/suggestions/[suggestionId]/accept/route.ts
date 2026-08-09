import { writeHeaders } from '@/lib/wheels/request'
import {
  acceptSuggestion,
  assertEditor,
  EditorAuthError,
} from '@/lib/wheels/store'
import { ValidationError } from '@/lib/wheels/validation'

/**
 * POST /api/wheels/{shareId}/suggestions/{suggestionId}/accept — promote a
 * suggestion onto the wheel. Design doc section 6.
 *
 * Editor-authenticated. The work is one transaction — `arrayUnion` onto
 * `options` plus the status flip together — so a double-click cannot duplicate
 * an option (design doc section 4). `acceptSuggestion` holds that; this handler
 * only decides what to answer.
 *
 * A verb in the path rather than a `PATCH` setting `status: "accepted"`, because
 * this is not an edit to the suggestion. It writes an option onto another
 * document, and modelling it as a field update would invite a client to send
 * `status: "rejected"` — a value the data model does not have (design doc
 * section 4) and that this API must never be able to write.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]/accept'>,
): Promise<Response> {
  const { shareId, suggestionId } = await ctx.params

  try {
    // `shareId` comes from the path here and nowhere else — see the
    // confused-deputy note in store.ts. `suggestionId` is from the path too and,
    // unlike an optionId, does reach a document path, so `acceptSuggestion`
    // validates its shape before using it.
    await assertEditor(shareId, request)

    // There is no body to read. Nothing about which suggestion, or what to do
    // with it, is expressible in one — the path says both — and reading a body
    // nobody sends would only create a shape for a client to get wrong.
    //
    // The return value, the option this call created, is deliberately not in the
    // response. It is `null` when the suggestion had already been accepted, and
    // a response that sometimes carries an option and sometimes does not is a
    // shape every client has to branch on for no gain: the wheel is a single
    // document with a single listener, so the new option arrives there either
    // way (design doc section 4).
    const version = await acceptSuggestion(shareId, suggestionId)

    // 204 on the second call as much as the first. Accepting twice is what a
    // double-click and a retried request both look like, and answering an error
    // to an operation that succeeded is the failure mode worth avoiding — the
    // same argument the option DELETE makes.
    return new Response(null, {
      status: 204,
      headers: writeHeaders(version),
    })
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error(
      'POST /api/wheels/[shareId]/suggestions/[suggestionId]/accept failed',
      error,
    )

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong accepting that suggestion.',
      },
      { status: 500 },
    )
  }
}
