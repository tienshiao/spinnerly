import 'server-only'

import { randomUUID } from 'node:crypto'

import { FieldValue, type Firestore } from 'firebase-admin/firestore'

import { getAdminDb } from '@/lib/firebase/admin'
import { assertOptionCapacity, ValidationError } from './validation'
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

/**
 * The bookkeeping every successful write applies, computed once so the two
 * documents cannot drift apart.
 *
 * Returned as a pair of payloads rather than applied to a writer, because the
 * callers are a `WriteBatch` in one case and a `Transaction` in another and the
 * two only look alike. What matters is that no caller gets to compute the
 * secret's expiry independently of the wheel's — see `SECRET_EXPIRY_MARGIN_DAYS`
 * for what goes wrong when those two numbers are decided in different places.
 */
function slidingExpiry(): {
  wheel: { updatedAt: FieldValue; expiresAt: Date }
  secret: { expiresAt: Date }
} {
  const expiresAt = nextExpiry()
  return {
    wheel: { updatedAt: FieldValue.serverTimestamp(), expiresAt },
    secret: { expiresAt: nextSecretExpiry(expiresAt) },
  }
}

/** An option as it is stored inside `wheels/{shareId}.options`. */
export type StoredOption = {
  id: string
  label: string
  addedAt: Date
  /** The suggestion this came from, or null when an editor typed it. */
  fromSuggestion: string | null
}

/**
 * Build the stored form of an option.
 *
 * Every path that writes into `options` goes through here — creation, the add
 * endpoint, and eventually accepting a suggestion — because `arrayRemove`
 * matches elements by deep equality. An element written with the fields in a
 * different set is an element the remove endpoint cannot address, and the
 * failure would be a silent no-op delete rather than an error.
 *
 * `addedAt` is a real `Date`, not `FieldValue.serverTimestamp()`. Firestore only
 * accepts the sentinel at the top level of a document or inside a map — putting
 * one in an array element is rejected at write time. This is the server's
 * wall-clock rather than Firestore's, which is fine for a field nothing orders
 * or compares across wheels.
 *
 * `id` is generated here by default and is not accepted from the client, even
 * though design doc section 4 calls it "client-stable". Stable is a property of
 * the value, not a statement about who mints it: the client keys its animations
 * on whatever id comes back. Taking one from the request would let a client
 * write two options with the same id, and `DELETE .../options/{id}` would then
 * remove both — a data-loss bug handed to us by an input we never needed.
 */
function optionElement(input: {
  label: string
  id?: string
  fromSuggestion?: string | null
}): StoredOption {
  return {
    id: input.id ?? randomUUID(),
    label: input.label,
    addedAt: new Date(),
    fromSuggestion: input.fromSuggestion ?? null,
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
  // `id` is optional so a caller that has no meaningful one — anything but
  // `POST /wheels/{shareId}/duplicate` copying a source wheel — gets a fresh
  // one minted by `optionElement` rather than having to invent it. Requiring it
  // was the shape that would have let an unauthenticated create supply two
  // options with the same id; see `optionElement` for why that matters.
  input: { title: string; options?: { id?: string; label: string }[] },
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
    options: (input.options ?? []).map((option) => optionElement(option)),
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

  const slide = slidingExpiry()

  const batch = db.batch()
  batch.update(db.collection(WHEELS).doc(shareId), { ...patch, ...slide.wheel })
  batch.update(db.collection(WHEEL_SECRETS).doc(shareId), slide.secret)

  await commit(() => batch.commit(), 'updateWheel', shareId)
}

/**
 * Record that the wheel/secret pair has come apart, and return the 404 to
 * answer with.
 *
 * The two documents are written together and reaped together (see
 * `SECRET_EXPIRY_MARGIN_DAYS`), so one of them existing without the other is our
 * data being inconsistent rather than a client mistake. Every caller here has
 * already passed `assertEditor`, which means the secret existed a moment ago —
 * whichever half turns out to be missing, something happened that should not
 * have.
 *
 * Without the log line it would reach the client as a routine-looking 404 and
 * reach the logs not at all. The 404s a route can also produce, from `isShareId`
 * and from `assertEditor`, are ordinary client errors and stay unlogged on
 * purpose; this one is worth waking up to.
 *
 * `missing` says which half is known to be gone, because that is not always
 * knowable — see `commit`.
 */
function pairSplit(
  operation: string,
  missing: string,
  error?: unknown,
): EditorAuthError {
  console.error(
    `${operation}: ${missing}. The wheel and its secret are written together, ` +
      'so one was deleted without the other.',
    error,
  )

  return new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
}

/**
 * Commit a write of the wheel/secret pair, translating a missing document.
 *
 * Firestore reports a missing document on `update` as gRPC status 5, and does
 * not say which of the batch's documents it was. The wheel is the likelier guess
 * only for `updateWheel`, which does not read it first; the option writes check
 * the wheel themselves before getting here, so for those the secret is what must
 * have gone. Since one message covers all three, it names neither.
 */
async function commit(
  write: () => Promise<unknown>,
  operation: string,
  shareId: string,
): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (!isNotFound(error)) throw error

    throw pairSplit(
      operation,
      `one of wheels/${shareId} and ${WHEEL_SECRETS}/${shareId} is missing`,
      error,
    )
  }
}

