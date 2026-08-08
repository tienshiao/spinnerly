import { describe, expect, it } from 'vitest'

import { SUGGESTION_LABEL_MAX } from '@/lib/wheels/validation'
import { POST } from './route'

/**
 * The rejection paths of POST /api/wheels/{shareId}/suggestions, in the unit
 * project.
 *
 * This route is the one write path with no authorization, which is exactly what
 * lets these cases live here: the body is parsed before anything is read from
 * Firestore, so every rejection below is reached without an emulator. The three
 * editor routes have no counterpart to this file because `assertEditor` reads a
 * document before their bodies are looked at.
 *
 * The split is load-bearing rather than tidy, for the reason
 * app/api/wheels/route.test.ts gives: it makes "an invalid submission must not
 * touch the database" a property the suite enforces. Move validation after the
 * write and these tests start failing for want of an emulator rather than
 * passing quietly — which matters more here than anywhere else in the API,
 * because this is the endpoint anyone can call.
 */

const SHARE_ID = 'a1b2c3d4e5f6g7h8i9j0'

function post(body?: BodyInit): Request {
  return new Request(
    `https://example.test/api/wheels/${SHARE_ID}/suggestions`,
    { method: 'POST', body },
  )
}

function context() {
  return {
    params: Promise.resolve({ shareId: SHARE_ID }),
  } as RouteContext<'/api/wheels/[shareId]/suggestions'>
}

/** Run the handler and return its status and parsed body. */
async function run(body?: BodyInit) {
  const response = await POST(post(body), context())
  return {
    status: response.status,
    body: (await response.json()) as { error?: string; message?: string },
  }
}

describe('the transport layer', () => {
  it.each([
    { label: 'a truncated object', body: '{"label": "Tacos"' },
    { label: 'a bare word', body: 'tacos' },
  ])('refuses $label with 400 invalid_json', async ({ body }) => {
    expect(await run(body)).toMatchObject({
      status: 400,
      body: { error: 'invalid_json' },
    })
  })

  it.each([
    { label: 'null', body: 'null' },
    { label: 'an array', body: '["Tacos"]' },
    { label: 'a number', body: '42' },
  ])('refuses $label as a body with 400 invalid_body', async ({ body }) => {
    expect(await run(body)).toMatchObject({
      status: 400,
      body: { error: 'invalid_body' },
    })
  })

  it('refuses a body past the ceiling with 413', async () => {
    // The ceiling matters more here than on any other route: this is the one
    // endpoint reachable without a credential, so it is the one where an
    // unbounded read would be free to an attacker.
    expect(
      await run(JSON.stringify({ label: 'x'.repeat(70_000) })),
    ).toMatchObject({ status: 413, body: { error: 'body_too_large' } })
  })
})

describe('the label', () => {
  it.each([
    { label: 'an absent body', body: undefined, code: 'invalid_label' },
    { label: 'an empty object', body: '{}', code: 'invalid_label' },
    { label: 'a null label', body: '{"label": null}', code: 'invalid_label' },
    { label: 'a number', body: '{"label": 42}', code: 'invalid_label' },
    { label: 'an object', body: '{"label": {}}', code: 'invalid_label' },
    { label: 'an empty label', body: '{"label": ""}', code: 'empty_label' },
    {
      label: 'a whitespace-only label',
      body: '{"label": "   "}',
      code: 'empty_label',
    },
    {
      // Escapes rather than the characters themselves, for the reason
      // ZERO_WIDTH_SPACE gives in lib/wheels/validation.ts.
      label: 'a label of word joiners',
      body: '{"label": "\\u2060\\u2060"}',
      code: 'empty_label',
    },
    {
      label: 'a label with a control character',
      body: '{"label": "Tac\\u0007os"}',
      code: 'invalid_label',
    },
  ])('refuses $label with 400 $code', async ({ body, code }) => {
    expect(await run(body)).toMatchObject({
      status: 400,
      body: { error: code },
    })
  })

  it('refuses an over-length label and names the limit', async () => {
    const { status, body } = await run(
      JSON.stringify({ label: 'x'.repeat(SUGGESTION_LABEL_MAX + 1) }),
    )

    expect(status).toBe(400)
    expect(body.error).toBe('label_too_long')
    expect(body.message).toContain(String(SUGGESTION_LABEL_MAX))
  })
})

describe('fields the server owns', () => {
  it.each([
    { label: 'a status', body: '{"label": "Tacos", "status": "accepted"}' },
    { label: 'a createdAt', body: '{"label": "Tacos", "createdAt": 0}' },
    { label: 'an id', body: '{"label": "Tacos", "id": "mine"}' },
    {
      // No longer a field of the model at all — see the note in
      // `submitSuggestion` on why the fingerprint design doc section 4
      // specifies is not written. `.strict()` refuses it like any other
      // invention, which is the right answer either way.
      label: 'a clientHint',
      body: '{"label": "Tacos", "clientHint": "mine"}',
    },
    { label: 'an unknown key', body: '{"label": "Tacos", "colour": "red"}' },
  ])('refuses $label with 400 invalid_body', async ({ body }) => {
    expect(await run(body)).toMatchObject({
      status: 400,
      body: { error: 'invalid_body' },
    })
  })
})
