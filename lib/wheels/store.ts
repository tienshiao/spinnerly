import 'server-only'

import { randomUUID } from 'node:crypto'

import { FieldValue, type Firestore } from 'firebase-admin/firestore'

import { getAdminDb } from '@/lib/firebase/admin'
import {
  isShareId,
  isSuggestionId,
  SUGGESTIONS,
  WHEELS,
  type CreatedSuggestion,
  type CreatedWheel,
  type SuggestionStatus,
  type WheelOption,
  type WheelPatch,
  type WheelVersion,
} from './model'
import {
  assertOptionCapacity,
  assertPendingSuggestionCapacity,
  DEFAULT_TITLE,
  ValidationError,
} from './validation'
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

/**
 * Kept here rather than in ./model.ts, unlike `WHEELS` and `SUGGESTIONS`.
 *
 * The browser has no business naming this collection: rules make it
 * `read, write: if false` and nothing on the client can reach it. Leaving the
 * name out of the module the client imports means a client-side read of it
 * cannot be written by autocomplete — it would have to be typed as a string
 * literal, which is the point at which `spinnerly/no-wheel-secret-queries` and
 * a reviewer both get a look at it.
 */
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
 * The ID guards and the shared shapes live in ./model.ts, which is free of
 * `server-only` so the browser half of design doc section 3 can import them
 * too. Re-exported here so this module stays the one place the server imports
 * wheel vocabulary from, and so there is still exactly one definition of each.
 */
export {
  isShareId,
  isSuggestionId,
  SUGGESTIONS,
  WHEELS,
  type CreatedSuggestion,
  type CreatedWheel,
  type Suggestion,
  type SuggestionStatus,
  type Wheel,
  type WheelOption,
  type WheelPatch,
  type WheelVersion,
} from './model'

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

  /**
   * The response body shape every write route returns for an auth failure.
   *
   * `no-store` for the same reason `writeHeaders` carries it, and one status
   * makes it more than housekeeping: the 404 for "no such wheel" is on RFC
   * 9111 section 4.2.2's heuristically-cacheable list, so a shared cache may
   * store it with no explicit freshness at all — and every one of these
   * responses is an authorization decision keyed on a token the URL does not
   * mention.
   */
  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message },
      { status: this.status, headers: { 'cache-control': 'no-store' } },
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
  wheel: { updatedAt: Date; expiresAt: Date }
  secret: { expiresAt: Date }
} {
  const expiresAt = nextExpiry()
  return {
    wheel: { updatedAt: writeVersion(), expiresAt },
    secret: { expiresAt: nextSecretExpiry(expiresAt) },
  }
}

/**
 * The value written to `updatedAt`, and the version every mutating write hands
 * back to its caller.
 *
 * **A real `Date` rather than `FieldValue.serverTimestamp()`, and that is the
 * point of it.** A sentinel is opaque to the code that writes it: the server
 * resolves it during the commit, so the route has nothing to return and a
 * client has no way to ask "is the document I am looking at at or past the
 * version my write produced?". Without an answer to that question the client
 * can only count snapshot deliveries, which cannot tell a delivery generated
 * after our commit from one still in flight from before it — see the retirement
 * rules in ./optimistic.ts, which is the whole reason this field exists in this
 * form.
 *
 * The cost is that `updatedAt` is now the route's wall clock rather than
 * Firestore's, so two writes from two function instances can be ordered by
 * clocks that differ by a few milliseconds. That is acceptable here and is not
 * a new precedent: `expiresAt` — the field the TTL policy reaps on, and by some
 * distance the most consequential timestamp in this system — has been computed
 * this way since TASK-7, as has `addedAt` on every option.
 *
 * `createdAt` deliberately stays a server timestamp on both documents that have
 * one. Nothing compares it to a value we returned, so it has no reason to give
 * up Firestore's clock.
 */
function writeVersion(): Date {
  return new Date()
}

/**
 * Read a stored `updatedAt` back as a version, for the one path that reports a
 * version it did not write.
 *
 * Defensive because the alternative is worse than useless: a value that is not
 * a usable date must become null — meaning "no version to report" — rather than
 * something coerced. `new Date(undefined)` is an Invalid Date, whose
 * `toISOString()` throws, and any fallback clock reading would be ahead of the
 * document, which is precisely the state this must never describe.
 */
