import { describe, expect, it } from 'vitest'

import {
  assertOptionCapacity,
  assertPendingSuggestionCapacity,
  countCharacters,
  DEFAULT_TITLE,
  OPTION_LABEL_MAX,
  OPTIONS_MAX,
  PENDING_SUGGESTIONS_MAX,
  SUGGESTION_LABEL_MAX,
  TITLE_MAX,
  validateNewWheelTitle,
  validateOptionLabel,
  validateSuggestionLabel,
  validateTitle,
  ValidationError,
} from './validation'

/**
 * Unit tests for the shared caps and validators. No Firestore and no emulator —
 * the module is pure computation over strings on purpose, which is what lets
 * these run on a bare `npm install`.
 *
 * Characters that would be invisible in source are built with `fromCodePoint`
 * rather than pasted in. A literal control character in a test file is something
 * no reviewer can see and any editor is free to eat, which would turn a real
 * assertion into one that silently tests nothing.
 */

const CHAR = {
  nul: String.fromCodePoint(0x00),
  bell: String.fromCodePoint(0x07),
  del: String.fromCodePoint(0x7f),
  c1: String.fromCodePoint(0x9f),
  /** RIGHT-TO-LEFT OVERRIDE — reorders what follows it when rendered. */
  rlo: String.fromCodePoint(0x202e),
  /** RIGHT-TO-LEFT ISOLATE. */
  rli: String.fromCodePoint(0x2067),
  zwsp: String.fromCodePoint(0x200b),
  /** ZERO WIDTH JOINER — legitimate, must survive. */
  zwj: String.fromCodePoint(0x200d),
  nbsp: String.fromCodePoint(0xa0),
  combiningAcute: String.fromCodePoint(0x0301),
  /** GRINNING FACE. One code point, two UTF-16 units. */
  emoji: String.fromCodePoint(0x1f600),
}

/** The status and code a validator rejected with, or null if it returned. */
function refusal(run: () => unknown): { status: number; code: string } | null {
  try {
    run()
    return null
  } catch (error) {
    expect(
      error,
      `expected a ValidationError, got ${String(error)}`,
    ).toBeInstanceOf(ValidationError)
    const validationError = error as ValidationError
    return { status: validationError.status, code: validationError.code }
  }
}

const TOO_LONG = { status: 400, code: 'label_too_long' }
const EMPTY_LABEL = { status: 400, code: 'empty_label' }
const INVALID_LABEL = { status: 400, code: 'invalid_label' }

describe('the caps', () => {
  // Design doc sections 4 and 7 name these numbers. The test exists so that
  // changing one is a deliberate act with a visible diff rather than a tweak,
  // because with rate limiting deferred out of v1 these caps are the only thing
  // bounding what a single scraped share URL can cost.
  it('are the numbers the design doc gives', () => {
    expect(OPTION_LABEL_MAX).toBe(60)
    expect(SUGGESTION_LABEL_MAX).toBe(60)
    expect(OPTIONS_MAX).toBe(50)
    expect(PENDING_SUGGESTIONS_MAX).toBe(200)
  })

  it('holds a suggestion to the same length as an option', () => {
    // Accepting a suggestion copies it into `options`. If a suggestion could be
    // longer, accepting one would be a write the option endpoint would refuse.
    expect(SUGGESTION_LABEL_MAX).toBe(OPTION_LABEL_MAX)
  })
})

describe('ValidationError', () => {
  it('serialises to the error body shape routes return', async () => {
    const error = new ValidationError(409, 'options_full', 'No more room.')
    const response = error.toResponse()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'options_full',
      message: 'No more room.',
    })
  })
})