/**
 * How long an option's id may be. Generous — it is not a security boundary.
 *
 * Unlike `shareId`, an optionId never reaches a document path: it is compared
 * against ids inside a document this module has already fetched by other means,
 * so there is no traversal to prevent here. Nor does it save a read — the caller
 * has already been through `assertEditor`. It bounds the string before it is
 * scanned against every option on the wheel, and refuses obvious nonsense
 * somewhere it can be named, which is all it claims to do.
 *
 * It sits well above the 36 characters `randomUUID` produces so that ids written
 * by another path — a duplicated wheel copying an older wheel's — stay
 * removable.
 */
const OPTION_ID_MAX = 128

function assertOptionId(optionId: string): void {
  // The `typeof` is not redundant with the parameter type: this value comes out
  // of a route's path params, which are typed but not checked.
  if (
    typeof optionId !== 'string' ||
    optionId.length === 0 ||
    optionId.length > OPTION_ID_MAX
  ) {
    throw new ValidationError(
      400,
      'invalid_option_id',
      'That is not an option ID.',
    )
  }
}

/**
 * The options array of a fetched wheel, or `[]` for a document without one.
 *
 * `unknown[]` rather than `StoredOption[]`, and not out of caution: an element
 * read back from Firestore does not have the type `optionElement` wrote. Its
 * `addedAt` is a `Timestamp`, not a `Date`. Callers here only count these and
 * match on `id`, and the whole element goes back to `arrayRemove` opaquely, so
 * naming a type it does not have would buy nothing and mislead the next reader.
 */
function storedOptions(data: unknown): unknown[] {
  const options = (data as { options?: unknown } | undefined)?.options
  return Array.isArray(options) ? (options as unknown[]) : []
}

/** The id of a stored option element, if it has one. */
function optionIdOf(option: unknown): unknown {
  return (option as { id?: unknown } | null | undefined)?.id
}

/**
 * Append one option to a wheel and slide its expiry forward.
 *
 * Every caller must have passed `assertEditor` first — as with `updateWheel`,
 * this function is handed a shareId and trusts it.
 *
 * Two properties this has to hold, both from design doc section 6:
 *
 *  - **The options array is never written as a whole.** `arrayUnion` appends the
 *    one new element server-side, so a second editor adding at the same moment
 *    cannot have their option erased by our write. Firestore preserves array
 *    order, which makes insertion order the display order for free — no sort
 *    field, and no reorder operation to conflict over (decision 6).
 *  - **The cap is checked against the count in the same transaction as the
 *    write.** A read outside one lets two editors both see 49 and both add, and
 *    `assertOptionCapacity` says as much at its own definition. The transaction
 *    is what turns that into one add and one retry.
 *
 * The transaction is the only reason contention exists on this path at all. It
 * costs nothing in correctness — two concurrent adds both land, because the
 * retried attempt re-reads and re-appends rather than replaying a stale array —
 * but it does cost latency: a loser backs off for around a second before trying
 * again, and the Admin SDK gives it five attempts before the failure surfaces as
 * a 500. That budget is deliberately left at its default rather than raised. A
 * request retrying for a minute is worse than one that fails in seven seconds,
 * and it would be killed by the platform's function timeout anyway. The
 * concurrency this has to survive is a few humans clicking at once, not a fleet.
 */