function storedVersion(value: unknown): Date | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { toDate?: unknown }).toDate !== 'function'
  ) {
    return null
  }

  const date: unknown = (value as { toDate: () => unknown }).toDate()
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
}

/**
 * What this module WRITES: a `WheelOption` with `addedAt` narrowed back to
 * non-null.
 *
 * The shared type allows null because a *reader* may not find a usable
 * timestamp in a stored document — ./snapshot.ts decodes defensively rather
 * than throwing inside an `onSnapshot` callback. Nothing that writes an option
 * can produce that case, and `POST /options` puts `addedAt` in its response
 * body, so the narrowing is what keeps that `.toISOString()` honest instead of
 * optional-chained against a case this side cannot reach.
 */
export type StoredOption = WheelOption & { addedAt: Date }

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

// `CreatedWheel` — what `createWheel` hands back, and the only time a raw token
// leaves this module — is defined in ./model.ts and re-exported above, because
// the API client parses the same shape back off the wire.

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

  const createdAt = FieldValue.serverTimestamp()
  const expiresAt = nextExpiry()

  const batch = db.batch()
  batch.set(wheelRef, {
    title: input.title,
    options: (input.options ?? []).map((option) => optionElement(option)),
    suggestionsOpen: true,
    createdAt,
    // Not `createdAt`, even though the two describe the same instant here.
    // `updatedAt` is the version a client compares its own write against, so it
    // has to be a value this process knows — see `writeVersion`. Sharing the
    // server-timestamp sentinel would make a wheel's first version the one
    // value in the document's life that nothing could be compared with.
    updatedAt: writeVersion(),
    // Set here because design doc section 8 is explicit that TTL is trivial at
    // creation and impossible to retrofit onto data users were promised we
    // would keep. `updateWheel` slides this forward on every edit; this is the
    // initial value.
    expiresAt,
  })
  batch.set(db.collection(WHEEL_SECRETS).doc(shareId), {
    editTokenHash: hashEditToken(editToken),
    createdAt,
    // Bounded, rather than left to live forever, for two reasons: an immortal
    // secret means `assertEditor` keeps succeeding for a wheel that no longer
    // exists, and it leaves wheelSecrets growing without bound, which is the
    // opposite of what design doc section 8 is for.
    //
    // Deliberately later than the wheel's own expiry rather than equal to it —
    // see SECRET_EXPIRY_MARGIN_DAYS, where the order the two are reaped in turns
    // out to matter a great deal in one direction and not at all in the other.
    //
    // The policy that acts on this field is applied by
    // scripts/configure-ttl.mjs, which covers this collection as well as wheels
    // and suggestions. Sliding is `updateWheel` and the writes that share its
    // helper, which move both fields together — a route that needs to slide
    // should go through `slidingExpiry` rather than growing a second mechanism.
    expiresAt: nextSecretExpiry(expiresAt),
  })
  await batch.commit()

  return { shareId, editToken }
}

/**
 * The options of a source wheel, in the shape `createWheel` seeds a new one with.
 *
 * Narrowing rather than validating. Every element here was written by
 * `optionElement`, so the checks exist to satisfy the type system and to make the
 * function total over data that has somehow come out wrong — not to police input,
 * which nothing about a fork is.
 *
 * An element with no usable label — absent, not a string, or empty — is dropped
 * rather than made to fail the whole
 * fork. This endpoint is the escape hatch (design doc section 8), so refusing to
 * copy 49 good options because a 50th is malformed would break it precisely when
 * it is most needed.
 *
 * The id is carried across when it can be, which is what `createWheel`'s optional
 * `id` exists for — but only within `OPTION_ID_MAX`, because `assertOptionId`
 * refuses anything longer and a fork holding an option too long to name would be
 * a wheel with an option nobody can ever delete.
 */
function copyableOptions(stored: unknown[]): { id?: string; label: string }[] {
  const copied: { id?: string; label: string }[] = []

  for (const option of stored) {
    const { id, label } = (option ?? {}) as { id?: unknown; label?: unknown }

    // The empty string is dropped as well as the non-string, because it is a
    // slice with nothing written on it: `validateOptionLabel` refuses one, and
    // this function is the only thing standing between a stored label and the
    // fork, since a copied label is deliberately not re-validated.
    //
    // Length is deliberately NOT checked, and the asymmetry against
    // `OPTIONS_MAX` below is the same one this codebase draws elsewhere.
    // OPTIONS_MAX is a storage boundary — past it the document breaches
    // Firestore's 1MB limit and the write fails outright — so a lowered cap has
    // to be enforced on the way past. OPTION_LABEL_MAX is a product cap with no
    // storage consequence, so a fork carrying a label a point over a later,
    // lower limit is cosmetically stale rather than broken, and truncating
    // someone's option to fit is the worse answer.
    if (typeof label !== 'string' || label.length === 0) continue

    const usableId =
      typeof id === 'string' && id.length > 0 && id.length <= OPTION_ID_MAX

    copied.push(usableId ? { id: id as string, label } : { label })
  }

  return copied
}