describe('validateOptionLabel', () => {
  it('returns the label unchanged when it needs no cleaning', () => {
    expect(validateOptionLabel('Tacos')).toBe('Tacos')
  })

  it.each([
    { label: 'leading and trailing spaces', raw: '   Tacos   ', want: 'Tacos' },
    { label: 'a tab run', raw: 'Taco\t\tBell', want: 'Taco Bell' },
    { label: 'newlines', raw: 'Taco\nBell', want: 'Taco Bell' },
    { label: 'a carriage return', raw: 'Taco\r\nBell', want: 'Taco Bell' },
    {
      label: 'non-breaking spaces',
      raw: `Taco${CHAR.nbsp}${CHAR.nbsp}Bell`,
      want: 'Taco Bell',
    },
    {
      label: 'zero-width spaces',
      raw: `${CHAR.zwsp}Taco${CHAR.zwsp}Bell${CHAR.zwsp}`,
      want: 'Taco Bell',
    },
  ])('normalises $label', ({ raw, want }) => {
    expect(validateOptionLabel(raw)).toBe(want)
  })

  it('composes decomposed characters to NFC', () => {
    // Typed on a Mac, `é` can arrive as `e` plus a combining acute. Storing both
    // encodings would make two identical-looking options that never dedupe, and
    // would charge the decomposed one double against the cap.
    const decomposed = `Caf${'e'}${CHAR.combiningAcute}`
    expect(validateOptionLabel(decomposed)).toBe('Café')
    expect([...validateOptionLabel(decomposed)]).toHaveLength(4)
  })

  it('leaves a zero-width joiner alone', () => {
    // ZWJ is invisible but load-bearing: it is what holds a multi-person emoji
    // together. Collapsing it the way ZWSP is collapsed would corrupt the label.
    const joined = `${CHAR.emoji}${CHAR.zwj}${CHAR.emoji}`
    expect(validateOptionLabel(joined)).toBe(joined)
  })

  it.each([
    { label: 'an empty string', raw: '' },
    { label: 'only spaces', raw: '     ' },
    { label: 'only a tab', raw: '\t' },
    { label: 'only a newline', raw: '\n' },
    { label: 'only non-breaking spaces', raw: CHAR.nbsp.repeat(4) },
    { label: 'only zero-width spaces', raw: CHAR.zwsp.repeat(4) },
  ])('rejects $label as empty', ({ raw }) => {
    expect(refusal(() => validateOptionLabel(raw))).toEqual(EMPTY_LABEL)
  })

  it.each([
    { label: 'a NUL', raw: `Ta${CHAR.nul}cos` },
    { label: 'a BEL', raw: `Ta${CHAR.bell}cos` },
    { label: 'a DEL', raw: `Ta${CHAR.del}cos` },
    { label: 'a C1 control', raw: `Ta${CHAR.c1}cos` },
    { label: 'a bidi override', raw: `Ta${CHAR.rlo}cos` },
    { label: 'a bidi isolate', raw: `Ta${CHAR.rli}cos` },
  ])('rejects $label', ({ raw }) => {
    expect(refusal(() => validateOptionLabel(raw))).toEqual(INVALID_LABEL)
  })

  it.each([
    { label: 'a number', raw: 42 },
    { label: 'a boolean', raw: true },
    { label: 'an object', raw: { label: 'Tacos' } },
    { label: 'an array', raw: ['Tacos'] },
    { label: 'undefined', raw: undefined },
    { label: 'null', raw: null },
  ])('rejects $label as not text', ({ raw }) => {
    expect(refusal(() => validateOptionLabel(raw))).toEqual(INVALID_LABEL)
  })

  it('accepts a label exactly at the cap', () => {
    const atCap = 'x'.repeat(OPTION_LABEL_MAX)
    expect(validateOptionLabel(atCap)).toBe(atCap)
  })

  it('rejects a label one character past the cap', () => {
    expect(
      refusal(() => validateOptionLabel('x'.repeat(OPTION_LABEL_MAX + 1))),
    ).toEqual(TOO_LONG)
  })

  it('names the limit in the message', () => {
    // The client renders this verbatim; "too long" alone gives the user nothing
    // to correct towards.
    try {
      validateOptionLabel('x'.repeat(OPTION_LABEL_MAX + 1))
      expect.unreachable('expected a ValidationError')
    } catch (error) {
      expect((error as ValidationError).message).toContain(
        String(OPTION_LABEL_MAX),
      )
    }
  })

  it('counts code points, not UTF-16 units', () => {
    // Every emoji here is one code point and two UTF-16 units, so `.length`
    // would see twice the cap and reject a label that is exactly at it.
    const atCap = CHAR.emoji.repeat(OPTION_LABEL_MAX)
    expect(atCap.length, 'the UTF-16 length is double, by construction').toBe(
      OPTION_LABEL_MAX * 2,
    )
    expect(validateOptionLabel(atCap)).toBe(atCap)
    expect(
      refusal(() =>
        validateOptionLabel(CHAR.emoji.repeat(OPTION_LABEL_MAX + 1)),
      ),
    ).toEqual(TOO_LONG)
  })

  it('measures after normalising, not before', () => {
    // Collapsing runs of whitespace can bring an over-length label under the
    // cap. Measuring first would reject a label that is about to be fine.
    const padded = `${' '.repeat(40)}Tacos${' '.repeat(40)}`
    expect(padded.length).toBeGreaterThan(OPTION_LABEL_MAX)
    expect(validateOptionLabel(padded)).toBe('Tacos')
  })
})

