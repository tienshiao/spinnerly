import { z } from 'zod'

import { domainCheck, parseBody } from '@/lib/wheels/request'
import { createWheel } from '@/lib/wheels/store'
import { validateNewWheelTitle, ValidationError } from '@/lib/wheels/validation'

/**
 * POST /api/wheels — create a wheel. Design doc section 6.
 *
 * Unauthenticated: there are no accounts, so creating a wheel is what mints the
 * credential rather than something a credential authorises. This is the only
 * endpoint in the app that ever emits a raw edit token, and it emits it once, in
 * the response body, to the caller that caused it to exist.
 *
 * `runtime` is pinned explicitly even though 'nodejs' is the Next.js 16 default.
 * Every route under app/api touches Firestore through the Admin SDK, which uses
 * gRPC over native bindings and cannot run on the Edge Runtime. The explicit
 * export means a future move to edge has to delete a line that says why not,
 * rather than silently inherit a changed default.
 *
 * spinnerly/require-nodejs-runtime enforces this for every route segment under
 * app/api, so deleting the line below fails lint — it is a real guard, not a
 * comment asking nicely.
 */
export const runtime = 'nodejs'

/**
 * The body this endpoint accepts.
 *
 * A title and nothing else. It deliberately does not take an initial options
 * array, even though `createWheel` can write one: creating a wheel is one click
 * from the landing page (TASK-21) and the only bulk-options path is
 * `POST /wheels/{shareId}/duplicate` (TASK-13), which calls `createWheel`
 * directly rather than coming through here. Accepting a list nobody sends would
 * widen the unauthenticated surface — and would need its own capacity check
 * against `OPTIONS_MAX` to avoid writing a wheel past the cap — for no caller.
 *
 * `z.unknown()` rather than `z.string()` because the caps and the sanitisation
 * live in lib/wheels/validation.ts, and a `z.string()` here would take the
 * type check away from the validator that reports it — leaving two places that
 * decide what a title may be. What comes out of the parse is the sanitised
 * title, so the handler below cannot write the raw one by mistake.
 *
 * `.optional()` before `.transform()` matters: a transform still runs when the
 * key is absent, so `validateNewWheelTitle` gets its `undefined` and applies
 * DEFAULT_TITLE. Without it, an absent key is rejected before the validator is
 * consulted at all, and one-click creation stops working.
 */
const CreateWheelBody = z.object({
  title: z.unknown().optional().transform(domainCheck(validateNewWheelTitle)),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const { title } = await parseBody(request, CreateWheelBody)

    const { shareId, editToken } = await createWheel({ title })

    return Response.json(
      { shareId, editToken },
      {
        status: 201,
        headers: {
          // The body is a bearer capability. `no-store` keeps it out of every
          // shared cache, proxy and bfcache between here and the browser that
          // asked for it.
          'cache-control': 'no-store',
        },
      },
    )
  } catch (error) {
    if (error instanceof ValidationError) return error.toResponse()

    // Nothing from the success path is logged anywhere in this handler, which is
    // what keeps the raw token out of Cloud Logging (design doc section 6). This
    // line runs only when `createWheel` or the body read failed, so there is no
    // token in scope to leak — but note that the error is logged, never the
    // response.
    console.error('POST /api/wheels failed', error)

    return Response.json(
      {
        error: 'internal_error',
        message: 'Something went wrong creating that wheel.',
      },
      { status: 500 },
    )
  }
}