/**
 * Fork a wheel into a new one. Design doc section 8.
 *
 * **Unauthenticated, deliberately.** Anyone holding the share URL may fork —
 * it is the escape hatch when a wheel expires, when the edit token is lost, or
 * when someone wants the list for their own group. Nothing is disclosed that the
 * share URL did not already expose: the caller could read every field copied here
 * straight from Firestore (design doc section 5).
 *
 * **The source wheel is not written to at all.** Not even the expiry slide every
 * other write in this module applies, and that is a decision rather than an
 * omission. Forking is a read of the source, and reading is not activity — but
 * more to the point, this is the one path that reaches a wheel with no credential
 * and no cap. Sliding here would let anyone who once saw a share URL keep that
 * wheel alive forever by calling this on a timer, quietly defeating the bounded
 * lifetime of a leaked link that design doc section 8 lists as expiry's first
 * reason for existing.
 *
 * A consequence worth knowing: a wheel past its `expiresAt` but not yet reaped
 * forks fine. Firestore TTL deletes "typically within 24 hours", so there is a
 * window where the escape hatch still works on an expired wheel, which is exactly
 * when someone reaches for it.
 *
 * What the fork gets is a wheel created from scratch and seeded, not a copy of a
 * document — `createWheel` mints the shareId, the edit token, `createdAt`,
 * `updatedAt` and `expiresAt`, and writes `suggestionsOpen: true` regardless of
 * what the source had. Suggestions and spins are subcollections and are simply
 * not read, so they do not come along.
 */
export async function duplicateWheel(
  shareId: string,
  db: Firestore = getAdminDb(),
): Promise<CreatedWheel> {
  // As everywhere else — see SHARE_ID. There is no `assertEditor` on this path
  // to have checked it first, so this is the only guard between a URL segment
  // and a document path.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const source = await db.collection(WHEELS).doc(shareId).get()
  if (!source.exists) {
    // Not `pairSplit`: unlike the editor routes, nothing has established that
    // this wheel existed a moment ago, so a missing document is an unknown
    // wheel rather than our data having come apart.
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const title: unknown = source.get('title')
  const options = copyableOptions(storedOptions(source.data()))

  // A source cannot be over the cap today, since every path that writes an
  // option checks it — but a future release lowering `OPTIONS_MAX` would
  // otherwise fork an older wheel straight past the new limit, and the failure
  // would be Firestore refusing an oversized document as a 500 rather than the
  // 409 this gives.
  //
  // The count goes in `current` and `adding` is zero, which is the same
  // predicate as the bulk form `(0, options.length)` — `n + 0` and `0 + n` clear
  // `OPTIONS_MAX` identically, boundary included. What differs is the message,
  // which interpolates `current` alone: passing the count as `adding` reports "a
  // wheel holds at most 40 options, and this one has 0" for a source holding 45.
  // Both numbers wrong, on the one message a forker ever sees.
  assertOptionCapacity(options.length, 0)

  return createWheel(
    {
      // Verbatim, per decision 17. Not re-run through `validateTitle`: the
      // source title was sanitised when it was written, and re-sanitising would
      // let a change to those rules silently rewrite a title the forker never
      // typed and cannot see us edit. `DEFAULT_TITLE` only for a source whose
      // title is not a string at all, which this API cannot produce — a fork
      // that reads as untitled beats one that fails.
      title: typeof title === 'string' ? title : DEFAULT_TITLE,
      // `fromSuggestion` is deliberately not among the fields copied, so
      // `optionElement` sets it to null. It names a document in the SOURCE
      // wheel's suggestions subcollection, which the fork does not have and
      // never will — carrying it across would point the fork's provenance at
      // another wheel's queue, which is worse than no provenance at all.
      options,
    },
    db,
  )
}

// `WheelPatch` — the fields a patch may set, deliberately not `options` — is
// defined in ./model.ts and re-exported above.

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
): Promise<WheelVersion> {
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

  return { updatedAt: slide.wheel.updatedAt }
}

