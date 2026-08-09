import { assertEditor, EditorAuthError } from '@/lib/wheels/store'

/**
 * GET /api/wheels/{shareId}/editor — does the caller hold this wheel's edit
 * token? Design doc section 6.
 *
 * The one editor-authenticated route that writes nothing. It exists because the
 * page cannot answer the question any other way: the token lives in the URL
 * fragment (design doc section 2), which no request carries to a server, and the
 * security rules in section 5 deny the client every read of `wheelSecrets`. So
 * a browser holding `#e=...` has no evidence at all about whether that token is
 * real, and TASK-17 needs one — a truncated edit URL has to render the
 * participant view and say so, not render a full editor whose every control
 * fails on use.
 *
 * The two alternatives were both worse in a way worth recording, because both
 * look cheaper:
 *
 *  - **Validate on the first mutation.** Trust the token, downgrade on the
 *    first 403. No new surface, but the user composes an edit before finding
 *    out they were never an editor, and whatever they typed is gone.
 *  - **A no-op PATCH.** Uses only endpoints that exist. It is also a write, so
 *    merely OPENING an editor link would slide the wheel's 30-day expiry and
 *    bump `updatedAt` — which every other viewer's listener then delivers as an
 *    edit nobody made.
 *
 * **No `x-wheel-updated-at`.** Every mutating route reports the version it
 * wrote (design doc section 6) and this one writes nothing, so it has no
 * version to report. That is the intended asymmetry rather than an omission:
 * a header here would have to name a version this request did not produce, and
 * lib/wheels/optimistic.ts retires optimistic entries by comparing against
 * exactly that value.
 *
 * **`cache-control: no-store` all the same**, spelled out here rather than
 * taken from `writeHeaders` — which is skipped precisely because there is no
 * version to report, and which would otherwise have carried it. This is the
 * only GET in app/api, so it is the only route a cache would consider storing
 * at all; 204 is on RFC 9111 section 4.2.2's heuristically-cacheable list, and
 * the token that decides the answer travels in a header the URL says nothing
 * about. A cached 204 is a stranger being told they are an editor.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/editor'>,
): Promise<Response> {
  const { shareId } = await ctx.params

  try {
    /**
     * The entire handler. `assertEditor` is called rather than reimplemented so
     * this route cannot drift from the six that write — a check that answered
     * "yes" here and "no" there would be worse than having no check, because
     * the page would confidently render an editor the API refuses.
     *
     * `shareId` comes from the path and nowhere else; see the confused-deputy
     * note in store.ts. That matters more here than anywhere, because this is
     * the endpoint whose entire job is to answer an authorization question, and
     * a version of it that validated the token GLOBALLY would report "editor"
     * to anyone holding any wheel's token.
     */
    await assertEditor(shareId, request)

    // 204 rather than a body saying `{ editor: true }`. There is nothing to
    // describe: the status is the answer, and a body would invite a client to
    // branch on its contents instead of on the status the failures also use.
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    // 401 missing token, 403 wrong token, 404 no such wheel — the same codes
    // and the same messages the write routes answer with, because a client
    // should not have to learn a second vocabulary for the same refusal.
    if (error instanceof EditorAuthError) return error.toResponse()

    console.error('GET /api/wheels/[shareId]/editor failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong checking that edit link.',
      },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    )
  }
}
