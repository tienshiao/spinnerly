/**
 * POST /api/wheels — create a wheel. Implemented in TASK-9.
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

export async function POST() {
  return Response.json(
    { error: 'not_implemented', message: 'Wheel creation lands in TASK-9.' },
    { status: 501 },
  )
}