/** The 404 both functions below answer with. */
function noSuchWheel(): EditorAuthError {
  return new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
}

/**
 * Record a wheel that is gone while its secret is still there, and return the
 * 404 to answer with.
 *
 * **This is the expected end of a wheel's life, not a fault**, which is why it
 * is a warning rather than an error. `SECRET_EXPIRY_MARGIN_DAYS` deliberately
 * makes the secret outlive the wheel, so once the TTL policies are applied
 * (design doc section 8) there is a window of roughly that length after every
 * reaping in which exactly this happens: `assertEditor` succeeds because the
 * secret is still there, and the write then finds no wheel.
 *
 * Logged at all because the same shape is also what a hand-deleted or otherwise
 * lost wheel looks like, and a silent 404 would be the one inconsistency that
 * never reaches the logs. Logged at `warn` because an error-severity alarm
 * firing on the ordinary path is worse than no alarm — it teaches whoever reads
 * production logs to skip the line, and then the real case goes unread too.
 */
function reapedWheel(operation: string, shareId: string): EditorAuthError {
  console.warn(
    `${operation}: wheels/${shareId} is missing but ${WHEEL_SECRETS}/${shareId} ` +
      'is not. Expected within the secret’s expiry margin after a TTL reaping; ' +
      'outside that window it means the wheel was lost some other way.',
  )

  return noSuchWheel()
}

/**
 * Record that the wheel/secret pair has come apart in a way nothing explains,
 * and return the 404 to answer with.
 *
 * Unlike `reapedWheel`, this is reached when it is not knowable which half went
 * — see `commit` — so it cannot be attributed to the reaping window and stays an
 * error. The 404s a route can also produce, from `isShareId` and from
 * `assertEditor`, are ordinary client errors and stay unlogged on purpose; this
 * one is worth waking up to.
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

  return noSuchWheel()
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
): Promise<WheelVersion & { option: StoredOption }> {
  // Defensive rather than redundant, exactly as in `updateWheel` — see SHARE_ID.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const secretRef = db.collection(WHEEL_SECRETS).doc(shareId)
  const option = optionElement(input)
  let version: Date | null = null

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
          throw reapedWheel('addOption', shareId)
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
        // Assigned inside the callback rather than computed outside it because
        // a transaction body can RUN MORE THAN ONCE under contention, and only
        // the last attempt is the one that commits. A version computed outside
        // would be the one no attempt wrote.
        version = slide.wheel.updatedAt
        transaction.update(wheelRef, {
          options: FieldValue.arrayUnion(option),
          ...slide.wheel,
        })
        transaction.update(secretRef, slide.secret)
      }),
    'addOption',
    shareId,
  )

  return { option, updatedAt: version }
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
): Promise<WheelVersion & { removed: boolean }> {
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }
  assertOptionId(optionId)

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const snapshot = await wheelRef.get()
  if (!snapshot.exists) {
    // As in `addOption`: the caller has passed `assertEditor`, so the secret
    // was there a moment ago and a missing wheel is the pair having come apart.
    throw reapedWheel('removeOption', shareId)
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

  return { removed: doomed !== undefined, updatedAt: slide.wheel.updatedAt }
}

// `CreatedSuggestion` — what `submitSuggestion` returns — is defined in
// ./model.ts and re-exported above, for the same reason as `CreatedWheel`.

function assertSuggestionId(suggestionId: string): void {
  // 404 rather than 400, for the reason `assertEditor` gives about `shareId`:
  // an ID that cannot be a Firestore auto-ID cannot name a suggestion that
  // exists, and answering differently would tell someone probing the queue
  // which of their guesses were at least well formed.
  if (!isSuggestionId(suggestionId)) {
    throw new ValidationError(
      404,
      'no_such_suggestion',
      'No suggestion with that ID.',
    )
  }
}

/**
 * Add a pending suggestion to a wheel and slide its expiry forward.
 *
 * **This is the only unauthenticated write in the application.** Anyone holding
 * the share URL may call it (design doc section 2), which makes it a billing
 * surface as much as a correctness one — and with rate limiting deferred out of
 * v1 for want of a Redis (design doc section 7), the pending cap enforced here
 * is the only thing bounding what a single scraped share URL can cost.
 *
 * **Not a transaction, unlike `addOption`, and the asymmetry is deliberate.**
 * The two caps look alike and are not:
 *
 *  - `OPTIONS_MAX` bounds a single document against Firestore's 1MB limit, so
 *    exceeding it is a rejected write surfacing as a 500. It has to be exact,
 *    which is why `addOption` pays for a transaction and the contention that
 *    comes with it.
 *  - `PENDING_SUGGESTIONS_MAX` bounds a subcollection, where no document grows
 *    at all. It is an abuse ceiling, and a race that lands 201 suggestions
 *    instead of 200 has cost us one extra document.
 *
 * Paying for exactness here would mean serialising every submission to a wheel
 * through one lock — on the one endpoint an attacker can call without a
 * credential. That turns a burst of spam into a queue of retrying transactions,
 * each of which is billed, which is a worse answer to abuse than the cap it
 * would be enforcing.
 */