describe('validateSuggestionLabel', () => {
  it('applies the same cleaning as an option label', () => {
    expect(validateSuggestionLabel('  Taco\tBell  ')).toBe('Taco Bell')
  })

  it('accepts a label exactly at the cap', () => {
    const atCap = 'x'.repeat(SUGGESTION_LABEL_MAX)
    expect(validateSuggestionLabel(atCap)).toBe(atCap)
  })

  it('rejects a label one character past the cap', () => {
    expect(
      refusal(() =>
        validateSuggestionLabel('x'.repeat(SUGGESTION_LABEL_MAX + 1)),
      ),
    ).toEqual(TOO_LONG)
  })

  it.each([
    { label: 'an empty string', raw: '', want: EMPTY_LABEL },
    { label: 'only whitespace', raw: '  \t ', want: EMPTY_LABEL },
    {
      label: 'a control character',
      raw: `Ta${CHAR.nul}cos`,
      want: INVALID_LABEL,
    },
    { label: 'a bidi override', raw: `Ta${CHAR.rlo}cos`, want: INVALID_LABEL },
    { label: 'a number', raw: 42, want: INVALID_LABEL },
  ])('rejects $label', ({ raw, want }) => {
    expect(refusal(() => validateSuggestionLabel(raw))).toEqual(want)
  })
})

describe('validateTitle', () => {
  it('cleans a supplied title', () => {
    expect(validateTitle('  Lunch\n\nFriday  ')).toBe('Lunch Friday')
  })

  it.each([
    { label: 'undefined', raw: undefined },
    { label: 'null', raw: null },
  ])('rejects $label rather than defaulting', ({ raw }) => {
    // PATCH /wheels/{shareId} updates title AND suggestionsOpen, so it
    // routinely gets a body with no title in it — an editor hitting the
    // suggestions kill switch sends `{ suggestionsOpen: false }` and nothing
    // else. If absent meant DEFAULT_TITLE, closing suggestions on a brigaded
    // wheel would silently rename it. Defaulting is validateNewWheelTitle's job
    // and creation's alone.
    expect(refusal(() => validateTitle(raw))).toEqual({
      status: 400,
      code: 'invalid_title',
    })
  })

  it.each([
    { label: 'an empty string', raw: '' },
    { label: 'only whitespace', raw: '   ' },
  ])('rejects $label', ({ raw }) => {
    expect(refusal(() => validateTitle(raw))).toEqual({
      status: 400,
      code: 'empty_title',
    })
  })

  it.each([
    { label: 'a control character', raw: `Lunch${CHAR.bell}` },
    { label: 'a bidi override', raw: `Lunch${CHAR.rlo}` },
    { label: 'a number', raw: 42 },
  ])('rejects $label', ({ raw }) => {
    expect(refusal(() => validateTitle(raw))).toEqual({
      status: 400,
      code: 'invalid_title',
    })
  })

  it('accepts a title exactly at the cap', () => {
    const atCap = 'x'.repeat(TITLE_MAX)
    expect(validateTitle(atCap)).toBe(atCap)
  })

  it('rejects a title one character past the cap', () => {
    expect(refusal(() => validateTitle('x'.repeat(TITLE_MAX + 1)))).toEqual({
      status: 400,
      code: 'title_too_long',
    })
  })
})

describe('validateNewWheelTitle', () => {
  it.each([
    { label: 'undefined', raw: undefined },
    { label: 'null', raw: null },
  ])('defaults when the title is $label', ({ raw }) => {
    expect(validateNewWheelTitle(raw)).toBe(DEFAULT_TITLE)
  })

  it('validates a supplied title exactly as validateTitle does', () => {
    expect(validateNewWheelTitle('  Lunch\tFriday ')).toBe('Lunch Friday')
    expect(refusal(() => validateNewWheelTitle(''))).toEqual({
      status: 400,
      code: 'empty_title',
    })
    expect(
      refusal(() => validateNewWheelTitle('x'.repeat(TITLE_MAX + 1))),
    ).toEqual({ status: 400, code: 'title_too_long' })
  })

  it('defaults only for an absent title, never for a blank one', () => {
    // The distinction is the point of having two functions: creation may omit a
    // title, but nobody may store one that renders as nothing.
    expect(refusal(() => validateNewWheelTitle('   '))?.code).toBe(
      'empty_title',
    )
  })
})

