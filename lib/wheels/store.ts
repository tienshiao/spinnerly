import 'server-only'

import { FieldValue, type Firestore } from 'firebase-admin/firestore'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  editTokenMatches,
  hashEditToken,
  mintEditToken,
  readBearerToken,
} from './tokens'

/**
 * Server-side wheel data access and the editor guard, per design doc section 6.
 *
 * This is the most security-sensitive module in the codebase. Every write route
 * sits on it, and the two invariants it exists to hold are both easy to break by
 * accident while refactoring:
 *
 *  1. The wheel being written determines which secret is checked. Never the
 *     other way round, and never a caller-supplied choice.
 *  2. The raw edit token is emitted exactly once, by `createWheel`, and is
 *     never stored, logged, or put in a path or query string.
 */

export const WHEELS = 'wheels'
export const WHEEL_SECRETS = 'wheelSecrets'

/** Days a wheel lives without activity. Design doc section 8. */
const EXPIRY_DAYS = 30

/**
 * Firestore auto-IDs are exactly 20 characters of `[A-Za-z0-9]`.
 *
 * Validating the shape is load-bearing rather than hygiene. Both `db.doc(path)`
 * and `collection.doc(id)` resolve SLASHES as path separators, so an
 * unvalidated shareId taken from a URL is a path-traversal primitive: a caller
 * passing `a/b/c` walks into a document of their choosing rather than the one
 * the route means to check. Design doc section 6's rule that a caller "must
 * never be able to name which secret document is checked" is precisely this,
 * and it is not enforced by anything else in the stack.
 */
const SHARE_ID = /^[A-Za-z0-9]{20}$/

export function isShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID.test(value)
}

/**
 * An authorization failure with the status the route should return.
 *
 * `assertEditor` throws rather than returning a result on purpose. A caller who
 * forgets to inspect a returned boolean proceeds to write without authorization;
 * a caller who forgets to catch this gets an unhandled rejection and a 500, and
 * the write does not happen. Both are bugs, but only one of them is a security
 * bug — so the failure mode of misuse is a broken endpoint, not an open one.
 */
export class EditorAuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'EditorAuthError'
    this.status = status
    this.code = code
  }

  /** The response body shape every write route returns for an auth failure. */
  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message },
      { status: this.status },
    )
  }
}

/**
 * Reject a request that does not carry this wheel's edit token.
 *
 * Answers "is this THIS wheel's token?" and never "is this A valid token?".
 * The secret is fetched by document ID, keyed on the shareId the route took
 * from its own path — see the anti-pattern in design doc section 6, where a
 * collection query filtering on `editTokenHash` validates a token globally and
 * hands an editor of wheel A write access to wheel B. `spinnerly/no-wheel-secret-queries`
 * fails lint on that shape so it cannot come back in a refactor.
 *
 * `shareId` must come from the request path. Never from the body, and never
 * from a header the caller controls.
 */
export async function assertEditor(
  shareId: string,
  request: Request,
  db: Firestore = getAdminDb(),
): Promise<void> {
  const presented = readBearerToken(request.headers.get('authorization'))
  if (presented === null) {
    throw new EditorAuthError(
      401,
      'missing_token',
      'This request needs an Authorization: Bearer {editToken} header.',
    )
  }

  // Checked before the lookup so a malformed ID can never reach a document
  // path. 404 rather than 400: an ID that cannot be a Firestore auto-ID cannot
  // name a wheel that exists, and saying so in different words would tell a
  // prober which of their guesses were well-formed.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const secret = await db.collection(WHEEL_SECRETS).doc(shareId).get()
  if (!secret.exists) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  // Fail closed if the stored hash is absent or the wrong type. A wheel whose
  // secret document is malformed is not editable by anyone, which is the safe
  // direction — `editTokenMatches` would reject it too, but only by accident of
  // the length check rather than by intent.
  const storedHash: unknown = secret.get('editTokenHash')
  if (typeof storedHash !== 'string') {
    throw new EditorAuthError(
      403,
      'not_editor',
      'That edit token is not valid for this wheel.',
    )
  }

  if (!editTokenMatches(presented, storedHash)) {
    throw new EditorAuthError(
      403,
      'not_editor',
      'That edit token is not valid for this wheel.',
    )
  }
}

/** What `createWheel` hands back. The only time a raw token leaves this module. */
export type CreatedWheel = {
  shareId: string
  /**
   * The raw edit token, in plaintext. Return it to the creator once, in the
   * response body, and let it live in the URL fragment from there. It is not
   * recoverable: only its hash is stored.
   */
  editToken: string
}

/**
 * Create a wheel and its secret.
 *
 * `title` and `options` are written as given — validation and the option caps
 * are TASK-8's, applied by the route before it calls this.
 *
 * The two documents are written in one batch because the alternative failure is
 * unrecoverable: a wheel that committed without its secret has no valid edit
 * token and no way to ever acquire one, so it would be a live, publicly
 * readable wheel that nobody can edit or delete.
 */
export async function createWheel(
  input: { title: string; options?: { id: string; label: string }[] },
  db: Firestore = getAdminDb(),
): Promise<CreatedWheel> {
  // The auto-ID is minted client-side by the SDK rather than fetched, so this
  // costs no round trip. Roughly 120 bits, which is what makes the share URL an
  // unguessable capability — see design doc section 5 on why `allow list: if
  // false` is what keeps it that way.
  const wheelRef = db.collection(WHEELS).doc()
  const shareId = wheelRef.id

  // Minted independently of shareId. See mintEditToken.
  const editToken = mintEditToken()

  const now = FieldValue.serverTimestamp()
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000)

  const batch = db.batch()
  batch.set(wheelRef, {
    title: input.title,
    options: (input.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      // A real Date, not FieldValue.serverTimestamp(). Firestore only accepts
      // the sentinel at the top level of a document or inside a map — putting
      // one in an array element is rejected at write time. This is server
      // wall-clock rather than Firestore's, which is fine for a field nothing
      // orders or compares across wheels.
      addedAt: new Date(),
      fromSuggestion: null,
    })),
    suggestionsOpen: true,
    createdAt: now,
    updatedAt: now,
    // Set here because design doc section 8 is explicit that TTL is trivial at
    // creation and impossible to retrofit onto data users were promised we
    // would keep. Sliding it forward on activity is TASK-14; this is only the
    // initial value, so a wheel created before that lands still expires rather
    // than living forever.
    expiresAt,
  })
  batch.set(db.collection(WHEEL_SECRETS).doc(shareId), {
    editTokenHash: hashEditToken(editToken),
    createdAt: now,
    // The same expiry as the wheel, so the TTL policy reaps the pair together.
    // Without it the secret outlives the wheel forever: `assertEditor` would
    // keep succeeding for a wheel that no longer exists, and a `set(...,
    // {merge: true})` in a later route would resurrect it with no expiresAt at
    // all — permanently un-reapable. It also leaves wheelSecrets growing
    // without bound, which is the opposite of what design doc section 8 is for.
    //
    // TASK-14 owns the TTL policy itself, and needs to configure it on this
    // collection as well as on wheels, plus slide both fields together.
    expiresAt,
  })
  await batch.commit()

  return { shareId, editToken }
}