export async function submitSuggestion(
  shareId: string,
  input: { label: string },
  db: Firestore = getAdminDb(),
): Promise<WheelVersion & { suggestion: CreatedSuggestion }> {
  // `EditorAuthError` despite there being no editor here. The class is "an
  // error carrying the status and code a route should answer with"; its name
  // reflects where it lives rather than this call site, and using it keeps
  // `no_such_wheel` coming from one place across all five write paths.
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const snapshot = await wheelRef.get()
  if (!snapshot.exists) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }

  // `=== true` rather than a truthiness test, so a wheel whose document is
  // missing the field or holding the wrong type is treated as closed. Failing
  // closed is the safe direction on the unauthenticated path: the cost is that
  // participants cannot suggest to a malformed wheel, against accepting public
  // writes to a wheel whose kill switch we were unable to read.
  if (snapshot.get('suggestionsOpen') !== true) {
    throw new ValidationError(
      403,
      'suggestions_closed',
      'This wheel is not taking suggestions right now.',
    )
  }

  const suggestions = wheelRef.collection(SUGGESTIONS)

  // A count aggregation rather than fetching the documents: it bills a fraction
  // of a read regardless of how many rows it counts, where reading 200
  // suggestions to discover there are 200 of them would bill 200.
  const pending = await suggestions
    .where('status', '==', 'pending')
    .count()
    .get()
  assertPendingSuggestionCapacity(pending.data().count)

  const suggestionRef = suggestions.doc()
  const slide = slidingExpiry()

  const batch = db.batch()
  batch.set(suggestionRef, {
    label: input.label,
    status: 'pending' satisfies SuggestionStatus,
    // A real server timestamp, unlike an option's `addedAt`, because this one
    // is a top-level field rather than an array element and so may hold the
    // sentinel. It is also the field the queue is ordered by across clients,
    // which a submitter's own clock could not be trusted to supply.
    createdAt: FieldValue.serverTimestamp(),
    // There is deliberately no `clientHint`, though design doc section 4's data
    // model lists one. Rules cannot exclude a field, and section 5 makes this
    // subcollection `allow get, list: if true` — so a per-submitter fingerprint
    // stored here is readable by every participant holding the share URL, who
    // could group the queue by it and learn which suggestions came from the
    // same person. That is attribution in all but the name, and decision 12
    // resolves against attribution in v1.
    //
    // Nothing read the field either, so it was a fingerprint of real people
    // carried for a feature nobody has committed to building — the opposite of
    // what section 8 asks of us. Dedupe can start collecting when someone
    // builds it, against rules that were written with it in mind.

    // Its own copy of the wheel's expiry, because a Firestore TTL policy
    // deletes the document it matches and NOT that document's subcollections.
    // Without this field a reaped wheel would leave its suggestions behind
    // forever — arbitrary user-submitted text with no wheel to reach it from,
    // which is precisely the indefinite ownership design doc section 8 exists
    // to avoid.
    //
    // Set equal to the wheel's expiry AT SUBMIT TIME, and never slid
    // afterwards. That is decision 20, and the cost is real rather than
    // notional: the wheel's expiry moves forward on every write and this one
    // does not, so on a wheel still in use after 30 days the policy deletes
    // pending suggestions out of a live queue that participants can see, and
    // accepted ones out from under the `fromSuggestion` provenance pointing at
    // them.
    //
    // Accepted rather than fixed, because the fix is a fan-out — sliding up to
    // PENDING_SUGGESTIONS_MAX subcollection documents on every edit, on a wheel
    // whose submit path is unauthenticated and therefore attacker-drivable —
    // and what it buys back is a suggestion nobody actioned in a month. The
    // direction is what matters and it is asymmetric: a suggestion must not
    // outlive its wheel, because that orphan is unrecoverable, whereas one
    // reaped early is a row on a wheel nobody has touched since.
    //
    // Both halves of that are asserted in app/api/wheels/expiry.emulator.test.ts
    // — that this never runs past the wheel, and that no route slides it. The
    // policy itself is applied by scripts/configure-ttl.mjs, on the
    // `suggestions` collection group as well as on `wheels` and `wheelSecrets`.
    expiresAt: slide.wheel.expiresAt,
  })
  batch.update(wheelRef, slide.wheel)
  batch.update(db.collection(WHEEL_SECRETS).doc(shareId), slide.secret)

  await commit(() => batch.commit(), 'submitSuggestion', shareId)

  return {
    suggestion: {
      id: suggestionRef.id,
      label: input.label,
      status: 'pending',
    },
    updatedAt: slide.wheel.updatedAt,
  }
}

