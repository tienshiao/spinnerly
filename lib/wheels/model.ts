/**
 * The shared wheel vocabulary — the shapes both halves of the app agree on, and
 * the ID guards that keep a caller-supplied string out of a Firestore path.
 *
 * Design doc section 3 splits the data path in two: the browser reads Firestore
 * directly through `onSnapshot`, the server writes through the Admin SDK. Those
 * two halves have to agree on what a wheel *is*, and this is where that
 * agreement lives — stated once, rather than restated on the client as a type
 * that drifts from the one the writes produce.
 *
 * Deliberately free of `server-only`, `firebase-admin` and `firebase`, like
 * ./validation.ts and ./tokens.ts. It is types and two regex tests, so it
 * imports into a browser bundle and unit-tests with nothing but `npm install`.
 *
 * `store.ts` re-exports everything here, so the server keeps importing from the
 * module it already imports from and there is still exactly one definition of
 * each shape. The dependency direction is the safe one: nothing here can reach
 * store.ts, so a client component that reaches for store.ts by mistake gets
 * `server-only`'s build error rather than a browser bundle with the Admin SDK
 * quietly inside it.
 */

/**
 * The two collections both halves of the app address.
 *
 * Here rather than in ./store.ts because the browser opens its listeners on
 * exactly these paths, and a collection name that disagreed between the writer
 * and the reader would be a listener on an empty collection — no error, no
 * refusal, just a wheel that never updates.
 *
 * `wheelSecrets` is deliberately NOT here. See ./store.ts for why.
 */
export const WHEELS = 'wheels'

/** The suggestions subcollection of a wheel. `wheels/{shareId}/suggestions`. */
export const SUGGESTIONS = 'suggestions'

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
 *
 * Shared with `isSuggestionId` below, which is the same shape for the same
 * reason — every ID this codebase puts in a path is one Firestore minted.
 */
const SHARE_ID = /^[A-Za-z0-9]{20}$/

export function isShareId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID.test(value)
}

/**
 * Whether `value` can name a suggestion document.
 *
 * The same shape and, more to the point, the same argument: a suggestion ID is
 * taken from the request path and reaches
 * `wheels/{shareId}/suggestions/{suggestionId}`, so an unvalidated one is a
 * path-traversal primitive exactly as `shareId` is. `../..` walks back out of
 * the subcollection and names a document on another wheel entirely.
 *
 * This is what separates it from `optionId`, which never reaches a path — see
 * `OPTION_ID_MAX` in ./store.ts for why that one is a bound rather than a
 * boundary.
 */
export function isSuggestionId(value: unknown): value is string {
  return typeof value === 'string' && SHARE_ID.test(value)
}

/**
 * One entry in a wheel's `options` array. Design doc section 4.
 *
 * The same shape on both sides of the split, which is the point of it living
 * here: `optionElement` in ./store.ts writes exactly these four fields, and
 * `decodeWheel` in ./snapshot.ts reads exactly these four back. `arrayRemove`
 * matches array elements by DEEP EQUALITY, so an element written with a
 * different set of fields is an element the remove endpoint cannot address —
 * and the failure would be a silent no-op delete rather than an error.
 */
export type WheelOption = {
  id: string
  label: string
  addedAt: Date | null
  /** The suggestion this came from, or null when an editor typed it. */
  fromSuggestion: string | null
}

/**
 * The status of a suggestion. Two values, and never a third.
 *
 * There is deliberately no `"rejected"`. Design doc section 4 makes reject a
 * hard delete because the queue is visible to every participant, so a rejected
 * row would leave spam and abuse on display until someone built a filter. The
 * type is the first statement of that; `rejectSuggestion` in ./store.ts
 * deleting rather than flipping is the second.
 */
export type SuggestionStatus = 'pending' | 'accepted'

/** One document from `wheels/{shareId}/suggestions`. Design doc section 4. */
export type Suggestion = {
  id: string
  label: string
  status: SuggestionStatus
  createdAt: Date | null
  expiresAt: Date | null
}

/**
 * A wheel as a client holds it, decoded from `wheels/{shareId}`.
 *
 * Every timestamp is nullable and none of them should be treated as a
 * guarantee. Two reasons, and the second is the one that bites:
 *
 *  1. ./snapshot.ts decodes defensively — a field that is missing or of the
 *     wrong type becomes `null` rather than throwing, because a throw inside an
 *     `onSnapshot` callback tears the listener down and the page then stops
 *     updating with no error anyone sees.
 *  2. `serverTimestamp()` resolves on the server, so a listener on a document
 *     the server has just written can observe the field as null in the moment
 *     between the local echo and the round trip. This client never writes, so
 *     it should not see that — but "should not" is doing a lot of work in a
 *     type that a rendering component will dereference.
 *
 * `shareId` is not a stored field. It is the document ID, carried here so a
 * decoded wheel knows which wheel it is without the caller pairing them up.
 */
