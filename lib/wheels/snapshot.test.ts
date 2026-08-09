import { describe, expect, it } from 'vitest'

import {
  bySubmissionOrder,
  decodeSuggestion,
  decodeWheel,
  isSuggestionStatus,
} from './snapshot'
import type { Suggestion } from './model'
import { DEFAULT_TITLE } from './validation'

/**
 * Decoding, tested mostly on documents that should not exist.
 *
 * The happy path here is two lines; everything else is malformed input, because
 * the property this module actually promises is that it never throws. These
 * functions run inside an `onSnapshot` callback, where an exception escapes
 * into the SDK, leaves the listener in an undefined state, and shows up as a
 * page that silently stops updating. So every case below asserts a usable value
 * came back rather than asserting a particular error.
 *
 * `stamp` fakes a Firestore `Timestamp` by its `toDate` method alone, which is
 * exactly the contract `toDate` duck-types against — a real `Timestamp` import
 * would test the SDK rather than the decoder.
 */

const stamp = (iso: string) => ({ toDate: () => new Date(iso) })

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const CREATED = '2026-08-01T10:00:00.000Z'

function wheelDocument(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Lunch Friday',
    options: [
      {
        id: 'option-1',
        label: 'Tacos',
        addedAt: stamp(CREATED),
        fromSuggestion: null,
      },
    ],
    suggestionsOpen: true,
    createdAt: stamp(CREATED),
    updatedAt: stamp(CREATED),
    expiresAt: stamp('2026-08-31T10:00:00.000Z'),
    ...overrides,
  }
}