/**
 * Accept a pending suggestion onto the wheel, in one transaction.
 *
 * Every caller must have passed `assertEditor` first.
 *
 * Returns the option this call created, or `null` when the suggestion had
 * already been accepted and nothing was written. That second case is what makes
 * a double-click safe, and design doc section 4 names it as the reason accepting
 * is a transaction at all: the `arrayUnion` onto `options` and the status flip
 * have to be one atomic step, or two clicks racing each other both read
 * `pending` and both append.
 *
 * **The status flip is this operation's idempotency key, and it is the only
 * thing making it idempotent.** That is worth stating plainly because
 * `addOption` next door works the other way round and the difference is easy to
 * misread. There, the option element is built outside the transaction so that
 * `arrayUnion` re-appending an identical value is a no-op, and a separate guard
 * keeps the capacity check from misfiring on a retry that already committed.
 *
 * Here the element cannot be built outside: its label comes from the
 * suggestion, which is read inside. So every retry mints a fresh id, and
 * nothing about the append is self-deduplicating. What makes a retry safe is
 * the `status === 'accepted'` branch below — a re-run re-reads the suggestion,
 * sees the flip its own previous attempt committed, and returns before building
 * anything at all.
 *
 * The consequence for anyone changing this: relaxing that branch, or checking
 * the wheel's options instead of the suggestion's status, reintroduces exactly
 * the duplicate the transaction exists to prevent. It is not the transaction
 * alone that holds design doc section 4's "a double-click can't duplicate an
 * option" — it is the transaction plus that early return.
 */
