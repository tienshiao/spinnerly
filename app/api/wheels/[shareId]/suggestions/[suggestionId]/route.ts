import { writeHeaders } from '@/lib/wheels/request'
import {
  assertEditor,
  EditorAuthError,
  rejectSuggestion,
} from '@/lib/wheels/store'
import { ValidationError } from '@/lib/wheels/validation'

/**
 * DELETE /api/wheels/{shareId}/suggestions/{suggestionId} — reject a
 * suggestion. Design doc section 6.
 *
 * Editor-authenticated, and a hard delete rather than a status flip. The queue
 * is visible to every participant (design doc section 4), so a row marked
 * rejected would leave whatever was submitted on display to everyone until
 * someone built a filter for it — and on a wheel being brigaded, that is the
 * entire problem rather than a detail of it. `status` therefore only ever holds
 * `pending` or `accepted`, and no code path in this application writes a third
 * value.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/suggestions/[suggestionId]'>,
): Promise<Response> {
  const { shareId, suggestionId } = await ctx.params

  try {
    // `shareId` comes from the path here and nowhere else — see the
    // confused-deputy note in store.ts.
    await assertEditor(shareId, request)

    const version = await rejectSuggestion(shareId, suggestionId)

    // 204 whether or not a document was there to delete. A suggestion that is
    // already gone is the normal outcome of a retried request or of two editors
    // clearing the same spam, and a 404 would show an error for an operation
    // that did exactly what was asked.
    return new Response(null, {
      status: 204,
      headers: writeHeaders(version),
    })
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error(
      'DELETE /api/wheels/[shareId]/suggestions/[suggestionId] failed',
      error,
    )

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong rejecting that suggestion.',
      },
      { status: 500 },
    )
  }
}