describe('invisible labels', () => {
  // A length check alone does not make a label non-empty. Each of these is
  // several characters long and renders as nothing, which would put a blank
  // segment on the wheel that nobody can select, explain or tell apart from its
  // neighbour. Matched by neither `\s`, `\p{Cc}` nor `\p{Bidi_Control}`, so the
  // guard for them is the "at least one visible character" rule.
  it.each([
    { label: 'word joiners', codePoint: 0x2060 },
    { label: 'soft hyphens', codePoint: 0x00ad },
    { label: 'Hangul fillers', codePoint: 0x3164 },
    { label: 'Hangul choseong fillers', codePoint: 0x115f },
    { label: 'Hangul jungseong fillers', codePoint: 0x1160 },
    { label: 'halfwidth Hangul fillers', codePoint: 0xffa0 },
    { label: 'zero-width non-joiners', codePoint: 0x200c },
    { label: 'zero-width joiners', codePoint: 0x200d },
    { label: 'zero-width spaces', codePoint: 0x200b },
  ])('rejects an option of nothing but $label', ({ codePoint }) => {
    const invisible = String.fromCodePoint(codePoint).repeat(5)
    expect(invisible.length, 'is not the empty string').toBeGreaterThan(0)
    expect(refusal(() => validateOptionLabel(invisible))).toEqual(EMPTY_LABEL)
  })

  it('rejects a mix of invisible characters', () => {
    const invisible = [0x2060, 0x00ad, 0x3164, 0x200c, 0x200b]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join('')
    expect(refusal(() => validateOptionLabel(invisible))).toEqual(EMPTY_LABEL)
  })

  it('rejects an invisible suggestion and an invisible title too', () => {
    const invisible = String.fromCodePoint(0x2060).repeat(5)
    expect(refusal(() => validateSuggestionLabel(invisible))).toEqual(
      EMPTY_LABEL,
    )
    expect(refusal(() => validateTitle(invisible))).toEqual({
      status: 400,
      code: 'empty_title',
    })
  })

  it('leaves invisible characters alone inside a visible label', () => {
    // Only whole-label emptiness is refused. Stripping the class would break
    // correct text: ZWJ holds a multi-person emoji together, ZWNJ is required in
    // Persian and several Indic scripts, and the tag characters below are how
    // the England flag emoji is encoded.
    const joined = `${CHAR.emoji}${CHAR.zwj}${CHAR.emoji}`
    expect(validateOptionLabel(joined)).toBe(joined)

    const englandFlag = [
      0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f,
    ]
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join('')
    expect(validateOptionLabel(englandFlag)).toBe(englandFlag)
  })
})

describe('the guard on unread input', () => {
  // Route handlers read the body with `request.json()`, which has no size limit
  // of its own. Normalising allocates several copies of the string, so an
  // absurdly long one is refused before any of that happens.
  it.each([
    {
      label: 'an option',
      run: (raw: string) => () => validateOptionLabel(raw),
    },
    {
      label: 'a suggestion',
      run: (raw: string) => () => validateSuggestionLabel(raw),
    },
    { label: 'a title', run: (raw: string) => () => validateTitle(raw) },
  ])('refuses a megabyte-scale $label', ({ run }) => {
    const refused = refusal(run('x'.repeat(1_000_000)))
    expect(refused?.status).toBe(400)
  })

  it('reports the same code as an ordinary over-length label', () => {
    // A distinct code would tell a prober exactly which requests were refused
    // unread, which is the one thing they could not otherwise measure.
    expect(refusal(() => validateOptionLabel('x'.repeat(1_000_000)))).toEqual(
      TOO_LONG,
    )
  })

  it('does not refuse a label that is merely padded', () => {
    // The guard runs on UTF-16 units before normalisation, so it has to leave
    // room for astral characters and for whitespace that collapses away.
    const padded = `${' '.repeat(200)}${CHAR.emoji.repeat(60)}${' '.repeat(200)}`
    expect(validateOptionLabel(padded)).toBe(CHAR.emoji.repeat(60))
  })
})

describe('countCharacters', () => {
  // Exported so the editor's character counter measures a label the same way the
  // server does. Built from `value.length` instead, it would block submissions
  // the server would have accepted.
  it.each([
    { label: 'ASCII', value: 'Tacos', want: 5 },
    { label: 'an astral emoji', value: CHAR.emoji, want: 1 },
    { label: 'a precomposed accent', value: 'Café', want: 4 },
  ])('counts $label in code points', ({ value, want }) => {
    expect(countCharacters(value)).toBe(want)
  })

  it('disagrees with String.length exactly where the cap depends on it', () => {
    const emoji = CHAR.emoji.repeat(OPTION_LABEL_MAX)
    expect(emoji.length).toBe(OPTION_LABEL_MAX * 2)
    expect(countCharacters(emoji)).toBe(OPTION_LABEL_MAX)
  })
})

