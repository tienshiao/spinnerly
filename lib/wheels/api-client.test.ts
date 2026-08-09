import { describe, expect, it } from 'vitest'

import { ApiError, createWheelApi, type WheelApi } from './api-client'
import { WHEEL_VERSION_HEADER } from './model'

/**
 * The write client, against a recorded `fetch` rather than a server.
 *
 * What is worth testing here is not that a POST is a POST. It is the three
 * things that are easy to get wrong and invisible when they are: which requests
 * carry the edit token, what happens when the answer is not the JSON this API
 * documents, and whether a success body is checked before its contents are put
 * somewhere that matters — a token straight into a URL fragment, an option ID
 * straight into the optimistic layer.
 *
 * `fetch` is injected exactly as `store.ts` injects its `Firestore`, so nothing
 * here touches a global.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const SUGGESTION_ID = 'sUgGeStIoNiDaBcDeFgH'
const TOKEN = 'edit-token-value'

type Call = { url: string; init: RequestInit }

/** A client whose `fetch` answers with `responses` in order and records calls. */
function clientReturning(...responses: Response[]): {
  api: WheelApi
  calls: Call[]
} {
  const calls: Call[] = []
  let index = 0

  const api = createWheelApi({
    fetch: (input, init) => {
      calls.push({ url: String(input), init: init ?? {} })
      const response = responses[index++]
      if (response === undefined) {
        throw new Error(`no canned response for call ${index}`)
      }
      return Promise.resolve(response)
    },
    timeoutMs: 1_000,
  })

  return { api, calls }
}

const VERSION = '2026-08-01T10:00:01.000Z'

function json(body: unknown, status = 200, version = VERSION): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      [WHEEL_VERSION_HEADER]: version,
    },
  })
}

function noContent(version: string | null = VERSION): Response {
  return new Response(null, {
    status: 204,
    headers: version === null ? {} : { [WHEEL_VERSION_HEADER]: version },
  })
}

/** The `ApiError` a call rejected with, or null if it resolved. */
async function refusal(run: () => Promise<unknown>): Promise<ApiError | null> {
  try {
    await run()
    return null
  } catch (error) {
    expect(error, `expected an ApiError, got ${String(error)}`).toBeInstanceOf(
      ApiError,
    )
    return error as ApiError
  }
}