describe('decodeWheel', () => {
  it('decodes a well-formed document', () => {
    const wheel = decodeWheel(SHARE_ID, wheelDocument())

    expect(wheel.shareId).toBe(SHARE_ID)
    expect(wheel.title).toBe('Lunch Friday')
    expect(wheel.suggestionsOpen).toBe(true)
    expect(wheel.createdAt?.toISOString()).toBe(CREATED)
    expect(wheel.options).toEqual([
      {
        id: 'option-1',
        label: 'Tacos',
        addedAt: new Date(CREATED),
        fromSuggestion: null,
      },
    ])
  })

  it('carries the share ID through, since it is not a stored field', () => {
    expect(decodeWheel(SHARE_ID, { shareId: 'something-else' }).shareId).toBe(
      SHARE_ID,
    )
  })

  /**
   * The whole point of the module, stated once as a property rather than
   * implied by the cases below it.
   */
  it.each([
    { label: 'undefined', data: undefined },
    { label: 'null', data: null },
    { label: 'a string', data: 'not a document' },
    { label: 'a number', data: 7 },
    { label: 'an array', data: [1, 2, 3] },
    { label: 'an empty object', data: {} },
    { label: 'every field of the wrong type', data: wrongTypes() },
  ])('does not throw on $label', ({ data }) => {
    expect(() => decodeWheel(SHARE_ID, data)).not.toThrow()
  })

  it('falls back to the create route’s default title', () => {
    expect(
      decodeWheel(SHARE_ID, wheelDocument({ title: undefined })).title,
    ).toBe(DEFAULT_TITLE)
    expect(decodeWheel(SHARE_ID, wheelDocument({ title: 42 })).title).toBe(
      DEFAULT_TITLE,
    )
  })

  it('keeps an empty title, which is a value rather than an absence', () => {
    expect(decodeWheel(SHARE_ID, wheelDocument({ title: '' })).title).toBe('')
  })

  /**
   * Mirrors `submitSuggestion`, which refuses unless the stored value is
   * literally `true`. Any looser reading here would put a suggestion form in
   * front of a participant whose submission the server is going to refuse.
   */
  it.each([
    { label: 'true', value: true, expected: true },
    { label: 'false', value: false, expected: false },
    { label: 'absent', value: undefined, expected: false },
    { label: 'null', value: null, expected: false },
    { label: 'the string "true"', value: 'true', expected: false },
    { label: 'the number 1', value: 1, expected: false },
  ])('reads suggestionsOpen $label as $expected', ({ value, expected }) => {
    expect(
      decodeWheel(SHARE_ID, wheelDocument({ suggestionsOpen: value }))
        .suggestionsOpen,
    ).toBe(expected)
  })

  it.each([
    { label: 'absent', value: undefined },
    { label: 'not an array', value: { '0': { id: 'a', label: 'b' } } },
    { label: 'a string', value: 'Tacos' },
  ])('reads options $label as an empty list', ({ value }) => {
    expect(
      decodeWheel(SHARE_ID, wheelDocument({ options: value })).options,
    ).toEqual([])
  })

  describe('option elements', () => {
    const decode = (option: unknown) =>
      decodeWheel(SHARE_ID, wheelDocument({ options: [option] })).options

    /**
     * The one place a stored value is discarded rather than defaulted, and it
     * is discarded because there is no honest fallback: an option with no ID
     * cannot be removed through the API and one with no label would put a word
     * on the wheel that nobody wrote.
     */
    it.each([
      { label: 'no id', option: { label: 'Tacos' } },
      { label: 'a non-string id', option: { id: 7, label: 'Tacos' } },
      { label: 'no label', option: { id: 'option-1' } },
      { label: 'a non-string label', option: { id: 'option-1', label: [] } },
      { label: 'not an object at all', option: 'Tacos' },
      { label: 'null', option: null },
    ])('drops an option with $label', ({ option }) => {
      expect(decode(option)).toEqual([])
    })

    it.each([
      { label: 'a missing addedAt', option: { id: 'a', label: 'Tacos' } },
      {
        label: 'an unusable addedAt',
        option: { id: 'a', label: 'Tacos', addedAt: 'yesterday' },
      },
      {
        label: 'a non-string fromSuggestion',
        option: { id: 'a', label: 'Tacos', fromSuggestion: 5 },
      },
    ])('keeps an option with $label', ({ option }) => {
      expect(decode(option)).toHaveLength(1)
    })

    it('preserves fromSuggestion, which the accept path keys on', () => {
      expect(
        decode({ id: 'a', label: 'Tacos', fromSuggestion: 'sug-1' })[0]
          .fromSuggestion,
      ).toBe('sug-1')
    })

    it('keeps duplicate IDs rather than silently merging them', () => {
      const options = decodeWheel(
        SHARE_ID,
        wheelDocument({
          options: [
            { id: 'same', label: 'Tacos' },
            { id: 'same', label: 'Pizza' },
          ],
        }),
      ).options

      expect(options.map((option) => option.label)).toEqual(['Tacos', 'Pizza'])
    })
  })

  describe('timestamps', () => {
    it.each([
      { label: 'a Timestamp', value: stamp(CREATED), expected: CREATED },
      { label: 'a Date', value: new Date(CREATED), expected: CREATED },
    ])('reads $label', ({ value, expected }) => {
      expect(
        decodeWheel(
          SHARE_ID,
          wheelDocument({ createdAt: value }),
        ).createdAt?.toISOString(),
      ).toBe(expected)
    })

    it.each([
      { label: 'absent', value: undefined },
      { label: 'null', value: null },
      { label: 'an ISO string', value: CREATED },
      { label: 'epoch milliseconds', value: 1_754_042_400_000 },
      { label: 'an Invalid Date', value: new Date('nonsense') },
      {
        label: 'a toDate that returns a string',
        value: { toDate: () => CREATED },
      },
      {
        label: 'a toDate that returns an Invalid Date',
        value: { toDate: () => new Date('nonsense') },
      },
      {
        label: 'a toDate that throws',
        value: {
          toDate: () => {
            throw new Error('not a timestamp')
          },
        },
      },
      { label: 'a toDate that is not a function', value: { toDate: 'soon' } },
    ])('reads $label as null', ({ value }) => {
      expect(
        decodeWheel(SHARE_ID, wheelDocument({ createdAt: value })).createdAt,
      ).toBeNull()
    })

    /**
     * An Invalid Date renders as the literal text "Invalid Date" wherever a
     * component interpolates it, and it is not caught by a null check. Null is
     * the value a caller can actually branch on.
     */
    it('never returns a Date whose time is NaN', () => {
      const wheel = decodeWheel(
        SHARE_ID,
        wheelDocument({
          createdAt: new Date('nonsense'),
          updatedAt: { toDate: () => new Date('nonsense') },
          expiresAt: 'soon',
        }),
      )

      for (const value of [wheel.createdAt, wheel.updatedAt, wheel.expiresAt]) {
        expect(value).toBeNull()
      }
    })
  })
})

