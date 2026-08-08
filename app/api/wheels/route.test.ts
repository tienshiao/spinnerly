import { describe, expect, it } from 'vitest'

import { TITLE_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * The rejection paths of POST /api/wheels, in the unit project.
 *
 * These never reach Firestore, which is the whole reason they can live here: a
 * body that fails validation is refused before `createWheel` is called, so no
 * emulator is needed to prove it. The success path is in ./route.emulator.test.ts.
 *
 * That split is load-bearing rather than tidy. It means the rule "an invalid
 * request must not touch the database" is enforced by the test suite itself —
 * were validation ever moved after the write, these tests would start failing
 * for want of an emulator rather than passing quietly.
 */

function post(body?: BodyInit, headers?: HeadersInit): Request {
  return new Request('https://example.test/api/wheels', {
    method: 'POST',
    body,
    headers,
  })
}

/** The status and parsed body of a response. */
async function result(response: Response) {
  return {
    status: response.status,
    body: (await response.json()) as { error?: string; message?: string },
  }
}

describe('POST /api/wheels', () => {
  it.each([
    { label: 'a truncated object', body: '{"title": "Lunch"' },
    { label: 'a bare word', body: 'lunch' },
  ])('refuses $label with 400 invalid_json', async ({ body }) => {
    const { status, body: parsed } = await result(await POST(post(body)))
    expect(status).toBe(400)
    expect(parsed.error).toBe('invalid_json')
  })

  it.each([
    { label: 'null', body: 'null' },
    { label: 'an array', body: '["Lunch"]' },
    { label: 'a number', body: '42' },
  ])('refuses $label as a body with 400 invalid_body', async ({ body }) => {
    const { status, body: parsed } = await result(await POST(post(body)))
    expect(status).toBe(400)
    expect(parsed.error).toBe('invalid_body')
  })

  it.each([
    { label: 'an empty title', title: '', code: 'empty_title' },
    { label: 'a whitespace-only title', title: '   ', code: 'empty_title' },
    { label: 'a number', title: 42, code: 'invalid_title' },
    { label: 'a boolean', title: true, code: 'invalid_title' },
    { label: 'an object', title: { text: 'Lunch' }, code: 'invalid_title' },
  ])('refuses $label with 400 $code', async ({ title, code }) => {
    const { status, body } = await result(
      await POST(post(JSON.stringify({ title }))),
    )
    expect(status).toBe(400)
    expect(body.error).toBe(code)
  })

  it('refuses an over-length title and names the limit', async () => {
    const { status, body } = await result(
      await POST(post(JSON.stringify({ title: 'x'.repeat(TITLE_MAX + 1) }))),
    )
    expect(status).toBe(400)
    expect(body.error).toBe('title_too_long')
    expect(body.message).toContain(String(TITLE_MAX))
  })

  it('refuses a body past the size ceiling with 413', async () => {
    const { status, body } = await result(
      await POST(post(JSON.stringify({ title: 'x'.repeat(100_000) }))),
    )
    expect(status).toBe(413)
    expect(body.error).toBe('body_too_large')
  })

  it('returns a structured error body, never a bare status', async () => {
    // The client renders `message` and branches on `error`. A 500 with an HTML
    // body — which is what an uncaught throw would produce — gives it neither.
    const { body } = await result(await POST(post('lunch')))
    expect(typeof body.error).toBe('string')
    expect(typeof body.message).toBe('string')
  })
})