export async function addOption(
  shareId: string,
  input: { label: string; fromSuggestion?: string | null },
  db: Firestore = getAdminDb(),
): Promise<StoredOption> {
  // Defensive rather than redundant, exactly as in `updateWheel` — see SHARE_ID.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const secretRef = db.collection(WHEEL_SECRETS).doc(shareId)
  const option = optionElement(input)

  await commit(
    () =>
      db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(wheelRef)
        if (!snapshot.exists) {
          // Checked inside the transaction rather than before it, so the
          // existence check and the write are the same atomic step. The throw
          // escapes `runTransaction` unchanged and is not a retryable error, so
          // this aborts rather than looping.
          //
          // Reported through `pairSplit` because the caller has already passed
          // `assertEditor`: the secret was there a moment ago, so a missing
          // wheel is the halves having come apart, not an unknown wheel. Left
          // as a bare 404 it would be the one inconsistency that never reaches
          // the logs.
          throw pairSplit(
            'addOption',
            `wheels/${shareId} is missing but its secret is not`,
          )
        }

        const options = storedOptions(snapshot.data())

        // Skipped when this option is already there, which happens on exactly
        // one path: a transaction retry after a commit that actually landed.
        // `isRetryableTransactionError` retries UNAVAILABLE, UNKNOWN and
        // DEADLINE_EXCEEDED, and every one of those can arrive after the backend
        // committed. The append itself is already idempotent — the element is
        // built once, outside the transaction, so `arrayUnion` re-adds a value
        // the array holds — but the capacity check is not: at the boundary the
        // re-read counts our own option and answers 409 `options_full` for an
        // add that succeeded. This is what makes the whole operation idempotent
        // rather than only its write.
        if (!options.some((stored) => optionIdOf(stored) === option.id)) {
          assertOptionCapacity(options.length)
        }

        const slide = slidingExpiry()
        transaction.update(wheelRef, {
          options: FieldValue.arrayUnion(option),
          ...slide.wheel,
        })
        transaction.update(secretRef, slide.secret)
      }),
    'addOption',
    shareId,
  )

  return option
}

/**
 * Remove one option from a wheel by id and slide its expiry forward.
 *
 * Idempotent: removing an option that is already gone is a success, which is
 * what makes a client safe to retry a DELETE whose response it never saw.
 * Returns whether an element was actually matched, for callers that care.
 *
 * `arrayRemove` matches by deep equality on the whole element, not by id, so the
 * exact stored element has to be read first and handed back. That read is
 * deliberately NOT in a transaction, and the reason is decision 10: option
 * labels are immutable, so a stored element never changes after it is written.
 * The value read here is therefore still the value stored at commit time or it
 * is not there at all, and in the second case `arrayRemove` removes nothing —
 * which is the same answer a transaction would have produced, without taking a
 * lock that concurrent adds would then contend on.
 *
 * The expiry slides even when nothing matched. A retry of a delete that already
 * happened is ordinary editor activity, and making the wheel's lifetime depend
 * on whether a client's first attempt got its response back would be a strange
 * thing to have built.
 */
export async function removeOption(
  shareId: string,
  optionId: string,
  db: Firestore = getAdminDb(),
): Promise<boolean> {
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }
  assertOptionId(optionId)

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const snapshot = await wheelRef.get()
  if (!snapshot.exists) {
    // As in `addOption`: the caller has passed `assertEditor`, so the secret
    // was there a moment ago and a missing wheel is the pair having come apart.
    throw pairSplit(
      'removeOption',
      `wheels/${shareId} is missing but its secret is not`,
    )
  }

  const doomed = storedOptions(snapshot.data()).find(
    (option) => optionIdOf(option) === optionId,
  )

  const slide = slidingExpiry()
  const batch = db.batch()
  batch.update(wheelRef, {
    ...(doomed === undefined
      ? {}
      : { options: FieldValue.arrayRemove(doomed) }),
    ...slide.wheel,
  })
  batch.update(db.collection(WHEEL_SECRETS).doc(shareId), slide.secret)

  await commit(() => batch.commit(), 'removeOption', shareId)

  return doomed !== undefined
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
