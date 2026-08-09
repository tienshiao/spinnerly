import { describe, expect, it } from 'vitest'

import { isShareId, isSuggestionId, SUGGESTIONS, WHEELS } from './model'

/**
 * The ID guards, tested against the shapes that make them load-bearing rather
 * than cosmetic.
 *
 * Both `db.doc(path)` and `collection.doc(id)` treat a slash as a path
 * separator, so an ID that reaches Firestore unvalidated is a traversal
 * primitive: design doc section 6's rule that a caller must never be able to
 * name which document is checked is enforced here and nowhere else in the
 * stack. Most of the cases below are that one idea from different angles.
 */

const VALID = 'aBcDeFgHiJkLmNoPqRsT'

describe('isShareId', () => {
  it('accepts a Firestore auto-ID', () => {
    expect(VALID).toHaveLength(20)
    expect(isShareId(VALID)).toBe(true)
  })

  it.each([
    { label: 'a path separator', value: 'aBcDeFgHiJ/kLmNoPqRsT' },
    { label: 'a parent traversal', value: '../../wheelSecrets/xx' },
    { label: 'a whole document path', value: 'wheels/aBcDeFgHiJkLmNoP' },
    { label: 'a leading slash', value: '/aBcDeFgHiJkLmNoPqRs' },
    { label: 'one character short', value: VALID.slice(1) },
    { label: 'one character long', value: `${VALID}x` },
    { label: 'a hyphen', value: `${VALID.slice(1)}-` },
    { label: 'an underscore', value: `${VALID.slice(1)}_` },
    { label: 'a dot', value: `${VALID.slice(1)}.` },
    { label: 'a percent escape', value: `${VALID.slice(3)}%2F` },
    {
      label: 'a null byte',
      value: `${VALID.slice(1)}${String.fromCodePoint(0)}`,
    },
    { label: 'a trailing newline', value: `${VALID.slice(1)}\n` },
    { label: 'a non-ASCII digit', value: `${VALID.slice(1)}٣` },
    { label: 'the empty string', value: '' },
  ])('rejects $label', ({ value }) => {
    expect(isShareId(value), `${JSON.stringify(value)} was accepted`).toBe(
      false,
    )
  })

  /**
   * A newline is the reason the regex is anchored with `^`/`$` rather than
   * `\A`/`\z` semantics being assumed. JavaScript's `$` matches before a
   * trailing newline only under the `m` flag, which this regex does not set —
   * but that is a property worth an assertion rather than a reading of the
   * source, since adding `m` for an unrelated reason would silently open it.
   */
  it('rejects a valid ID with a newline appended', () => {
    expect(isShareId(`${VALID}\n`)).toBe(false)
  })

  it.each([
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'a number', value: 12_345_678_901_234 },
    { label: 'an array of one string', value: [VALID] },
    { label: 'an object with a toString', value: { toString: () => VALID } },
  ])('rejects $label without coercing it', ({ value }) => {
    expect(isShareId(value)).toBe(false)
  })
})

describe('isSuggestionId', () => {
  it('accepts a Firestore auto-ID', () => {
    expect(isSuggestionId(VALID)).toBe(true)
  })

  it('rejects a path separator, for the same reason as a share ID', () => {
    expect(isSuggestionId('../../../wheels/xx')).toBe(false)
  })

  /**
   * The two guards are the same shape today. Asserted rather than assumed,
   * because they are separate functions precisely so one can change without
   * the other — and a change that made them disagree should fail here rather
   * than be discovered by a path that no longer resolves.
   */
  it.each([
    { label: 'a valid ID', value: VALID },
    { label: 'a traversal', value: '../wheelSecrets/aa' },
    { label: 'the empty string', value: '' },
    { label: 'a number', value: 1 },
  ])('agrees with isShareId on $label', ({ value }) => {
    expect(isSuggestionId(value)).toBe(isShareId(value))
  })
})

describe('collection names', () => {
  /**
   * These strings are the contract between the Admin SDK writes and the browser
   * listeners. A disagreement is not an error anywhere — it is a listener on a
   * collection nobody writes, which looks exactly like a wheel that never
   * updates.
   */
  it('are the paths the security rules and the TTL policy name', () => {
    expect(WHEELS).toBe('wheels')
    expect(SUGGESTIONS).toBe('suggestions')
  })
})
