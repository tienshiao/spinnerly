import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Edit-token primitives, per design doc section 6.
 *
 * Deliberately free of Firestore and of `server-only`: everything here is pure
 * computation over strings, which is what lets it be unit-tested without an
 * emulator. The parts that touch the database live in ./store.ts.
 */

/** Bytes of entropy in an edit token. 256 bits. */
const TOKEN_BYTES = 32

/** SHA-256 produces 32 bytes, so its hex encoding is always 64 characters. */
const SHA256_HEX_LENGTH = 64

/**
 * A fresh edit token.
 *
 * Two properties matter and neither is visible from the call site, so both are
 * written down here:
 *
 *  - It comes from a CSPRNG and is generated with no reference whatsoever to the
 *    shareId. Design doc section 4 rules out deriving it (`hash(shareId +
 *    pepper)` and friends): a derived token means one leaked pepper mints edit
 *    rights for every wheel that exists, and rotating the pepper locks out every
 *    live wheel at the same moment.
 *  - base64url, not base64. The token's only home is the URL fragment of the
 *    edit link (`/w/{shareId}#e={token}`), and the standard alphabet's `+`, `/`
 *    and `=` would each need percent-encoding there — which in practice means
 *    one of the two ends eventually forgets, and the token silently changes
 *    value in transit.
 */
export function mintEditToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * The stored form of an edit token. Only ever this — never the raw value.
 *
 * A plain unsalted SHA-256 is the right primitive here, which is worth
 * defending because "why is this not bcrypt/argon2/scrypt" is the obvious
 * review question. Password KDFs are slow on purpose to make guessing expensive
 * over the small space humans actually pick from. An edit token is 256 bits
 * from a CSPRNG: there is no guessable space to defend, so a work factor buys
 * nothing and costs latency on every authenticated request. A salt buys nothing
 * for the same reason — no two tokens collide and there is no dictionary to
 * precompute.
 *
 * What the hash does buy is the thing section 4 names: a database leak hands
 * over hashes, not edit rights.
 */
export function hashEditToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Whether a presented token hashes to `storedHash`, compared in constant time.
 *
 * Two failure modes are guarded here, both of which turn a security check into
 * something worse if left alone:
 *
 *  - `timingSafeEqual` THROWS on buffers of unequal length. The stored side
 *    comes out of the database, so a truncated or malformed `editTokenHash`
 *    would turn every request for that wheel into a 500 rather than a denial.
 *  - `Buffer.from(x, 'hex')` does not reject invalid input. It decodes until it
 *    hits a non-hex pair and returns what it got, so `Buffer.from('zz', 'hex')`
 *    is an empty buffer, not an error. A `try`/`catch` around it would therefore
 *    catch nothing at all.
 *
 * The explicit length check handles both, and fails closed. It leaks only
 * whether the stored value was a well-formed SHA-256 digest, which is not a
 * secret — the digest length is fixed and public.
 */
export function editTokenMatches(
  presented: string,
  storedHash: string,
): boolean {
  if (storedHash.length !== SHA256_HEX_LENGTH) return false

  const expected = Buffer.from(storedHash, 'hex')
  if (expected.length !== SHA256_HEX_LENGTH / 2) return false

  const actual = Buffer.from(hashEditToken(presented), 'hex')
  return timingSafeEqual(actual, expected)
}

/**
 * The token from an `Authorization: Bearer {token}` header, or null.
 *
 * Null covers every shape that is not a usable bearer credential — absent
 * header, wrong scheme, no value after the scheme — so the caller has one
 * branch to handle rather than several. The scheme is matched
 * case-insensitively because RFC 7235 defines it that way, and a client sending
 * `bearer` is conforming, not broken.
 *
 * Never read the token from a path segment or a query string. Both land in
 * Cloud Logging and load-balancer access logs, which is exactly the disclosure
 * design doc section 6 forbids.
 */
export function readBearerToken(
  header: string | null | undefined,
): string | null {
  if (!header) return null

  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim())
  if (!match) return null

  const token = match[1].trim()
  return token.length > 0 ? token : null
}
