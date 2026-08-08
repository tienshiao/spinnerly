import { duplicateWheel, EditorAuthError } from '@/lib/wheels/store'
import { ValidationError } from '@/lib/wheels/validation'

/**
 * POST /api/wheels/{shareId}/duplicate — fork a wheel. Design doc sections 6
 * and 8.
 *
 * **Unauthenticated, and available to participants on purpose.** It is the
 * escape hatch when a wheel expires, when the edit token is lost, or when
 * someone wants to fork the list for their own group, so gating it on the very
 * credential its main users have lost would defeat it. Nothing is disclosed
 * that the share URL did not already expose — a caller can read `title` and
 * `options` straight from Firestore (design doc section 5), and what comes back
 * is a wheel that did not exist a moment ago.
 *
 * This is therefore the second unauthenticated write in the application, and the
 * second and last endpoint that emits a raw edit token. Both facts are bounded
 * the same way `POST /wheels` is: the share URL is an unguessable capability, so
 * reaching this route means someone gave you the link, and what a caller can do
 * with it is create wheels — which they could already do at `POST /wheels`
 * without a link at all. It reads one document more than that endpoint does and
 * writes the same two.
 *
 * Decision 16 puts the affordance in the header overflow menu on the wheel page
 * (TASK-17), shown to both roles, which is the reason it is not editor-only here.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

export async function POST(
  // Unread, and no `parseBody` below. Nothing about a fork is expressible in a
  // body — the path says which wheel, and decision 17 settles that the title is
  // copied verbatim rather than supplied — so accepting one would only create a
  // shape for a client to get wrong. Leaving it unread also means this
  // unauthenticated route never buffers bytes it was going to discard.
  _request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/duplicate'>,
): Promise<Response> {
  const { shareId } = await ctx.params

  try {
    // `shareId` names the SOURCE and comes from the path, as everywhere else.
    // The fork's own ID is minted inside and shadowing matters here: returning
    // the source ID would hand the caller a token that does not open it.
    const fork = await duplicateWheel(shareId)

    return Response.json(
      { shareId: fork.shareId, editToken: fork.editToken },
      {
        status: 201,
        headers: {
          // The body is a bearer capability, as at `POST /wheels`. `no-store`
          // keeps it out of every shared cache between here and the browser
          // that asked for it.
          'cache-control': 'no-store',
        },
      },
    )
  } catch (error) {
    // `EditorAuthError` despite there being no editor on this path: it is the
    // 404 for a wheel that is not there, carried by the class that owns
    // `no_such_wheel` for every route.
    if (error instanceof EditorAuthError) return error.toResponse()
    // 409 `options_full`, from a source holding more options than the current
    // cap allows.
    if (error instanceof ValidationError) return error.toResponse()

    // As at `POST /wheels`: nothing on the success path is logged, which is what
    // keeps the raw token out of Cloud Logging (design doc section 6). This line
    // runs only when the fork failed, so there is no token in scope to leak.
    console.error('POST /api/wheels/[shareId]/duplicate failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong duplicating that wheel.',
      },
      { status: 500 },
    )
  }
}
