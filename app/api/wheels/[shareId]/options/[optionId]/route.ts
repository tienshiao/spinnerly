import { writeHeaders } from '@/lib/wheels/request'
import { assertEditor, EditorAuthError, removeOption } from '@/lib/wheels/store'
import { ValidationError } from '@/lib/wheels/validation'

/**
 * DELETE /api/wheels/{shareId}/options/{optionId} — remove one option. Design
 * doc section 6.
 *
 * Editor-authenticated, and the mirror of the add endpoint: one option per
 * request, removed with `arrayRemove`, so the options array is never written as
 * a whole and a concurrent add cannot be erased by this write.
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
  ctx: RouteContext<'/api/wheels/[shareId]/options/[optionId]'>,
): Promise<Response> {
  const { shareId, optionId } = await ctx.params

  try {
    // `shareId` comes from the path here and nowhere else — see the
    // confused-deputy note in store.ts. `optionId` is from the path too, but it
    // never reaches a document path: it is matched against ids inside the wheel
    // this route has already authorised.
    await assertEditor(shareId, request)

    // The return value — whether an option was actually matched — is
    // deliberately not reflected in the response. An option that is already gone
    // is a 204 like any other, which is what makes a client safe to retry a
    // DELETE whose response it never saw. A 404 would turn the retry into an
    // error the user is shown for an operation that succeeded.
    const version = await removeOption(shareId, optionId)

    return new Response(null, {
      status: 204,
      headers: writeHeaders(version),
    })
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error(
      'DELETE /api/wheels/[shareId]/options/[optionId] failed',
      error,
    )

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong removing that option.',
      },
      { status: 500 },
    )
  }
}
