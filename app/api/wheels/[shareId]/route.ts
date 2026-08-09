import { z } from 'zod'

import { domainCheck, parseBody, writeHeaders } from '@/lib/wheels/request'
import {
  assertEditor,
  EditorAuthError,
  updateWheel,
  type WheelPatch,
} from '@/lib/wheels/store'
import { validateTitle, ValidationError } from '@/lib/wheels/validation'

/**
 * PATCH /api/wheels/{shareId} — update the title and the suggestions kill
 * switch. Design doc section 6.
 *
 * Editor-authenticated. `suggestionsOpen` is the owner's only tool while a wheel
 * is actively being spammed (design doc section 7), so it shares a route with
 * the title rather than living behind something more ceremonious.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 */
export const runtime = 'nodejs'

/**
 * Reject an `options` key rather than ignoring it.
 *
 * Silently dropping it would leave a client believing it had reordered or
 * replaced the option list. Worse, a client that believed that would be
 * *right* to expect it — a whole-array write is the obvious way to model this
 * endpoint and the reason it is wrong is not obvious at all, so the message has
 * to say where the operation actually lives.
 */
function rejectOptions(): never {
  throw new ValidationError(
    400,
    'options_not_patchable',
    'Options cannot be set through this endpoint. Add and remove them one at a time, so two editors working at once cannot overwrite each other.',
  )
}

/**
 * The body this endpoint accepts. Every field optional; absent means unchanged.
 *
 * `.transform(...).optional()` and NOT `.optional().transform(...)`. The
 * ordering is the difference between a working partial update and one that
 * rejects every request: with `.optional()` last, an absent key skips the
 * transform entirely and leaves the key off the parsed object, which is what
 * makes `'title' in body` mean "the caller sent one". With `.optional()` first
 * the transform still runs, `validateTitle` is handed `undefined`, and a patch
 * that only toggles `suggestionsOpen` comes back 400.
 *
 * `validateTitle` rather than `validateNewWheelTitle` because there is no
 * defaulting here: a title that is present must be a real one, and an absent
 * title means leave it alone. Those are the two cases, and DEFAULT_TITLE is
 * neither — applying it here is how an editor closing suggestions on a brigaded
 * wheel would find it silently renamed.
 *
 * `.strict()` so an unrecognised key is refused rather than ignored. A client
 * misspelling `suggestionsOpen` should be told, not quietly left with a wheel
 * that never closes.
 */
const PatchWheelBody = z
  .object({
    title: z.unknown().transform(domainCheck(validateTitle)).optional(),
    suggestionsOpen: z.boolean().optional(),
    options: z.unknown().transform(domainCheck(rejectOptions)).optional(),
  })
  .strict()

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/wheels/[shareId]'>,
): Promise<Response> {
  const { shareId } = await ctx.params

  try {
    // Before the body is read, and deliberately. A caller without this wheel's
    // token learns nothing about whether their body was well formed, and no
    // parsing work is done on their behalf. `shareId` comes from the path here
    // and nowhere else — see the confused-deputy note in store.ts.
    await assertEditor(shareId, request)

    const body = await parseBody(request, PatchWheelBody)

    // `in` rather than a truthiness or undefined check: `suggestionsOpen: false`
    // is the whole point of the field, and `'x' in body` is what the schema's
    // `.optional()` placement was arranged to make meaningful.
    const patch: WheelPatch = {}
    if ('title' in body) patch.title = body.title
    if ('suggestionsOpen' in body) {
      patch.suggestionsOpen = body.suggestionsOpen
    }

    if (Object.keys(patch).length === 0) {
      // Refused rather than treated as a no-op that still slides expiry. A patch
      // with nothing in it is a client bug, and answering 204 would hide it.
      throw new ValidationError(
        400,
        'empty_patch',
        'That request changes nothing. Send a title, suggestionsOpen, or both.',
      )
    }

    const version = await updateWheel(shareId, patch)

    return new Response(null, {
      status: 204,
      headers: writeHeaders(version),
    })
  } catch (error) {
    if (error instanceof EditorAuthError) return error.toResponse()
    if (error instanceof ValidationError) return error.toResponse()

    console.error('PATCH /api/wheels/[shareId] failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong updating that wheel.',
      },
      { status: 500 },
    )
  }
}