describe('decodeSuggestion', () => {
  it('decodes a well-formed document', () => {
    expect(
      decodeSuggestion('sug-1', {
        label: 'Ramen',
        status: 'pending',
        createdAt: stamp(CREATED),
        expiresAt: stamp(CREATED),
      }),
    ).toEqual({
      id: 'sug-1',
      label: 'Ramen',
      status: 'pending',
      createdAt: new Date(CREATED),
      expiresAt: new Date(CREATED),
    })
  })

  it.each([
    { label: 'undefined', data: undefined },
    { label: 'null', data: null },
    { label: 'an empty object', data: {} },
    { label: 'a string', data: 'Ramen' },
  ])('does not throw on $label', ({ data }) => {
    expect(() => decodeSuggestion('sug-1', data)).not.toThrow()
  })

  /**
   * Unrecognised statuses read as pending, and the direction matters: a pending
   * row has two actions that clear it, while one reading `accepted` sits in the
   * queue with nothing an editor can do about it.
   */
  it.each([
    { label: 'accepted', value: 'accepted', expected: 'accepted' },
    { label: 'pending', value: 'pending', expected: 'pending' },
    {
      label: 'rejected — a value the model does not have',
      value: 'rejected',
      expected: 'pending',
    },
    { label: 'absent', value: undefined, expected: 'pending' },
    {
      label: 'ACCEPTED in the wrong case',
      value: 'ACCEPTED',
      expected: 'pending',
    },
    { label: 'true', value: true, expected: 'pending' },
  ])('reads status $label as $expected', ({ value, expected }) => {
    expect(decodeSuggestion('sug-1', { status: value }).status).toBe(expected)
  })

  it('reads a missing label as empty rather than dropping the row', () => {
    // Unlike an option, a suggestion has no ID minted by us to lose — the
    // document ID is the key — so a labelless row is still actionable, and an
    // editor can reject it. Dropping it would leave something in the database
    // that nobody can see or clear.
    expect(decodeSuggestion('sug-1', { label: 42 }).label).toBe('')
  })
})

describe('isSuggestionStatus', () => {
  it.each([
    { label: 'pending', value: 'pending', expected: true },
    { label: 'accepted', value: 'accepted', expected: true },
    { label: 'rejected', value: 'rejected', expected: false },
    { label: 'undefined', value: undefined, expected: false },
    { label: 'an object', value: { status: 'pending' }, expected: false },
  ])('reads $label as $expected', ({ value, expected }) => {
    expect(isSuggestionStatus(value)).toBe(expected)
  })
})

describe('bySubmissionOrder', () => {
  const at = (id: string, iso: string | null): Suggestion => ({
    id,
    label: id,
    status: 'pending',
    createdAt: iso === null ? null : new Date(iso),
    expiresAt: null,
  })

  it('puts the oldest first', () => {
    const sorted = [
      at('c', '2026-08-03T00:00:00.000Z'),
      at('a', '2026-08-01T00:00:00.000Z'),
      at('b', '2026-08-02T00:00:00.000Z'),
    ].sort(bySubmissionOrder)

    expect(sorted.map((suggestion) => suggestion.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts undateable rows last rather than losing them', () => {
    const sorted = [
      at('undated', null),
      at('a', '2026-08-01T00:00:00.000Z'),
    ].sort(bySubmissionOrder)

    expect(sorted.map((suggestion) => suggestion.id)).toEqual(['a', 'undated'])
  })

  /**
   * A comparator that returned 0 for a tie would let two rows swap places
   * whenever an unrelated snapshot re-sorted the list, which reads as the queue
   * fidgeting on its own. Both tie cases break on ID instead.
   */
  it.each([
    { label: 'identical timestamps', iso: '2026-08-01T00:00:00.000Z' },
    { label: 'two undateable rows', iso: null },
  ])('breaks a tie on $label deterministically', ({ iso }) => {
    const forwards = [at('b', iso), at('a', iso)].sort(bySubmissionOrder)
    const backwards = [at('a', iso), at('b', iso)].sort(bySubmissionOrder)

    expect(forwards.map((s) => s.id)).toEqual(['a', 'b'])
    expect(backwards.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('never returns 0, so the order is total', () => {
    const same = at('a', '2026-08-01T00:00:00.000Z')
    expect(bySubmissionOrder(same, { ...same, id: 'b' })).toBeLessThan(0)
    expect(bySubmissionOrder({ ...same, id: 'b' }, same)).toBeGreaterThan(0)
  })
})

/** Every field of a wheel document set to something it must never be. */
function wrongTypes(): Record<string, unknown> {
  return {
    title: { text: 'Lunch' },
    options: 'Tacos, Pizza',
    suggestionsOpen: 'yes',
    createdAt: 'yesterday',
    updatedAt: [],
    expiresAt: Number.NaN,
  }
}