describe('assertOptionCapacity', () => {
  it.each([
    { label: 'an empty wheel', current: 0 },
    { label: 'one below the cap', current: OPTIONS_MAX - 1 },
  ])('allows an add against $label', ({ current }) => {
    expect(refusal(() => assertOptionCapacity(current))).toBeNull()
  })

  it.each([
    { label: 'exactly at the cap', current: OPTIONS_MAX },
    { label: 'one past the cap', current: OPTIONS_MAX + 1 },
  ])('refuses an add against a wheel $label', ({ current }) => {
    // 409, not 400: the request is well-formed and would have worked against
    // this same wheel a moment ago. The distinct code lets the client say "this
    // wheel is full" rather than pointing at the input field.
    expect(refusal(() => assertOptionCapacity(current))).toEqual({
      status: 409,
      code: 'options_full',
    })
  })

  it('names the limit in the message', () => {
    try {
      assertOptionCapacity(OPTIONS_MAX)
      expect.unreachable('expected a ValidationError')
    } catch (error) {
      expect((error as ValidationError).message).toContain(String(OPTIONS_MAX))
    }
  })

  // POST /wheels seeds a wheel with an initial list and POST
  // /wheels/{shareId}/duplicate copies a whole array, so both ask about more
  // than one option at a time. Checking "may I add one more" against a count of
  // zero would pass and then write past the cap, where the failure is Firestore
  // rejecting an oversized document as a 500 rather than a clean 409.
  it.each([
    {
      label: 'a bulk add that exactly fills the wheel',
      current: 0,
      adding: OPTIONS_MAX,
    },
    { label: 'a bulk add into a partly full wheel', current: 20, adding: 30 },
    { label: 'a duplicate of a full wheel', current: 0, adding: OPTIONS_MAX },
  ])('allows $label', ({ current, adding }) => {
    expect(refusal(() => assertOptionCapacity(current, adding))).toBeNull()
  })

  it.each([
    { label: 'one option past', current: 0, adding: OPTIONS_MAX + 1 },
    { label: 'far past', current: 0, adding: 500 },
    { label: 'past from a partly full wheel', current: 20, adding: 31 },
    { label: 'past from a full wheel', current: OPTIONS_MAX, adding: 1 },
  ])('refuses a bulk add that lands $label the cap', ({ current, adding }) => {
    expect(refusal(() => assertOptionCapacity(current, adding))).toEqual({
      status: 409,
      code: 'options_full',
    })
  })

  it('allows adding nothing to a full wheel', () => {
    // Degenerate but reachable: duplicating a wheel that has no options.
    expect(refusal(() => assertOptionCapacity(OPTIONS_MAX, 0))).toBeNull()
  })
})

describe('assertPendingSuggestionCapacity', () => {
  it.each([
    { label: 'no pending suggestions', current: 0 },
    { label: 'one below the cap', current: PENDING_SUGGESTIONS_MAX - 1 },
  ])('allows a submission with $label', ({ current }) => {
    expect(refusal(() => assertPendingSuggestionCapacity(current))).toBeNull()
  })

  it.each([
    { label: 'exactly at the cap', current: PENDING_SUGGESTIONS_MAX },
    { label: 'one past the cap', current: PENDING_SUGGESTIONS_MAX + 1 },
  ])('refuses a submission at $label', ({ current }) => {
    expect(refusal(() => assertPendingSuggestionCapacity(current))).toEqual({
      status: 409,
      code: 'suggestions_full',
    })
  })

  it('is distinguishable from the option cap', () => {
    // Two different things are full and the client shows different copy for
    // each — one is addressed to an editor, the other to a participant who
    // cannot clear the queue themselves.
    const options = refusal(() => assertOptionCapacity(OPTIONS_MAX))
    const suggestions = refusal(() =>
      assertPendingSuggestionCapacity(PENDING_SUGGESTIONS_MAX),
    )
    expect(options?.code).not.toBe(suggestions?.code)
  })

  it('names the limit in the message', () => {
    try {
      assertPendingSuggestionCapacity(PENDING_SUGGESTIONS_MAX)
      expect.unreachable('expected a ValidationError')
    } catch (error) {
      expect((error as ValidationError).message).toContain(
        String(PENDING_SUGGESTIONS_MAX),
      )
    }
  })
})