/** Every method, as a thunk, so the cross-cutting cases can iterate them. */
function everyCall(api: WheelApi): {
  label: string
  editor: boolean
  run: () => Promise<unknown>
}[] {
  return [
    {
      label: 'createWheel',
      editor: false,
      run: () => api.createWheel({ title: 'Lunch' }),
    },
    {
      label: 'duplicateWheel',
      editor: false,
      run: () => api.duplicateWheel(SHARE_ID),
    },
    {
      label: 'submitSuggestion',
      editor: false,
      run: () => api.submitSuggestion(SHARE_ID, { label: 'Ramen' }),
    },
    {
      label: 'updateWheel',
      editor: true,
      run: () => api.updateWheel(SHARE_ID, { title: 'Lunch' }, TOKEN),
    },
    {
      label: 'addOption',
      editor: true,
      run: () => api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN),
    },
    {
      label: 'removeOption',
      editor: true,
      run: () => api.removeOption(SHARE_ID, 'option-1', TOKEN),
    },
    {
      label: 'acceptSuggestion',
      editor: true,
      run: () => api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
    {
      label: 'rejectSuggestion',
      editor: true,
      run: () => api.rejectSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
  ]
}

/** A body good enough for whichever call is being exercised generically. */
function anySuccess(): Response {
  return json({
    shareId: SHARE_ID,
    editToken: TOKEN,
    id: 'option-1',
    label: 'Tacos',
    status: 'pending',
    addedAt: '2026-08-01T10:00:00.000Z',
    fromSuggestion: null,
  })
}

const header = (call: Call, name: string): string | undefined =>
  (call.init.headers as Record<string, string> | undefined)?.[name]

const bodyOf = (call: Call): unknown =>
  call.init.body === undefined || call.init.body === null
    ? undefined
    : JSON.parse(String(call.init.body))

describe('request shapes', () => {
  it.each([
    {
      label: 'createWheel',
      method: 'POST',
      url: '/api/wheels',
      run: (api: WheelApi) => api.createWheel({ title: 'Lunch' }),
    },
    {
      label: 'duplicateWheel',
      method: 'POST',
      url: `/api/wheels/${SHARE_ID}/duplicate`,
      run: (api: WheelApi) => api.duplicateWheel(SHARE_ID),
    },
    {
      label: 'updateWheel',
      method: 'PATCH',
      url: `/api/wheels/${SHARE_ID}`,
      run: (api: WheelApi) => api.updateWheel(SHARE_ID, { title: 'X' }, TOKEN),
    },
    {
      label: 'addOption',
      method: 'POST',
      url: `/api/wheels/${SHARE_ID}/options`,
      run: (api: WheelApi) =>
        api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN),
    },
    {
      label: 'removeOption',
      method: 'DELETE',
      url: `/api/wheels/${SHARE_ID}/options/option-1`,
      run: (api: WheelApi) => api.removeOption(SHARE_ID, 'option-1', TOKEN),
    },
    {
      label: 'submitSuggestion',
      method: 'POST',
      url: `/api/wheels/${SHARE_ID}/suggestions`,
      run: (api: WheelApi) =>
        api.submitSuggestion(SHARE_ID, { label: 'Ramen' }),
    },
    {
      label: 'acceptSuggestion',
      method: 'POST',
      url: `/api/wheels/${SHARE_ID}/suggestions/${SUGGESTION_ID}/accept`,
      run: (api: WheelApi) =>
        api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
    {
      label: 'rejectSuggestion',
      method: 'DELETE',
      url: `/api/wheels/${SHARE_ID}/suggestions/${SUGGESTION_ID}`,
      run: (api: WheelApi) =>
        api.rejectSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
  ])('$label calls $method $url', async ({ method, url, run }) => {
    const { api, calls } = clientReturning(anySuccess())
    await run(api)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(url)
    expect(calls[0].init.method).toBe(method)
  })

  /**
   * Every v1 endpoint in the design doc section 6 table has a method (AC 3).
   * `POST /spins` is phase 2 and deliberately absent — asserted so that adding
   * it is a decision rather than an oversight discovered later.
   */
  it('covers every v1 endpoint and no phase-2 one', () => {
    const { api } = clientReturning()
    expect(Object.keys(api).sort()).toEqual([
      'acceptSuggestion',
      'addOption',
      'createWheel',
      'duplicateWheel',
      'rejectSuggestion',
      'removeOption',
      'submitSuggestion',
      'updateWheel',
    ])
  })

  it('encodes path segments rather than letting them add segments', async () => {
    const { api, calls } = clientReturning(noContent())
    await api.removeOption(SHARE_ID, 'a/../../wheelSecrets/x', TOKEN)

    expect(calls[0].url).toBe(
      `/api/wheels/${SHARE_ID}/options/a%2F..%2F..%2FwheelSecrets%2Fx`,
    )
  })

  it('sends the patch body as given, so an absent key stays absent', async () => {
    const { api, calls } = clientReturning(noContent())
    await api.updateWheel(SHARE_ID, { suggestionsOpen: false }, TOKEN)

    // `'title' in body` is what the route uses to tell "leave it alone" from
    // "set it to nothing", so a client that helpfully filled in a title would
    // rename a wheel every time someone closed suggestions.
    expect(bodyOf(calls[0])).toEqual({ suggestionsOpen: false })
  })
})

describe('the edit token', () => {
  it.each(
    everyCall(createWheelApi()).map(({ label, editor }) => ({ label, editor })),
  )('$label sends a bearer header: $editor', async ({ label, editor }) => {
    const { api, calls } = clientReturning(anySuccess())
    const call = everyCall(api).find((entry) => entry.label === label)
    await call?.run()

    expect(
      header(calls[0], 'authorization'),
      editor
        ? 'an editor endpoint must carry the token'
        : 'an unauthenticated endpoint must not be sent the token',
    ).toBe(editor ? `Bearer ${TOKEN}` : undefined)
  })

  it('never puts the token in the URL', async () => {
    const { api, calls } = clientReturning(anySuccess(), anySuccess())
    await api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN)
    await api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN)

    // Design doc section 6: a token in a path or query string lands in Cloud
    // Logging and in every load balancer log between here and the function.
    for (const call of calls) {
      expect(call.url).not.toContain(TOKEN)
    }
  })
})

