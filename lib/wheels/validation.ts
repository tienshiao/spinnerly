/**
 * Shared input caps and validators, per design doc sections 4 and 7.
 *
 * Every write route imports its limits from here so the numbers cannot drift
 * between endpoints — a suggestion accepted into `options` has to satisfy the
 * same label rule the option endpoint enforces, or accepting one becomes a way
 * to write an option the option endpoint would have refused.
 *
 * The caps are load-bearing rather than cosmetic. Design doc section 7 defers
 * rate limiting out of v1 for want of a Redis to keep the state in, which leaves
 * these per-wheel caps as the only thing bounding the damage a single scraped
 * share URL can do. Raising one is a cost decision, not a UI tweak.
 *
 * Deliberately free of Firestore and of `server-only`, like ./tokens.ts: it is
 * pure computation over strings, so it unit-tests with nothing but
 * `npm install`, and the client can import from it directly. A character
 * counter in the editor should be built from `countCharacters` and the caps
 * below rather than from `value.length`, or it will disagree with the server on
 * every label containing an emoji — see `countCharacters` for why.
 */

/** Maximum characters in an option label. Design doc section 4. */
export const OPTION_LABEL_MAX = 60

/** Maximum characters in a suggestion label. Design doc section 4. */
export const SUGGESTION_LABEL_MAX = 60

/**
 * Maximum characters in a wheel title.
 *
 * Not a number the design doc gives — it only says a title exists. 80 is chosen
 * to sit a little above the label cap: a title is read once at the top of the
 * page and in the OG unfurl, where it has a full line to itself, whereas a
 * label has to fit inside a wheel segment.
 */
export const TITLE_MAX = 80

/** Maximum options on one wheel. Design doc sections 4 and 7 ("~50"). */
export const OPTIONS_MAX = 50

/** Maximum pending suggestions on one wheel. Design doc section 7 ("~200"). */
export const PENDING_SUGGESTIONS_MAX = 200

/**
 * The title a wheel gets when created without one.
 *
 * Neutral on purpose. The alternative — inventing something like "My wheel" —
 * reads as content the creator wrote rather than as an absent field, so they are
 * less likely to replace it.
 */
export const DEFAULT_TITLE = 'Untitled wheel'

/**
 * A rejected input, with the status and code the route should return.
 *
 * Thrown rather than returned, and shaped like `EditorAuthError` in ./store.ts
 * for the same reason: a caller who forgets to inspect a returned result carries
 * on and writes the unvalidated value, whereas a caller who forgets to catch
 * this gets a 500 and no write. Routes catch it and call `toResponse()`.
 *
 * `code` is the stable half of the contract — clients branch on it. `message` is
 * for humans and may be reworded.
 */
export class ValidationError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ValidationError'
    this.status = status
    this.code = code
  }

  /** The response body shape every write route returns for a rejected input. */
  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message },
      { status: this.status },
    )
  }
}

/**
 * Characters no label may contain.
 *
 * `\p{Cc}` is exactly C0, DEL and C1 — terminal and protocol control codes
 * rather than text. They have no business in a lunch option, and some cause
 * damage downstream: a newline forges a second line in any log record built by
 * concatenation.
 *
 * `\p{Bidi_Control}` is the directional formatting family — the overrides,
 * embeddings and isolates, plus LRM/RLM/ALM. These are here for a different
 * reason: they are legitimate Unicode, but they reorder the text around them, so
 * a label can be made to *display* as something other than what was stored.
 * Every label on this site is attacker-supplied text shown to strangers, which
 * is exactly the setting that trick is for.
 *
 * Both are written as property escapes rather than as code-point ranges so that
 * the set stays correct as Unicode assigns more of it, and so that no reviewer
 * has to check a hand-typed range boundary against a table.
 *
 * Ordinary whitespace is excluded and handled by `collapseWhitespace` instead —
 * which also runs first, so the tabs and newlines inside `\p{Cc}` have already
 * become spaces by the time this test sees the value. A user pasting a label
 * with a tab in it made a formatting mistake, not an attack, and rejecting the
 * paste outright would be the wrong response to it.
 */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/u

const WHITESPACE_RUN = /\s+/gu

