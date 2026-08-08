import { z } from 'zod'

import { domainCheck, parseBody } from '@/lib/wheels/request'
import { addOption, assertEditor, EditorAuthError } from '@/lib/wheels/store'
import { validateOptionLabel, ValidationError } from '@/lib/wheels/validation'

/**
 * POST /api/wheels/{shareId}/options — add one option. Design doc section 6.
 *
 * Editor-authenticated, and granular by design. The edit URL is transferable
 * (design doc section 2), so two editors on two devices is a normal case rather
 * than an edge one, and an endpoint that took the whole options array would have
 * the second editor's write erase the first's. One option per request is what
 * lets `arrayUnion` merge the two adds server-side instead.
 *
 * There is no PATCH counterpart to this route and there should not be: decision
 * 10 makes option labels immutable, because an in-place relabel is the one
 * mutation in this design that would not commute. Fixing a typo is remove and
 * re-add, which the UI should make cheap rather than hide.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

/**
 * Reject a client-supplied `id` rather than ignoring it.
 *
 * `.strict()` would already refuse the key with a generic `invalid_body`, but
 * `id` is the one unknown key a client has a reason to send — design doc section
 * 4 calls the field "client-stable", which reads like an invitation to mint it.
 * It is not: two options sharing an id would make `DELETE .../options/{id}`
 * remove both. The message has to say where the id comes from instead.
 */
function rejectClientId(): never {
  throw new ValidationError(
    400,
    'id_not_settable',
    'Option IDs are assigned by the server. Use the id from this response to key the option.',
  )
}

/**
 * The body this endpoint accepts: a label, and nothing else.
 *
 * `z.unknown()` rather than `z.string()` because the type check belongs to the
 * validator that reports it — see the layering note in lib/wheels/request.ts.
 * What comes out of the parse is the sanitised label, so the handler cannot
 * write the raw one.
 *
 * No `.optional()` anywhere: unlike a patch, every field of an add is required.
 * An add with no label is a client bug, and `validateOptionLabel` rejects the
 * `undefined` it is handed with `invalid_label`.
 *
 * `fromSuggestion` is deliberately absent. It is set by
 * `POST /suggestions/{id}/accept` (TASK-12), which knows the suggestion's real
 * document ID; accepting one here would let a caller claim any option came from
 * a suggestion that never existed.
 */
const AddOptionBody = z
  .object({
    label: z.unknown().transform(domainCheck(validateOptionLabel)),
    // `.transform().optional()`, which is the reverse of the ordering the create
    // route uses and of the one CLAUDE.md describes, and the reversal is
    // load-bearing. There, `.optional()` comes first so the transform still runs
    // on an absent key and can apply a default. Here the transform's whole job
    // is to refuse the key, so it must NOT run when the key is absent —
    // `.optional()` last is what skips it. Written the conventional way round,
    // every well-formed add is refused with `id_not_settable`.
    id: z.unknown().transform(domainCheck(rejectClientId)).optional(),
  })
  .strict()

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]/options'>,
): Promise<Response> {
  const { shareId } = await ctx.params

  try {
    // Before the body is read, and deliberately. A caller without this wheel's
    // token learns nothing about whether their body was well formed, and no
    // parsing work is done on their behalf. `shareId` comes from the path here
    // and nowhere else — see the confused-deputy note in store.ts.
    await assertEditor(shareId, request)

    const { label } = await parseBody(request, AddOptionBody)

    const option = await addOption(shareId, { label })

    return Response.json(
      {
        id: option.id,
        label: option.label,
        // ISO 8601 rather than the Firestore `Timestamp` shape, so a client
        // parses this the same way whether it came from here or from a snapshot
        // listener it converted itself.
        addedAt: option.addedAt.toISOString(),
        fromSuggestion: option.fromSuggestion,
      },
      {
        status: 201,
        headers: { 'cache-control': 'no-store' },
      },
    )
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error('POST /api/wheels/[shareId]/options failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong adding that option.',
      },
      { status: 500 },
    )
  }
}
