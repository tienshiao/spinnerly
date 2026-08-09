import { DEFAULT_TITLE } from './validation'
import type { Suggestion, SuggestionStatus, Wheel, WheelOption } from './model'

/**
 * Decode a Firestore document's data into the shared shapes in ./model.ts.
 *
 * The read half of design doc section 3. The browser holds `onSnapshot`
 * listeners straight onto Firestore, so this is where a stored document stops
 * being `unknown` and becomes something a component can render.
 *
 * **Nothing here throws, and that is the whole design.** These functions run
 * inside an `onSnapshot` callback, and Firestore does not catch what a listener
 * callback throws — the exception escapes into the SDK, the listener is left in
 * an undefined state, and the visible symptom is a page that silently stops
 * updating. There is no error boundary between here and there, and no console
 * line that names the wheel. So every field is decoded to a usable fallback
 * instead: a wheel with one corrupt field renders with that field missing,
 * which a user can see and report, rather than freezing the whole page.
 *
 * The one exception to "keep everything" is an option that cannot be keyed or
 * labelled — see `decodeOption`.
 *
 * Takes `unknown` rather than a `DocumentSnapshot`, so this module imports no
 * Firebase runtime at all and unit-tests in node with plain object literals.
 * The hooks call it with `snapshot.data()`.
 */

/** Narrow to a plain record without asserting anything about its values. */
function fields(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)
    : {}
}

/**
 * A Firestore `Timestamp`, a `Date`, or nothing usable.
 *
 * Duck-typed on `toDate` rather than `instanceof Timestamp`, so this module
 * needs no import from `firebase/firestore` and cannot be broken by two copies
 * of the SDK ending up in one bundle — an `instanceof` across those two copies
 * is false for a value that is, in every sense that matters, a Timestamp.
 *
 * The `getTime` check at the end is not redundant. `new Date('nonsense')` is a
 * Date object whose time is `NaN`, and it formats as "Invalid Date" wherever a
 * component renders it; `null` at least has an obvious empty rendering.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate: unknown }).toDate === 'function'
  ) {
    try {
      const date: unknown = (value as { toDate: () => unknown }).toDate()
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date
    } catch {
      // A `toDate` that throws is not a Timestamp. Fall through to null rather
      // than let it escape into the listener callback.
    }
  }

  return null
}

function toText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Whether a value is one of the two statuses the data model actually has.
 *
 * Exported because the API client validates the same field on the body
 * `POST /suggestions` returns, and a status is the one field of that response
 * that a component branches on.
 */
export function isSuggestionStatus(value: unknown): value is SuggestionStatus {
  return value === 'pending' || value === 'accepted'
}

/**
 * Decode one element of the `options` array, or drop it.
 *
 * This is the only place a stored value is discarded rather than defaulted, and
 * the reason is that the two fields it needs have no honest fallback:
 *
 *  - Without `id` the option cannot be keyed for React and cannot be addressed
 *    by `DELETE /options/{optionId}`, so it is a row an editor can see and can
 *    never remove.
 *  - Without `label` there is nothing to draw on a slice, and inventing a
 *    placeholder would put a word on the wheel that could be spun and won.
 *
 * `addedAt` and `fromSuggestion` do have honest fallbacks and keep the option:
 * neither is rendered in v1, and losing an option over a field nothing shows
 * would be the worse trade.
 *
 * Duplicate `id`s are deliberately NOT deduped. `optionElement` in ./store.ts
 * mints a UUID per option so they should not occur, and if they somehow do, two
 * rendered rows and React's duplicate-key warning are more honest than one row
 * silently standing in for two.
 */
function decodeOption(value: unknown): WheelOption | null {
  const raw = fields(value)
  const id = toText(raw.id)
  const label = toText(raw.label)

  if (id === null || label === null) return null

  return {
    id,
    label,
    addedAt: toDate(raw.addedAt),
    fromSuggestion: toText(raw.fromSuggestion),
  }
}

/**
 * Decode `wheels/{shareId}`.
 *
 * `shareId` comes from the caller — it is the document ID, not a stored field —
 * so a decoded wheel knows which wheel it is without the caller pairing the two
 * up by hand.
 *
 * `suggestionsOpen` is `=== true` rather than a truthiness or a nullish
 * default, which mirrors `submitSuggestion` in ./store.ts exactly: the server
 * refuses a submission unless the stored value is literally `true`. Anything
 * else — absent, null, the string `"true"` — is a closed wheel on both sides,
 * so the client cannot end up offering a form for a submission the server will
 * refuse.
 */
export function decodeWheel(shareId: string, data: unknown): Wheel {
  const raw = fields(data)
  const options = Array.isArray(raw.options) ? raw.options : []

  return {
    shareId,
    // The same default the create route applies to a title-less wheel, so a
    // document missing the field renders the way an unnamed wheel does rather
    // than as an empty heading.
    title: toText(raw.title) ?? DEFAULT_TITLE,
    options: options
      .map(decodeOption)
      .filter((option): option is WheelOption => option !== null),
    suggestionsOpen: raw.suggestionsOpen === true,
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
    expiresAt: toDate(raw.expiresAt),
  }
}

/**
 * Decode `wheels/{shareId}/suggestions/{suggestionId}`.
 *
 * An unrecognised `status` decodes as `pending`, which is the direction that
 * keeps an editor's queue usable: a pending row can be accepted or rejected,
 * while an `accepted` one is done with. A corrupt status that read as accepted
 * would strand the suggestion in the queue with no action that clears it.
 */
export function decodeSuggestion(id: string, data: unknown): Suggestion {
  const raw = fields(data)

  return {
    id,
    label: toText(raw.label) ?? '',
    status: isSuggestionStatus(raw.status) ? raw.status : 'pending',
    createdAt: toDate(raw.createdAt),
    expiresAt: toDate(raw.expiresAt),
  }
}

/**
 * Order the queue the way an editor works through it: oldest first, so a
 * suggestion's position does not move under the cursor as newer ones arrive.
 *
 * Sorting here rather than with an `orderBy` on the Firestore query is
 * deliberate, and the reason is a property of ordered queries rather than a
 * preference. **Firestore excludes from an ordered query every document that
 * does not have the field being ordered on.** A suggestion whose `createdAt`
 * is missing would therefore not be absent from the sort — it would be absent
 * from the RESULT, invisible to the editor who has to action it and to the
 * participant wondering where their submission went, with no error anywhere.
 * An unordered listener plus this comparator cannot lose a row.
 *
 * A null `createdAt` accordingly means the field is missing or unusable, not
 * "recent". It sorts last so an undateable row stays visible at the end of the
 * queue rather than jumping to the front of it.
 */
export function bySubmissionOrder(a: Suggestion, b: Suggestion): number {
  if (a.createdAt === null || b.createdAt === null) {
    if (a.createdAt === b.createdAt) return a.id < b.id ? -1 : 1
    return a.createdAt === null ? 1 : -1
  }

  const byTime = a.createdAt.getTime() - b.createdAt.getTime()
  // Ties broken on ID so the order is total. Firestore timestamps are
  // microsecond-resolution, so a tie means two suggestions written in the same
  // batch — rare, but an unstable comparator makes rows swap places on an
  // unrelated snapshot, which looks like the list is fidgeting.
  return byTime !== 0 ? byTime : a.id < b.id ? -1 : 1
}