export type Wheel = {
  shareId: string
  title: string
  options: WheelOption[]
  suggestionsOpen: boolean
  createdAt: Date | null
  updatedAt: Date | null
  /** TTL target; slides forward on any activity. Design doc section 8. */
  expiresAt: Date | null
}

/**
 * The version of `wheels/{shareId}` that a mutating write produced.
 *
 * Every write route returns this, in the `x-wheel-updated-at` response header,
 * and it is the answer to the one question a client could not otherwise ask:
 * **is the document I am looking at at or past the version my own write
 * produced?**
 *
 * Without it the client can only count snapshot deliveries, and a count cannot
 * tell a delivery generated after our commit from one still in flight from
 * before it. Every retirement rule in ./optimistic.ts rests on this, and it is
 * why `updatedAt` is written as a real `Date` rather than as a server-timestamp
 * sentinel — see `writeVersion` in ./store.ts.
 *
 * It is the wheel's version on every route including the suggestion ones,
 * because TASK-14 slides `expiresAt` on the wheel document for every mutation
 * there is. One field therefore versions the whole wheel, subcollection
 * included.
 *
 * **Null means "no version to report", and is never an error.** Two things
 * produce it, from opposite ends of the wire:
 *
 *  - A write that stored nothing and could not read back what was already
 *    there — the idempotent second accept, if the wheel's stored `updatedAt`
 *    is unreadable. The route then sends no header at all.
 *  - A response that reached the client without one: a proxy stripping unknown
 *    headers, an older deployment answering mid-rollout.
 *
 * A caller that gets null falls back to identity evidence alone, which is
 * sound and never retires early — it simply cannot conclude that something is
 * absent because it was deleted rather than because it has not arrived. What
 * must NEVER happen is reporting a version that was not stored: a value ahead
 * of the document describes a state no snapshot ever carries, and every
 * optimistic row on that wheel then waits for it forever.
 */
export type WheelVersion = {
  updatedAt: Date | null
}

/**
 * The response header every mutating route stamps its version onto.
 *
 * A header rather than a body, and the reason is the 204s. Four of the six
 * mutating routes answer `204 No Content` on purpose — a delete is a 204
 * whether or not there was anything to delete, which is what makes those
 * endpoints safe to call twice — and moving the version into a body would mean
 * turning those into 200s and rewriting the reasoning that goes with them. The
 * version is metadata ABOUT the write rather than a representation of the
 * thing written, so a header is where it belongs anyway.
 *
 * ISO 8601 with milliseconds. Deliberately not `Last-Modified`, whose HTTP-date
 * format has one-second resolution — two writes inside the same second would be
 * indistinguishable, which is exactly the case this exists to resolve.
 */
export const WHEEL_VERSION_HEADER = 'x-wheel-updated-at'

/**
 * What creating or forking a wheel yields. `createWheel` and `duplicateWheel`
 * in ./store.ts produce it; the matching methods in ./api-client.ts read it
 * back off the wire, which is why the shape is stated here rather than twice.
 */
export type CreatedWheel = {
  shareId: string
  /**
   * The raw edit token, in plaintext. Emitted exactly once, in the response
   * body, and it lives in the URL fragment from there. It is not recoverable:
   * only its hash is stored.
   */
  editToken: string
}

/**
 * What an Open Graph unfurl knows about a wheel.
 *
 * `readWheelPreview` in ./store.ts produces it, and it is the whole input to
 * app/og/preview.ts and to both cards.
 *
 * **`optionCount` is separate from `options.length` on purpose.** The labels are
 * a sample — the card names four and counts the rest — so the count has to be
 * the wheel's rather than the sample's, and deriving one from the other would
 * make "+2 more" impossible to state. Nothing here may assume `options` is
 * complete.
 *
 * Stated here rather than in ./store.ts so the card renderer can name the type
 * without importing a `server-only` module. It is not on the client data path
 * and nothing in a browser bundle refers to it.
 */
export type WheelPreview = {
  title: string
  /** Every option on the wheel, in wheel order. */
  options: string[]
  /** How many there are, which is what the card counts. */
  optionCount: number
}

/** A suggestion as `POST /wheels/{shareId}/suggestions` reports it. */
export type CreatedSuggestion = {
  id: string
  label: string
  status: SuggestionStatus
}

/**
 * The fields a wheel patch may set. Deliberately not `options`.
 *
 * Options are mutated only through the granular add and remove endpoints. A
 * whole-array write is the lost-update bug those endpoints exist to avoid, and
 * the edit URL being transferable makes concurrent editors a supported case
 * rather than an edge one (design doc section 6). The type is the first line of
 * that defence; the route refusing an `options` key explicitly is the second.
 */
export type WheelPatch = {
  title?: string
  suggestionsOpen?: boolean
}
