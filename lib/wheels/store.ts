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
 * Extra days a wheel's secret outlives the wheel itself.
 *
 * The two documents are written together and expire together, but they are
 * reaped by two independent per-collection TTL jobs. Firestore promises only
 * that a deletion happens "typically within 24 hours after expiration" and
 * gives no ordering guarantee whatsoever between collections, so with identical
 * timestamps either can go first.
 *
 * One of those orders is harmless and the other is the failure this whole pairing
 * exists to prevent:
 *
 *  - Wheel reaped first, secret lingering: inert. `assertEditor` succeeds and
 *    every write then 404s on a document that is not there.
 *  - **Secret reaped first, wheel lingering: a live wheel nobody can edit.** It
 *    is still readable, still spinnable, and still accepting suggestions —
 *    `POST /suggestions` is unauthenticated — while its owner has silently and
 *    permanently lost the kill switch. There is no recovery: the token cannot be
 *    reissued.
 *
 * A margin on the secret makes the second order impossible rather than unlikely.
 * It is a hedge against an unbounded quantity, not a guarantee — Firestore
 * documents no maximum lag — so it is set generously above the stated typical.
 * The cost is two extra days of storing a hash, which is nothing: the secret
 * holds no user content, so this does not weaken the data-minimisation argument
 * in design doc section 8.
 */
const SECRET_EXPIRY_MARGIN_DAYS = 2

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

const DAY_MS = 24 * 60 * 60 * 1000

/** When a wheel touched now should expire. Design doc section 8. */
function nextExpiry(): Date {
  return new Date(Date.now() + EXPIRY_DAYS * DAY_MS)
}

/**
 * When that wheel's secret should expire — always after the wheel. See
 * `SECRET_EXPIRY_MARGIN_DAYS` for why the two are not the same instant.
 */
function nextSecretExpiry(wheelExpiry: Date): Date {
  return new Date(wheelExpiry.getTime() + SECRET_EXPIRY_MARGIN_DAYS * DAY_MS)
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
  const expiresAt = nextExpiry()

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
    // would keep. `updateWheel` slides this forward on every edit; this is the
    // initial value.
    expiresAt,
  })
  batch.set(db.collection(WHEEL_SECRETS).doc(shareId), {
    editTokenHash: hashEditToken(editToken),
    createdAt: now,
    // Bounded, rather than left to live forever, for two reasons: an immortal
    // secret means `assertEditor` keeps succeeding for a wheel that no longer
    // exists, and it leaves wheelSecrets growing without bound, which is the
    // opposite of what design doc section 8 is for.
    //
    // Deliberately later than the wheel's own expiry rather than equal to it —
    // see SECRET_EXPIRY_MARGIN_DAYS, where the order the two are reaped in turns
    // out to matter a great deal in one direction and not at all in the other.
    //
    // TASK-14 still owns the TTL policy itself, and has to configure it on this
    // collection as well as on wheels. The sliding half is done: `updateWheel`
    // moves both fields together, and every route that writes should go through
    // it rather than growing a second mechanism.
    expiresAt: nextSecretExpiry(expiresAt),
  })
  await batch.commit()

  return { shareId, editToken }
}

/**
 * The fields a wheel patch may set. Deliberately not `options`.
 *
 * Options are mutated only through the granular add and remove endpoints. A
 * whole-array write is the lost-update bug those endpoints exist to avoid, and
 * the edit URL being transferable makes concurrent editors a supported case
 * rather than an edge one (design doc section 6). The type is the first line of
 * that defence; the route refuses an `options` key explicitly as the second.
 */
export type WheelPatch = {
  title?: string
  suggestionsOpen?: boolean
}

/**
 * Apply a partial update to a wheel and slide its expiry forward.
 *
 * Every caller must have passed `assertEditor` first. This function does not
 * check authorization and has no way to — it is handed a shareId and trusts it.
 *
 * Two things happen here beyond writing the caller's fields, and both are design
 * doc section 8 rather than incidental bookkeeping:
 *
 *  - `updatedAt` moves, because that is what the field is for.
 *  - `expiresAt` moves on BOTH documents, in one batch. Sliding only the wheel
 *    is the tempting half-measure and it is a slow-acting bug: the secret keeps
 *    its original 30-day expiry, gets reaped while an actively used wheel lives
 *    on, and `assertEditor` then fails for a wheel nobody can edit again. The
 *    secret keeps its margin over the wheel — see `SECRET_EXPIRY_MARGIN_DAYS`,
 *    which is what stops the same failure arriving by a different route when
 *    the wheel really does expire.
 *
 * `update` rather than `set(..., {merge: true})` so a wheel that no longer
 * exists is an error rather than being silently recreated without a title, a
 * `createdAt`, or any of the fields the data model says it has.
 */
export async function updateWheel(
  shareId: string,
  patch: WheelPatch,
  db: Firestore = getAdminDb(),
): Promise<void> {
  // Defensive rather than redundant. `assertEditor` validates the shape too, but
  // this function is separately reachable and a slash in `shareId` would make
  // `doc()` resolve a path of the caller's choosing — see SHARE_ID above.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const expiresAt = nextExpiry()

  const batch = db.batch()
  batch.update(db.collection(WHEELS).doc(shareId), {
    ...patch,
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
  })
  batch.update(db.collection(WHEEL_SECRETS).doc(shareId), {
    expiresAt: nextSecretExpiry(expiresAt),
  })

  try {
    await batch.commit()
  } catch (error) {
    if (!isNotFound(error)) throw error

    // Firestore reports a missing document on `update` as gRPC status 5.
    //
    // Getting here means one of the pair is gone while the other is not: the
    // caller already passed `assertEditor`, so the secret existed a moment ago.
    // That is not a client mistake — it is our data being inconsistent — and
    // without this line it would reach the client as a routine-looking 404 and
    // reach the logs not at all. The two 404s the route can also produce, from
    // `isShareId` and from `assertEditor`, are ordinary client errors and stay
    // unlogged on purpose; this one is worth waking up to.
    console.error(
      `updateWheel: wheels/${shareId} is missing but its secret is not. ` +
        'One of the pair was deleted without the other.',
      error,
    )

    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }
}

/** Whether a Firestore error is NOT_FOUND (gRPC status 5). */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 5
  )
}