/**
 * The zero-width space, U+200B, treated as the padding it is.
 *
 * Built with `fromCodePoint` rather than written into a regex literal, because
 * a literal would be an invisible character sitting in a character class where
 * no reader could see it and any editor would be free to eat it.
 *
 * It needs handling separately because `\s` does not match it, while it does
 * match every Unicode separator worth naming — NBSP, the en/em quad family, the
 * line and paragraph separators and the BOM. Collapsing it to a space rather
 * than deleting it keeps `a<ZWSP>b` two words, which is what it was used as.
 *
 * This is a normalisation, not a defence. Emptiness is `VISIBLE_CHARACTER`'s
 * job — see there for why enumerating invisible characters here would not work.
 */
const ZERO_WIDTH_SPACE = new RegExp(String.fromCodePoint(0x200b), 'gu')

/**
 * Hangul fillers: U+115F, U+1160, U+3164, U+FFA0.
 *
 * Blank by design and, unlike everything else invisible, category `Lo` —
 * ordinary letters as far as Unicode is concerned, so no property escape
 * excludes them. They are the classic way to make a "blank" name on a service
 * that only rejects whitespace.
 */
const HANGUL_FILLERS = [0x115f, 0x1160, 0x3164, 0xffa0]
  .map((codePoint) => String.fromCodePoint(codePoint))
  .join('')

/**
 * One character that actually shows something.
 *
 * A label has to contain at least one of these, which is the real emptiness
 * check — a length test only catches the empty string. The set is defined by
 * exclusion on purpose:
 *
 *  - `\s` and the Hangul fillers, per above.
 *  - `\p{Cf}` — every format character. This is the class that makes an
 *    allowlist hopeless: it holds ZWSP, ZWNJ, ZWJ, the word joiner U+2060, the
 *    soft hyphen U+00AD, the bidi controls and the tag characters, and Unicode
 *    keeps adding to it. Enumerating them means being wrong again at the next
 *    revision, whereas requiring one visible character is a property of the
 *    label that stays true whatever gets assigned later.
 *
 * Note what this does NOT do: it does not strip or reject format characters
 * inside an otherwise visible label. `Tacos<ZWJ>` stays as typed. That is
 * deliberate — ZWJ holds a multi-person emoji together, ZWNJ is orthographically
 * required in Persian and several Indic scripts, and the tag characters encode
 * the England and Scotland flag emoji. Rejecting the class outright would break
 * correct text; requiring one visible character costs none of it and closes the
 * blank-label hole, which is the part that actually bites.
 */
const VISIBLE_CHARACTER = new RegExp(`[^\\s\\p{Cf}${HANGUL_FILLERS}]`, 'u')

/**
 * Collapse every run of whitespace — including the tabs and newlines that
 * `CONTROL_CHARACTERS` deliberately leaves alone — to a single space, and trim
 * the ends.
 *
 * Normalising rather than rejecting is what makes pasting from a spreadsheet or
 * a chat message work, which is how most option lists actually get typed.
 */
