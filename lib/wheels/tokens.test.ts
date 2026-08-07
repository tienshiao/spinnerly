import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  editTokenMatches,
  hashEditToken,
  mintEditToken,
  readBearerToken,
} from './tokens'

/**
 * Unit tests for the edit-token primitives. No Firestore and no emulator — the
 * database-backed half of TASK-7 is covered in ./store.emulator.test.ts, which
 * runs under `npm run test:emulator`.
 */

describe('mintEditToken', () => {
  it('is URL-fragment safe', () => {
    // The token's only home is `/w/{shareId}#e={token}`. base64's `+`, `/` and
    // `=` would each need percent-encoding there.
    for (let i = 0; i < 200; i++) {
      expect(mintEditToken()).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('carries 256 bits of entropy', () => {
    // 32 bytes base64url-encodes to 43 characters with no padding.
    expect(mintEditToken()).toHaveLength(43)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, mintEditToken))
    expect(seen.size).toBe(1000)
  })

  it('takes no input, so there is nothing to derive from', () => {
    // The signature is the guarantee. Design doc section 4 rules out
    // `hash(shareId + pepper)` — one leaked pepper would mint edit rights for
    // every wheel, and rotating it would lock out every live wheel at once.
    expect(mintEditToken).toHaveLength(0)
  })
})

describe('hashEditToken', () => {
  it('is SHA-256 hex', () => {
    const token = 'a-known-token'
    expect(hashEditToken(token)).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    )
  })

  it('is 64 hex characters', () => {
    expect(hashEditToken(mintEditToken())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never returns the token it was given', () => {
    const token = mintEditToken()
    expect(hashEditToken(token)).not.toBe(token)
  })
})

describe('editTokenMatches', () => {
  it('accepts the token that produced the hash', () => {
    const token = mintEditToken()
    expect(editTokenMatches(token, hashEditToken(token))).toBe(true)
  })

  it('rejects a different token', () => {
    const token = mintEditToken()
    expect(editTokenMatches(mintEditToken(), hashEditToken(token))).toBe(false)
  })

  it('rejects a token that differs by one character', () => {
    const token = mintEditToken()
    const nudged = (token[0] === 'A' ? 'B' : 'A') + token.slice(1)
    expect(editTokenMatches(nudged, hashEditToken(token))).toBe(false)
  })

  // The regression these guard: `timingSafeEqual` throws on unequal buffer
  // lengths, so a truncated or corrupt `editTokenHash` would turn every request
  // for that wheel into a 500 instead of a denial. A plain `false` is the whole
  // point — if any of these threw, the test would fail on the throw.
  describe('rejects rather than throws on a malformed stored hash', () => {
    const token = mintEditToken()

    it.each([
      { label: 'an empty string', stored: '' },
      { label: 'a short hex string', stored: 'deadbeef' },
      {
        label: 'one character short',
        stored: hashEditToken(token).slice(0, 63),
      },
      { label: 'one character long', stored: `${hashEditToken(token)}a` },
      { label: 'the right length but not hex', stored: 'z'.repeat(64) },
      { label: 'plain prose', stored: 'not a hash at all' },
      {
        // `Buffer.from(x, 'hex')` does not reject invalid input — it decodes to
        // the first non-hex pair and returns a SHORT buffer. So a value of
        // exactly the right length can still decode to the wrong size, which is
        // why the length check is applied to the decoded buffer too.
        label: '64 characters that stop being hex after the first pair',
        stored: `zz${hashEditToken(token).slice(2)}`,
      },
    ])('$label', ({ stored }) => {
      expect(editTokenMatches(token, stored)).toBe(false)
    })
  })

  it('rejects the hash itself presented as the token', () => {
    // Someone who reads the database has hashes, not tokens. Presenting a hash
    // must not authenticate.
    const token = mintEditToken()
    const stored = hashEditToken(token)
    expect(editTokenMatches(stored, stored)).toBe(false)
  })
})

describe('readBearerToken', () => {
  it('reads the token from a well-formed header', () => {
    expect(readBearerToken('Bearer abc123')).toBe('abc123')
  })

  // RFC 7235 defines the scheme as case-insensitive, so a client sending
  // `bearer` is conforming rather than broken.
  it.each(['bearer abc', 'BEARER abc', 'BeArEr abc'])(
    'accepts the scheme as %s',
    (header) => {
      expect(readBearerToken(header)).toBe('abc')
    },
  )

  it('tolerates surrounding and internal whitespace', () => {
    expect(readBearerToken('  Bearer   abc  ')).toBe('abc')
    expect(readBearerToken('Bearer\tabc')).toBe('abc')
  })

  it.each([
    { label: 'null', header: null },
    { label: 'undefined', header: undefined },
    { label: 'an empty string', header: '' },
    { label: 'only whitespace', header: '   ' },
    { label: 'no scheme', header: 'abc123' },
    { label: 'the wrong scheme', header: 'Basic abc123' },
    { label: 'a scheme with no value', header: 'Bearer' },
    { label: 'a scheme with only whitespace', header: 'Bearer   ' },
    // No separator, so the scheme is not actually Bearer.
    { label: 'a run-on scheme', header: 'Bearerabc' },
  ])('returns null for $label', ({ header }) => {
    expect(readBearerToken(header)).toBeNull()
  })

  it('does not unwrap a token that merely contains spaces', () => {
    // Everything after the scheme is the credential. Splitting on whitespace
    // and taking [1] would silently truncate instead.
    expect(readBearerToken('Bearer abc def')).toBe('abc def')
  })
})