export async function acceptSuggestion(
  shareId: string,
  suggestionId: string,
  db: Firestore = getAdminDb(),
): Promise<WheelVersion & { option: StoredOption | null }> {
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }
  assertSuggestionId(suggestionId)

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const secretRef = db.collection(WHEEL_SECRETS).doc(shareId)
  const suggestionRef = wheelRef.collection(SUGGESTIONS).doc(suggestionId)

  let created: StoredOption | null = null
  /**
   * Null until the transaction says otherwise, and never a clock read taken out
   * here.
   *
   * The idempotent path below writes NOTHING, so a version computed before the
   * transaction would be a value strictly ahead of what is stored — the one
   * failure the whole mechanism cannot survive, because it describes a state no
   * snapshot ever carries and every optimistic row on the wheel then waits for
   * it forever. Reassigned on every attempt for the same reason as in
   * `addOption`: a transaction body can run more than once and only the last
   * attempt commits.
   */
  let version: Date | null = null

  await commit(
    () =>
      db.runTransaction(async (transaction) => {
        // Reset per attempt. A retry that finds the suggestion already accepted
        // must not report the option a previous attempt believed it was making.
        created = null

        // `getAll` rather than two awaited gets: one round trip, and Firestore
        // requires every read in a transaction to precede every write, which is
        // easier to keep true when the reads are one call.
        const [wheel, suggestion] = await transaction.getAll(
          wheelRef,
          suggestionRef,
        )

        if (!wheel.exists) {
          // As in `addOption`: the caller has passed `assertEditor`, so the
          // secret was there a moment ago and a missing wheel is the pair
          // having come apart rather than an unknown wheel.
          throw reapedWheel('acceptSuggestion', shareId)
        }

        if (!suggestion.exists) {
          throw new ValidationError(
            404,
            'no_such_suggestion',
            'That suggestion is no longer there. Someone may have rejected it already.',
          )
        }

        const status: unknown = suggestion.get('status')

        // The idempotent path. No writes at all, not even the expiry slide —
        // a second click is not activity, and sliding on it would make a
        // wheel's lifetime depend on how many times its editor tapped.
        //
        // The version therefore comes from the wheel we have already read, not
        // from a write we are not making. It is the honest answer to what the
        // caller is really asking: the wheel is already at or past the state
        // you wanted. Unreadable leaves it null, and the route sends no header.
        if (status === 'accepted') {
          version = storedVersion(wheel.get('updatedAt'))
          return
        }

        if (status !== 'pending') {
          // Unreachable through this API: nothing writes a third status, and
          // reject deletes rather than flipping (design doc section 4). Named
          // rather than left to fall through and be accepted, so a row that got
          // into a state we do not define is refused instead of copied onto the
          // wheel.
          throw new ValidationError(
            409,
            'suggestion_not_pending',
            'That suggestion cannot be accepted.',
          )
        }

        const label: unknown = suggestion.get('label')
        if (typeof label !== 'string') {
          // Our own data being wrong, not the request. A 500 is the honest
          // answer; there is nothing the editor could change to make this work.
          throw new Error(
            `${SUGGESTIONS}/${suggestionId} on wheels/${shareId} has no label.`,
          )
        }

        // Deliberately NOT re-validated. `validateSuggestionLabel` held this
        // string to the option rules when it was submitted, which is the whole
        // reason those two validators share a cap — see the note on it in
        // ./validation.ts. Re-running the check here could only ever fail in
        // front of an editor who has no way to fix the input, since the label
        // is not theirs and is immutable (decision 10).
        const option = optionElement({ label, fromSuggestion: suggestionId })

        assertOptionCapacity(storedOptions(wheel.data()).length)

        const slide = slidingExpiry()
        version = slide.wheel.updatedAt
        transaction.update(wheelRef, {
          options: FieldValue.arrayUnion(option),
          ...slide.wheel,
        })
        transaction.update(secretRef, slide.secret)
        transaction.update(suggestionRef, {
          status: 'accepted' satisfies SuggestionStatus,
        })

        created = option
      }),
    'acceptSuggestion',
    shareId,
  )

  return { option: created, updatedAt: version }
}

/**
 * Reject a suggestion by deleting it, and slide the wheel's expiry forward.
 *
 * Every caller must have passed `assertEditor` first.
 *
 * A hard delete rather than a status flip, per design doc section 4: the queue
 * is visible to every participant, so a `rejected` row would leave whatever was
 * submitted on display to everyone until someone built a filter for it. On a
 * wheel being brigaded, that is the entire problem rather than a detail of it.
 *
 * Idempotent, and costs one write with no read. `delete` on a document that is
 * not there succeeds, so a client is safe to retry a DELETE whose response it
 * never saw — the same property, for the same reason, as `removeOption`.
 *
 * An accepted suggestion may be deleted too. The option it produced keeps a
 * `fromSuggestion` pointing at a document that is gone, which costs nothing:
 * the field is provenance and nothing dereferences it. Refusing would leave an
 * editor unable to clear an accepted row out of a public queue, which is the
 * housekeeping this endpoint is for.
 */
export async function rejectSuggestion(
  shareId: string,
  suggestionId: string,
  db: Firestore = getAdminDb(),
): Promise<WheelVersion> {
  if (!isShareId(shareId)) {
    throw new EditorAuthError(404, 'no_such_wheel', 'No wheel with that ID.')
  }
  assertSuggestionId(suggestionId)

  const wheelRef = db.collection(WHEELS).doc(shareId)
  const slide = slidingExpiry()

  const batch = db.batch()
  batch.delete(wheelRef.collection(SUGGESTIONS).doc(suggestionId))
  // The wheel is not read first: `update` on a document that is not there fails
  // NOT_FOUND, which `commit` turns into the 404 a missing wheel deserves. One
  // round trip instead of two, and the delete cannot land without it.
  batch.update(wheelRef, slide.wheel)
  batch.update(db.collection(WHEEL_SECRETS).doc(shareId), slide.secret)

  await commit(() => batch.commit(), 'rejectSuggestion', shareId)

  return { updatedAt: slide.wheel.updatedAt }
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
