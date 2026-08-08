import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { domainCheck, parseBody, readJsonObject } from './request'
import {
  validateOptionLabel,
  validateTitle,
  ValidationError,
} from './validation'

/**
 * Unit tests for the shared body reader. No Firestore — the module only knows
 * about `Request`.
 */

function post(body?: BodyInit, headers?: HeadersInit): Request {
  return new Request('https://example.test/api/wheels', {
    method: 'POST',
    body,
    headers,
  })
}

/** A request whose body is a stream, for the cases a string body cannot reach. */
function streaming(body: ReadableStream<Uint8Array>): Request {
  return new Request('https://example.test/api/wheels', {
    method: 'POST',
    body,
    // @ts-expect-error — duplex is required for a streaming body and is not in
    // the DOM lib's RequestInit yet.
    duplex: 'half',
  })
}

/** The status and code a read rejected with, or null if it resolved. */
async function refusal(
  request: Request,
): Promise<{ status: number; code: string } | null> {
  try {
    await readJsonObject(request)
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

describe('readJsonObject', () => {
  it('parses a JSON object', async () => {
    await expect(
      readJsonObject(post(JSON.stringify({ title: 'Lunch' }))),
    ).resolves.toEqual({ title: 'Lunch' })
  })

  // Creating a wheel is one click and sends nothing at all. `request.json()`
  // throws on an empty body, so a route calling it directly would answer a
  // perfectly valid create with a 500.
  it.each([
    { label: 'no body at all', body: undefined },
    { label: 'an empty string', body: '' },
    { label: 'only whitespace', body: '   \n  ' },
  ])('treats $label as an empty object', async ({ body }) => {
    await expect(readJsonObject(post(body))).resolves.toEqual({})
  })

  it('parses an explicitly empty object the same as nothing', async () => {
    // Both yield {}, which is the point — a route should not have to care which
    // of the two it got. Note what this does NOT preserve: whether a key was
    // absent or explicitly null is a distinction that lives in the parsed
    // object, not in the difference between these two bodies.
    await expect(readJsonObject(post('{}'))).resolves.toEqual({})
  })

  it.each([
    { label: 'a truncated object', body: '{"title": "Lunch"' },
    { label: 'a bare word', body: 'lunch' },
    { label: 'a trailing comma', body: '{"title": "Lunch",}' },
    { label: 'single quotes', body: "{'title': 'Lunch'}" },
  ])('refuses $label with 400', async ({ body }) => {
    expect(await refusal(post(body))).toEqual({
      status: 400,
      code: 'invalid_json',
    })
  })

  // JSON.parse is happy to return any of these, and each would reach a validator
  // as something it has to re-check. `null` is the dangerous one: it is `typeof
  // 'object'`, so a naive check passes it through and the first property read
  // throws.
  it.each([
    { label: 'null', body: 'null' },
    { label: 'a number', body: '42' },
    { label: 'a string', body: '"Lunch"' },
    { label: 'a boolean', body: 'true' },
    { label: 'an array', body: '[{"title": "Lunch"}]' },
  ])('refuses $label as a body', async ({ body }) => {
    expect(await refusal(post(body))).toEqual({
      status: 400,
      code: 'invalid_body',
    })
  })

  it('refuses a body past the size ceiling', async () => {
    // Route handlers read the body themselves and Next.js applies no size limit
    // to them — the 1MB cap people remember is on Server Actions.
    const huge = JSON.stringify({ title: 'x'.repeat(100_000) })
    expect(await refusal(post(huge))).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('refuses a body whose declared length is past the ceiling', async () => {
    // The early out, before a byte is read. A caller decides whether to send
    // this header at all, which is why it cannot be the guarantee.
    const request = post('{}', { 'content-length': String(10 * 1024 * 1024) })
    expect(await refusal(request)).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('refuses an oversized body that declares no length', async () => {
    // The case the content-length early out cannot catch: absent on an HTTP/1.1
    // chunked body and optional under HTTP/2. `Request` does not set the header
    // for a string body either, so this is what every other test here sends —
    // the streaming byte counter is the only thing that refuses it.
    const request = post(JSON.stringify({ title: 'x'.repeat(100_000) }))
    expect(request.headers.get('content-length'), 'no length is declared').toBe(
      null,
    )
    expect(await refusal(request)).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('measures the ceiling in bytes, not UTF-16 units', async () => {
    // 65,536 CJK characters are 65,536 UTF-16 units and 196,608 bytes. A
    // `String.length` check would admit three times the intended ceiling —
    // and would disagree with the content-length check, which is in bytes.
    const cjk = '一'.repeat(65_536)
    expect(cjk.length, 'is at the ceiling by UTF-16 units').toBe(64 * 1024)
    expect(
      Buffer.byteLength(cjk, 'utf8'),
      'is exactly three times the ceiling by bytes',
    ).toBe(3 * 64 * 1024)

    expect(await refusal(post(cjk))).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('decodes a multi-byte character split across chunks', async () => {
    // The streaming decoder holds a partial character until its remaining bytes
    // arrive. Decoding each chunk independently would yield a replacement
    // character and break the JSON.
    const encoded = new TextEncoder().encode(
      JSON.stringify({ title: 'Café 一二三' }),
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split mid-body, which for this payload lands inside a character.
        for (let at = 0; at < encoded.length; at += 3) {
          controller.enqueue(encoded.slice(at, at + 3))
        }
        controller.close()
      },
    })

    const request = new Request('https://example.test/api/wheels', {
      method: 'POST',
      body: stream,
      // @ts-expect-error — duplex is required for a streaming body and is not
      // in the DOM lib's RequestInit yet.
      duplex: 'half',
    })

    await expect(readJsonObject(request)).resolves.toEqual({
      title: 'Café 一二三',
    })
  })

  it('still answers 413 when cancelling the stream fails', async () => {
    // `cancel()` rejects when the stream has already errored, which is exactly
    // what an aborted upload looks like — and an oversized body is the request a
    // client is likeliest to abort. Unguarded, that rejection replaces the 413
    // with a transport error, so the route answers 500 and logs it.
    const oversized = new Uint8Array(70 * 1024)
    const request = streaming(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(oversized)
        },
        cancel() {
          throw new Error('connection already gone')
        },
      }),
    )

    expect(await refusal(request)).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })

  it('attaches the underlying error when the body cannot be read', async () => {
    // The response says only `unreadable_body`, so without a cause a connection
    // reset mid-body reaches operators as a bare 400 that reads like malformed
    // client input, with nothing recorded to say otherwise.
    const reset = new Error('connection reset by peer')
    const request = streaming(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(reset)
        },
      }),
    )

    await expect(readJsonObject(request)).rejects.toMatchObject({
      code: 'unreadable_body',
      status: 400,
      cause: reset,
    })
  })

  it('accepts a body comfortably under the ceiling', async () => {
    const title = 'x'.repeat(1000)
    await expect(
      readJsonObject(post(JSON.stringify({ title }))),
    ).resolves.toEqual({ title })
  })

  it('preserves nested values untouched', async () => {
    // The reader validates the envelope, not the contents. Field validation is
    // ./validation.ts's job and happens after.
    const body = { title: 'Lunch', nested: { a: [1, 2] }, extra: null }
    await expect(readJsonObject(post(JSON.stringify(body)))).resolves.toEqual(
      body,
    )
  })
})

/** The status and code a parse rejected with, or null if it resolved. */
async function parseRefusal(
  request: Request,
  schema: z.ZodType,
): Promise<{ status: number; code: string } | null> {
  try {
    await parseBody(request, schema)
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

describe('parseBody', () => {
  const schema = z.object({
    title: z.unknown().optional().transform(domainCheck(validateTitle)),
  })

  it('returns the parsed body', async () => {
    await expect(
      parseBody(post(JSON.stringify({ title: 'Lunch Friday' })), schema),
    ).resolves.toEqual({ title: 'Lunch Friday' })
  })

  it('returns the sanitised value, not the raw one', async () => {
    // The point of putting the domain validator in the transform rather than
    // beside it: what comes out of the parse is already clean, so a route cannot
    // hold a schema-checked body and still write the raw field.
    await expect(
      parseBody(post(JSON.stringify({ title: '  Lunch\t\tFriday ' })), schema),
    ).resolves.toEqual({ title: 'Lunch Friday' })
  })

  // The contract clients branch on is `code`, and these are facts about this
  // application rather than about the shape of a JSON document. Zod has to carry
  // them through unchanged.
  it.each([
    {
      label: 'an over-length title',
      title: 'x'.repeat(500),
      code: 'title_too_long',
    },
    { label: 'an empty title', title: '', code: 'empty_title' },
    { label: 'a whitespace-only title', title: '   ', code: 'empty_title' },
    { label: 'a non-string title', title: 42, code: 'invalid_title' },
  ])('carries the domain code for $label', async ({ title, code }) => {
    expect(await parseRefusal(post(JSON.stringify({ title })), schema)).toEqual(
      { status: 400, code },
    )
  })

  it('preserves a non-400 domain status', async () => {
    // Nothing on this endpoint returns 409, but the capacity checks do, and the
    // mapping must not flatten every domain failure to 400.
    const conflicting = z.object({
      x: z.unknown().transform(
        domainCheck(() => {
          throw new ValidationError(409, 'options_full', 'Full.')
        }),
      ),
    })
    expect(
      await parseRefusal(post(JSON.stringify({ x: 1 })), conflicting),
    ).toEqual({ status: 409, code: 'options_full' })
  })

  it('reports a Zod-native issue as a 400 invalid_body', async () => {
    // A field of the wrong type has no code of ours to carry. It is still a
    // malformed body, and Zod's own message names the field.
    const typed = z.object({ open: z.boolean() })
    expect(
      await parseRefusal(post(JSON.stringify({ open: 'yes' })), typed),
    ).toEqual({ status: 400, code: 'invalid_body' })
  })

  it.each([
    { label: 'malformed JSON', body: '{oops', code: 'invalid_json' },
    { label: 'a non-object body', body: '[1,2]', code: 'invalid_body' },
  ])('surfaces the transport failure for $label', async ({ body, code }) => {
    // Transport and schema failures arrive as one error type, so a route has a
    // single catch rather than two shapes to tell apart.
    expect(await parseRefusal(post(body), schema)).toEqual({
      status: 400,
      code,
    })
  })

  it('refuses an oversized body before the schema sees it', async () => {
    const huge = JSON.stringify({ title: 'x'.repeat(100_000) })
    expect(await parseRefusal(post(huge), schema)).toEqual({
      status: 413,
      code: 'body_too_large',
    })
  })
})

describe('domainCheck', () => {
  it('rethrows anything that is not a ValidationError', async () => {
    // A bug in a validator must not be swallowed and reported as a 400 the
    // caller can do nothing about.
    const broken = z.object({
      x: z.unknown().transform(
        domainCheck(() => {
          throw new TypeError('a real bug')
        }),
      ),
    })

    await expect(
      parseBody(post(JSON.stringify({ x: 1 })), broken),
    ).rejects.toThrow(TypeError)
  })

  it('composes with the label validators the same way', async () => {
    const schema = z.object({
      label: z.unknown().transform(domainCheck(validateOptionLabel)),
    })

    await expect(
      parseBody(post(JSON.stringify({ label: ' Tacos ' })), schema),
    ).resolves.toEqual({ label: 'Tacos' })

    expect(
      await parseRefusal(post(JSON.stringify({ label: '' })), schema),
    ).toEqual({ status: 400, code: 'empty_label' })
  })
})