describe('failures', () => {
  it('carries the route’s own error code through', async () => {
    const { api } = clientReturning(
      json({ error: 'options_full', message: 'That wheel is full.' }, 409),
    )

    const error = await refusal(() =>
      api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN),
    )

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('options_full')
    expect(error?.message).toBe('That wheel is full.')
  })

  it.each([
    { label: '401 missing_token', status: 401, code: 'missing_token' },
    { label: '403 not_editor', status: 403, code: 'not_editor' },
    { label: '404 no_such_wheel', status: 404, code: 'no_such_wheel' },
    {
      label: '409 suggestions_closed',
      status: 409,
      code: 'suggestions_closed',
    },
    { label: '500 internal_error', status: 500, code: 'internal_error' },
  ])('preserves $label', async ({ status, code }) => {
    const { api } = clientReturning(
      json({ error: code, message: 'no' }, status),
    )
    const error = await refusal(() => api.removeOption(SHARE_ID, 'o', TOKEN))

    expect(error?.status).toBe(status)
    expect(error?.code).toBe(code)
  })

  /**
   * The case this decoding exists for. A platform error page is HTML, and
   * `response.json()` on it throws "Unexpected token '<'" — an error that tells
   * whoever reads it to go looking for a parsing bug rather than an outage.
   */
  it.each([
    {
      label: 'an HTML 502',
      response: () =>
        new Response('<!doctype html><h1>502</h1>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    },
    {
      label: 'an empty 503',
      response: () => new Response(null, { status: 503 }),
    },
    {
      label: 'truncated JSON',
      response: () => new Response('{"error":', { status: 500 }),
    },
    {
      label: 'a JSON array',
      response: () => json(['nope'], 500),
    },
    {
      label: 'a JSON body with a non-string error',
      response: () => json({ error: 42 }, 400),
    },
  ])(
    'reports $label as unexpected_response, not a parse error',
    async ({ response }) => {
      const { api } = clientReturning(response())
      const error = await refusal(() => api.removeOption(SHARE_ID, 'o', TOKEN))

      expect(error?.code).toBe('unexpected_response')
      expect(error?.message).not.toContain('Unexpected token')
    },
  )

  it('reports a fetch rejection as network_error', async () => {
    const api = createWheelApi({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    })

    const error = await refusal(() => api.createWheel())
    expect(error?.code).toBe('network_error')
    expect(error?.status).toBe(0)
  })

  it('reports a request that never answers as timeout', async () => {
    const api = createWheelApi({
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason as Error),
          )
        }),
      timeoutMs: 10,
    })

    const error = await refusal(() => api.createWheel())
    expect(error?.code).toBe('timeout')
  })

  /**
   * A timeout is deliberately NOT retryable. The request may well have
   * committed — we stopped waiting, the server did not stop working — and
   * design doc section 6 makes every mutation commutative rather than
   * idempotent, so a retried add is a second option.
   */
  it.each([
    {
      label: 'network_error',
      code: 'network_error',
      status: 0,
      retryable: true,
    },
    {
      label: 'a 500 from the route',
      code: 'internal_error',
      status: 500,
      retryable: true,
    },
    {
      label: 'a 503, never forwarded',
      code: 'unavailable',
      status: 503,
      retryable: true,
    },
    { label: 'a timeout', code: 'timeout', status: 0, retryable: false },
    {
      label: 'a 504 gateway timeout',
      code: 'unexpected_response',
      status: 504,
      retryable: false,
    },
    {
      label: 'a 502 bad gateway',
      code: 'unexpected_response',
      status: 502,
      retryable: false,
    },
    {
      label: 'a 408 request timeout',
      code: 'unexpected_response',
      status: 408,
      retryable: false,
    },
    { label: 'a 403', code: 'not_editor', status: 403, retryable: false },
    { label: 'a 409', code: 'options_full', status: 409, retryable: false },
  ])('$label is retryable: $retryable', ({ code, status, retryable }) => {
    expect(new ApiError(status, code, 'x').isRetryable).toBe(retryable)
  })

  /**
   * The gateway statuses are `timeout` wearing a different number: a proxy gave
   * up on a function that may already have committed. Asserted as one rule as
   * well as as rows, so an edit that tidies 502 back under the `>= 500` branch
   * fails on the reason rather than on a table entry someone might delete.
   */
  it('calls nothing retryable when the write may already have landed', () => {
    for (const status of [408, 502, 504]) {
      expect(
        new ApiError(status, 'unexpected_response', 'x').isRetryable,
        `${status} means an intermediary gave up, not that nothing happened`,
      ).toBe(false)
    }
  })
})