function collapseWhitespace(value: string): string {
  return value
    .replace(ZERO_WIDTH_SPACE, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
}

/**
 * The number of characters in `value`, counted in Unicode code points.
 *
 * Exported for the client, which has to measure a label the same way the server
 * does or the editor's character counter will block submissions the server would
 * have accepted. That is not hypothetical: `value.length` on 40 emoji reads 80.
 *
 * Which unit to count in is a real decision with three defensible answers, and
 * the two rejected ones both fail in ways that matter here:
 *
 *  - **UTF-16 code units** (`value.length`) is what JavaScript hands you for
 *    free and it is wrong: a single emoji is two units, so "60 characters"
 *    silently becomes 30 for anyone whose label is emoji, and a label that
 *    passes the client's own counter fails on the server.
 *  - **Grapheme clusters** (`Intl.Segmenter`) is what a user means by
 *    "character", and it is unbounded: a cluster can carry arbitrarily many
 *    combining marks, so 60 graphemes can be megabytes. With 50 options in one
 *    document that walks into Firestore's 1MB limit, where the failure is a
 *    rejected write surfacing as a 500 rather than a clean 400.
 *
 * Code points after NFC gets the emoji case close enough — precomposed accents
 * count as one — while staying bounded at 4 bytes each, which caps a full
 * wheel's labels at roughly 12KB. The residual cost is that a ZWJ sequence (a
 * family emoji is 7 code points) counts as more than it looks. That is the safe
 * direction, and it is not the case these labels are for.
 */
export function countCharacters(value: string): number {
  return [...value].length
}

/**
 * How much longer than its cap a raw input may be before it is refused unread.
 *
 * `normalize` and the two replaces each allocate a fresh copy of the string, so
 * they are done only once the input is in the right order of magnitude. Route
 * handlers read the body with `request.json()`, which has no size limit of its
 * own — Next.js caps Server Actions, not route handlers — so without this a
 * single POST of a 50MB label allocates several copies of it per request, and
 * this module's own header claims the caps are what bounds a scraped share URL.
 *
 * The factor is deliberately far above the cap, because this is not the cap —
 * the real one runs after normalisation, on code points, and is the only number
 * a user should ever meet. This one exists solely to refuse the absurd, so its
 * only job is to sit above anything a person could produce by accident: it
 * measures UTF-16 units before normalising, so it has to clear a 60-code-point
 * label of astral characters (two units each) that also arrived with whitespace
 * padding around it, and the cost of clearing it by a wide margin is one
 * normalise of a few kilobytes. An earlier value of 8 rejected 60 emoji with
 * 200 spaces of padding, which is a paste, not an attack.
 */
const RAW_LENGTH_FACTOR = 64

/**
 * Everything that differs between the three text fields.
 *
 * Bundled rather than passed positionally because the codes are the half of the
 * contract clients branch on, and five bare strings at a call site is how one
 * ends up in the wrong slot.
 */
type TextField = {
  /** Names the field at the start of a sentence: "An option is …". */
  subject: string
  /** Names it when the message points back at it: "That option is …". */
  demonstrative: string
  max: number
  invalidCode: string
  emptyCode: string
  tooLongCode: string
}

/**
 * Clean `raw` and reject it if it cannot be stored.
 *
 * Returns the sanitised value rather than validating in place, so a caller
 * cannot check the normalised string and then write the raw one.
 *
 * The order of the checks matters. Normalisation runs before the length check,
 * never after, or the cap would depend on which of two identical-looking
 * encodings the client happened to send: `é` typed on a Mac arrives decomposed
 * as two code points and would count double against a limit applied first.
 */
function validateText(raw: unknown, field: TextField): string {
  if (typeof raw !== 'string') {
    throw new ValidationError(
      400,
      field.invalidCode,
      `${field.subject} must be text.`,
    )
  }

  if (raw.length > field.max * RAW_LENGTH_FACTOR) {
    // Reported as the ordinary over-length rejection rather than under a code of
    // its own. It is a distinct condition — no honest client reaches it — but a
    // separate code would tell a prober exactly which requests were refused
    // unread, which is the one thing they could not otherwise measure.
    throw new ValidationError(
      400,
      field.tooLongCode,
      `${field.demonstrative} is too long. The limit is ${field.max} characters.`,
    )
  }

  // Before the control-character check, so a normalisation form that expanded
  // into one could not slip past it. NFC does not do that today; the ordering
  // costs nothing and removes the need to know that.
  const value = collapseWhitespace(raw.normalize('NFC'))

  if (CONTROL_CHARACTERS.test(value)) {
    throw new ValidationError(
      400,
      field.invalidCode,
      `${field.subject} cannot contain control characters.`,
    )
  }

  // Not a length test. A label of word joiners or Hangul fillers is several
  // characters long and still renders as a blank wheel segment nobody can
  // select or explain — see VISIBLE_CHARACTER.
  if (!VISIBLE_CHARACTER.test(value)) {
    throw new ValidationError(
      400,
      field.emptyCode,
      `${field.subject} cannot be empty.`,
    )
  }

  const length = countCharacters(value)
  if (length > field.max) {
    // The limit is named because the client renders this verbatim; "too long"
    // alone gives the user nothing to correct towards.
    throw new ValidationError(
      400,
      field.tooLongCode,
      `${field.demonstrative} is ${length} characters. The limit is ${field.max}.`,
    )
  }

  return value
}

const OPTION_FIELD: TextField = {
  subject: 'An option',
  demonstrative: 'That option',
  max: OPTION_LABEL_MAX,
  invalidCode: 'invalid_label',
  emptyCode: 'empty_label',
  tooLongCode: 'label_too_long',
}

const SUGGESTION_FIELD: TextField = {
  subject: 'A suggestion',
  demonstrative: 'That suggestion',
  max: SUGGESTION_LABEL_MAX,
  invalidCode: 'invalid_label',
  emptyCode: 'empty_label',
  tooLongCode: 'label_too_long',
}

const TITLE_FIELD: TextField = {
  subject: 'A title',
  demonstrative: 'That title',
  max: TITLE_MAX,
  invalidCode: 'invalid_title',
  emptyCode: 'empty_title',
  tooLongCode: 'title_too_long',
}

/**
 * The stored form of an option label, or a `ValidationError`.
 *
 * Returns the sanitised value rather than validating in place, so a caller
 * cannot accidentally write the raw input after having checked the normalised
 * one.
 */
export function validateOptionLabel(raw: unknown): string {
  return validateText(raw, OPTION_FIELD)
}

/**
 * The stored form of a suggestion label, or a `ValidationError`.
 *
 * Held to the same rules as an option label rather than looser ones, because
 * accepting a suggestion copies it into `options` (design doc section 4). A
 * suggestion the option endpoint would refuse is a write the accept endpoint
 * would have to refuse later, in front of an editor who cannot fix it.
 */
export function validateSuggestionLabel(raw: unknown): string {
  return validateText(raw, SUGGESTION_FIELD)
}

/**
 * The stored form of a wheel title. Requires one.
 *
 * An absent title is rejected here rather than defaulted, which is the whole
 * reason this is separate from `validateNewWheelTitle`. `PATCH
 * /wheels/{shareId}` updates title *and* `suggestionsOpen` (design doc section
 * 6), so it routinely receives a body with no `title` in it — an editor hitting
 * the suggestions kill switch sends `{ suggestionsOpen: false }` and nothing
 * else. Were absent to mean `DEFAULT_TITLE`, closing suggestions on a brigaded
 * wheel would silently rename it, which is the same data loss this function
 * rejects an empty string to prevent.
 *
 * A PATCH handler should therefore only call this when the key is present:
 * `if ('title' in body) patch.title = validateTitle(body.title)`.
 */
export function validateTitle(raw: unknown): string {
  return validateText(raw, TITLE_FIELD)
}

/**
 * The stored form of a title for a wheel being created, defaulting when absent.
 *
 * `undefined` and `null` mean "not supplied", which is what lets `POST
 * /api/wheels` take an optional title. Anything else, including an empty string,
 * goes through `validateTitle`.
 */
export function validateNewWheelTitle(raw: unknown): string {
  if (raw === undefined || raw === null) return DEFAULT_TITLE
  return validateTitle(raw)
}

/**
 * Reject an add that would take a wheel past the option cap.
 *
 * 409 rather than 400: the request is well-formed and would have succeeded
 * against this same wheel a moment ago. The distinct code lets the client say
 * "this wheel is full" instead of pointing at the input field.
 *
 * `current` must be the count read inside the same transaction as the write, not
 * one the client sent — two editors adding at once can otherwise both see 49.
 *
 * `adding` exists because two routes write options in bulk rather than one at a
 * time: `POST /wheels` seeds a wheel with an initial list, and `POST
 * /wheels/{shareId}/duplicate` copies a whole array (design doc section 8).
 * Both would otherwise pass a check for "may I add one more" against a count of
 * zero and then write past the cap — where the failure is Firestore rejecting an
 * oversized document as a 500, rather than the clean 409 this exists to give.
 */
export function assertOptionCapacity(current: number, adding = 1): void {
  if (current + adding > OPTIONS_MAX) {
    throw new ValidationError(
      409,
      'options_full',
      `A wheel holds at most ${OPTIONS_MAX} options, and this one has ${current}. Remove some to add more.`,
    )
  }
}

/**
 * Reject a suggestion to a wheel already holding the maximum pending ones.
 *
 * Counts pending only. Accepted suggestions are bounded by `OPTIONS_MAX` and
 * rejected ones are hard-deleted (design doc section 4), so a wheel cannot be
 * driven into a permanently closed state by a burst of spam an editor has
 * already cleared.
 */
export function assertPendingSuggestionCapacity(current: number): void {
  if (current >= PENDING_SUGGESTIONS_MAX) {
    throw new ValidationError(
      409,
      'suggestions_full',
      `This wheel has the maximum of ${PENDING_SUGGESTIONS_MAX} suggestions waiting. Ask the organiser to clear some.`,
    )
  }
}