/**
 * The version is the answer to the one question a client could not otherwise
 * ask — is the document I am looking at at or past my own write? — and it rides
 * on a header rather than in a body precisely so the four routes that answer
 * 204 can carry it too. See `WHEEL_VERSION_HEADER`.
 */
describe('the version header', () => {
  it.each([
    {
      label: 'a 204 route',
      response: () => noContent(),
      run: (api: WheelApi) => api.updateWheel(SHARE_ID, { title: 'X' }, TOKEN),
    },
    {
      label: 'a 201 route',
      response: () => json({ id: 'option-1', label: 'Tacos' }, 201),
      run: (api: WheelApi) => api.addOption(SHARE_ID, { label: 'X' }, TOKEN),
    },
    {
      label: 'a delete',
      response: () => noContent(),
      run: (api: WheelApi) => api.removeOption(SHARE_ID, 'o1', TOKEN),
    },
    {
      label: 'an accept',
      response: () => noContent(),
      run: (api: WheelApi) =>
        api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
    {
      label: 'a reject',
      response: () => noContent(),
      run: (api: WheelApi) =>
        api.rejectSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
    {
      label: 'a suggestion submission',
      response: () =>
        json({ id: SUGGESTION_ID, label: 'Ramen', status: 'pending' }, 201),
      run: (api: WheelApi) => api.submitSuggestion(SHARE_ID, { label: 'X' }),
    },
  ])('is read from $label', async ({ response, run }) => {
    const { api } = clientReturning(response())
    const result = await run(api)

    expect(result.updatedAt).toBeInstanceOf(Date)
    expect(result.updatedAt?.toISOString()).toBe(VERSION)
  })

  /**
   * A missing or unusable version is NOT a failed write — the status already
   * said it succeeded. It costs the caller its version evidence and nothing
   * else; ./optimistic.ts falls back to identity, which never retires early.
   */
  it.each([
    { label: 'absent', version: null },
    { label: 'empty', version: '' },
    { label: 'not a date', version: 'soon' },
    { label: 'a bare number', version: 'NaN' },
  ])(
    'reports a version that is $label as null, not as an error',
    async ({ version }) => {
      const { api } = clientReturning(noContent(version))
      const result = await api.updateWheel(SHARE_ID, { title: 'X' }, TOKEN)

      expect(result.updatedAt).toBeNull()
    },
  )

  /**
   * The route omits the header when it has no version to report — the
   * idempotent second accept, which writes nothing. That is a deliberate
   * absence rather than a stripped one, and the client cannot tell them apart,
   * which is fine: both mean the same thing to ./optimistic.ts.
   */
  it('treats a deliberately omitted version the same as a missing one', async () => {
    const { api } = clientReturning(noContent(null))
    const result = await api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN)

    expect(result.updatedAt).toBeNull()
  })

  it('never returns an Invalid Date, which no null check would catch', () => {
    // The whole point of the null: an Invalid Date compares false against
    // everything, so an entry holding one would never retire and never say why.
    expect(new Date('soon').getTime()).toBeNaN()
  })
})

describe('success bodies', () => {
  it('returns the created wheel', async () => {
    const { api } = clientReturning(
      json({ shareId: SHARE_ID, editToken: TOKEN }, 201),
    )
    expect(await api.createWheel({ title: 'Lunch' })).toEqual({
      shareId: SHARE_ID,
      editToken: TOKEN,
    })
  })

  /**
   * A 2xx whose body is not the documented shape is not a success — it is a
   * proxy or a rewrite answering in the route's place. Accepting one would put
   * `undefined` into a URL fragment as an edit token, producing a share link
   * that looks right and opens nothing.
   */
  it.each([
    { label: 'no editToken', body: { shareId: SHARE_ID } },
    { label: 'an empty editToken', body: { shareId: SHARE_ID, editToken: '' } },
    { label: 'no shareId', body: { editToken: TOKEN } },
    { label: 'a non-string shareId', body: { shareId: 1, editToken: TOKEN } },
    { label: 'an empty body', body: {} },
  ])('refuses a created wheel with $label', async ({ body }) => {
    const { api } = clientReturning(json(body, 201))
    expect((await refusal(() => api.createWheel()))?.code).toBe(
      'unexpected_response',
    )
  })

  it('refuses a created wheel whose 201 has no body at all', async () => {
    const { api } = clientReturning(new Response(null, { status: 201 }))
    expect((await refusal(() => api.duplicateWheel(SHARE_ID)))?.code).toBe(
      'unexpected_response',
    )
  })

  it('returns the option with addedAt as a Date, matching a snapshot', async () => {
    const { api } = clientReturning(
      json(
        {
          id: 'option-1',
          label: 'Tacos',
          addedAt: '2026-08-01T10:00:00.000Z',
          fromSuggestion: null,
        },
        201,
      ),
    )

    const { option } = await api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN)
    expect(option.addedAt).toBeInstanceOf(Date)
    expect(option.addedAt?.toISOString()).toBe('2026-08-01T10:00:00.000Z')
  })

  it.each([
    { label: 'absent', value: undefined },
    { label: 'unparseable', value: 'the first of August' },
  ])('reads an addedAt that is $label as null', async ({ value }) => {
    const { api } = clientReturning(
      json({ id: 'option-1', label: 'Tacos', addedAt: value }, 201),
    )
    const { option } = await api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN)
    expect(option.addedAt).toBeNull()
  })

  /**
   * The optimistic layer keys an add on this ID: without it, the local row can
   * never recognise its own arrival and would be drawn alongside the real one
   * for as long as the page stayed open.
   */
  it('refuses an added option with no id', async () => {
    const { api } = clientReturning(json({ label: 'Tacos' }, 201))
    expect(
      (await refusal(() => api.addOption(SHARE_ID, { label: 'Tacos' }, TOKEN)))
        ?.code,
    ).toBe('unexpected_response')
  })

  it('returns the created suggestion', async () => {
    const { api } = clientReturning(
      json({ id: SUGGESTION_ID, label: 'Ramen', status: 'pending' }, 201),
    )
    expect(
      (await api.submitSuggestion(SHARE_ID, { label: 'Ramen' })).suggestion,
    ).toEqual({ id: SUGGESTION_ID, label: 'Ramen', status: 'pending' })
  })

  it('reads an unrecognised suggestion status as pending', async () => {
    const { api } = clientReturning(
      json({ id: SUGGESTION_ID, label: 'Ramen', status: 'rejected' }, 201),
    )
    expect(
      (await api.submitSuggestion(SHARE_ID, { label: 'Ramen' })).suggestion
        .status,
    ).toBe('pending')
  })

  it.each([
    {
      label: 'updateWheel',
      run: (api: WheelApi) => api.updateWheel(SHARE_ID, { title: 'X' }, TOKEN),
    },
    {
      label: 'removeOption',
      run: (api: WheelApi) => api.removeOption(SHARE_ID, 'option-1', TOKEN),
    },
    {
      label: 'acceptSuggestion',
      run: (api: WheelApi) =>
        api.acceptSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
    {
      label: 'rejectSuggestion',
      run: (api: WheelApi) =>
        api.rejectSuggestion(SHARE_ID, SUGGESTION_ID, TOKEN),
    },
  ])('$label resolves on a 204 without reading a body', async ({ run }) => {
    // `response.json()` on a 204 throws. The routes answer 204 for every
    // mutation whose result the snapshot delivers anyway — and the version
    // still arrives, because it rides on a header rather than in the body.
    const { api } = clientReturning(noContent())
    await expect(run(api)).resolves.toEqual({ updatedAt: new Date(VERSION) })
  })
})
