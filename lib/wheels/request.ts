import { z } from 'zod'

import { ValidationError } from './validation'

/**
 * Reading and parsing a request body, the same way in every write route.
 *
 * The division of labour across the three modules involved is worth stating,
 * because "where does this check go?" is the question that otherwise gets
 * answered differently by each new endpoint:
 *
 *  - **Here** — transport. How many bytes, whether it is JSON at all, whether it
 *    is an object. None of it is expressible as a schema, because the schema
 *    only ever sees a value that already parsed.
 *  - **A Zod schema, in the route** — shape. Which fields exist and what type
 *    each is. Written per endpoint, next to the handler that uses it.
 *  - **./validation.ts** — domain. The caps, the sanitisation, the rules that
 *    hold whatever the transport was. Reached from a schema through
 *    `domainCheck` below, so the two never disagree.
 *
 * Deliberately not part of ./validation.ts. That module is pure computation over
 * strings and is meant to be importable by the client; this one is about the
 * shape of an HTTP request, and only a route handler has one.
 */

/**
 * How many bytes of request body are accepted before the read is abandoned.
 *
 * Route handlers read the body themselves, and Next.js applies no size limit of
 * its own to them — the 1MB cap people remember is on Server Actions. Without a
 * ceiling here, an unauthenticated endpoint will happily buffer whatever a
 * caller sends before any validator gets a look at it.
 *
 * 64KB is far above any legitimate body. The largest this API accepts is a wheel
 * title, and even a full 50-option wheel is a few kilobytes.
 */
const MAX_BODY_BYTES = 64 * 1024

function tooLarge(): ValidationError {
  return new ValidationError(
    413,
    'body_too_large',
    'That request body is too large.',
  )
}

/**
 * The body as text, refusing it partway through if it exceeds the ceiling.
 *
 * Read as a stream rather than with `request.text()`, and this is the whole
 * point of the function. `text()` buffers the entire body into the process
 * before returning, so a size check after it has already lost — the memory is
 * spent by the time the check runs. The only pre-read signal is
 * `content-length`, and a caller decides whether to send one: it is absent on an
 * HTTP/1.1 chunked body and optional under HTTP/2. So on an unauthenticated
 * endpoint, "check the header, then call text()" means anyone willing to send a
 * chunked request can have us buffer a body of any size at all.
 *
 * Counting bytes off the stream and abandoning it at the ceiling is what makes
 * the limit real. Bytes rather than string length, because they are what
 * `content-length` speaks and what memory actually costs — 65,536 CJK
 * characters are 65,536 UTF-16 units and 196,608 bytes, so a `String.length`
 * check would admit three times the intended ceiling.
 *
 * `text()` is also unusable here for a second reason, which is why the empty
 * body is handled at the top: it is `request.json()` that throws on an empty
 * body, and telling absent from malformed is the other thing this module exists
 * to do.
 */
async function readBodyText(request: Request): Promise<string> {
  const body = request.body
  if (body === null) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let bytes = 0
  let text = ''

  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch (error) {
      // `cause` because the response deliberately says nothing useful — every
      // read failure is one `unreadable_body` — and without it a connection
      // reset mid-body reaches operators as a bare 400 that reads like
      // malformed client input, with nothing recorded to say otherwise.
      throw new ValidationError(
        400,
        'unreadable_body',
        'That request body could not be read.',
        { cause: error },
      )
    }

    if (chunk.done) break

    bytes += chunk.value.byteLength
    if (bytes > MAX_BODY_BYTES) {
      // Abandon the rest rather than draining it: there is no reason to receive
      // bytes we have already decided to refuse.
      //
      // The rejection is swallowed on purpose. `cancel()` rejects when the
      // stream has already errored — which is precisely what happens when the
      // client aborts an upload it has been told nothing about yet, the likeliest
      // way to reach this line. Unguarded, that rejection replaces the 413 with
      // an unhandled transport error, so the route answers 500 and logs it: an
      // attacker-triggerable error-log volume, and the wrong status.
      await reader.cancel().catch(() => {})
      throw tooLarge()
    }

    // `stream: true` so a multi-byte character split across two chunks is held
    // until its remaining bytes arrive, instead of decoding to a replacement
    // character.
    text += decoder.decode(chunk.value, { stream: true })
  }

  return text + decoder.decode()
}

/**
 * The parsed JSON object in `request`, or `{}` when it has no body.
 *
 * Three cases that are easy to get wrong, and are settled here once rather than
 * per route:
 *
 *  - **An absent body is not an error.** Creating a wheel is one click and sends
 *    nothing at all (design doc section 1, and TASK-21's flow). `request.json()`
 *    throws on an empty body, so a route calling it directly would answer a
 *    perfectly valid create with a 500.
 *  - **A malformed body is a 400, not a 500.** Same reason in reverse: the throw
 *    from `request.json()` is an unhandled rejection unless something catches it,
 *    and "your JSON is broken" is information the caller can act on.
 *  - **A JSON body that is not an object is refused.** `JSON.parse` is happy to
 *    return `null`, `42` or an array, and every one of those would reach a
 *    validator as something it has to re-check. `null` is the dangerous one: it
 *    is `typeof 'object'`, so a naive check passes it through and the first
 *    property read throws.
 *
 * Most routes want `parseBody` below rather than this directly — it runs a
 * schema over the result and reports both kinds of failure the same way.
 */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  // An early out only. `content-length` is caller-supplied and often absent, so
  // it can refuse a body before a byte is read but can never be what guarantees
  // the ceiling — `readBodyText` is.
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw tooLarge()
  }

  const raw = await readBodyText(request)

  if (raw.trim().length === 0) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ValidationError(
      400,
      'invalid_json',
      'That request body is not valid JSON.',
    )
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError(
      400,
      'invalid_body',
      'That request body must be a JSON object.',
    )
  }

  return parsed as Record<string, unknown>
}

/**
 * What `domainCheck` stashes on a Zod issue so `parseBody` can rebuild the
 * original `ValidationError` from it.
 *
 * The response contract is `{ error: code, message }` with a status, and clients
 * branch on `code`. Zod has its own issue codes and its own notion of what went
 * wrong, and neither maps onto ours — `title_too_long` and `options_full` are
 * facts about this application, not about the shape of a JSON document. Rather
 * than translate one vocabulary into the other, the domain error is carried
 * through Zod intact and unpacked on the far side.
 */
type CarriedError = { code: string; status: number }

function carried(params: unknown): CarriedError | null {
  if (params === null || typeof params !== 'object') return null
  const { code, status } = params as Partial<CarriedError>
  if (typeof code !== 'string' || typeof status !== 'number') return null
  return { code, status }
}

/**
 * Adapt a validator from ./validation.ts into a Zod transform.
 *
 * Domain validators throw `ValidationError` and return the sanitised value,
 * which is the right shape for a route but the wrong shape for a schema. This
 * makes them usable as `z.unknown().transform(domainCheck(validateOptionLabel))`
 * — the value that comes out of parsing is the sanitised one, so a route cannot
 * hold a schema-checked body and still write the raw field.
 *
 * The failure is reported with `ctx.addIssue` and `z.NEVER` rather than by
 * letting the throw escape. Zod does propagate an exception thrown inside a
 * transform, so throwing would "work" — but it would mean `safeParse` sometimes
 * throws, which is the one thing its caller is entitled to assume it never does.
 */
export function domainCheck<T>(
  validate: (raw: unknown) => T,
): (raw: unknown, ctx: z.RefinementCtx) => T {
  return (raw, ctx) => {
    try {
      return validate(raw)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error

      ctx.addIssue({
        code: 'custom',
        message: error.message,
        params: {
          code: error.code,
          status: error.status,
        } satisfies CarriedError,
      })
      return z.NEVER
    }
  }
}

/**
 * Read the body of `request` and parse it with `schema`.
 *
 * The single entry point every write route should use. Transport failures and
 * schema failures both arrive as one `ValidationError`, so a handler has one
 * `catch` rather than two shapes of failure to tell apart.
 *
 * Only the first issue becomes the response. Zod collects every problem it
 * finds, but the contract is a single `{ error, message }` and these bodies
 * carry one or two fields — reporting the first is what the client can act on.
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const body = await readJsonObject(request)

  const result = schema.safeParse(body)
  if (result.success) return result.data

  const issue = result.error.issues[0]
  // `params` exists only on a custom issue, which is the only kind `domainCheck`
  // raises. Anything else is Zod's own.
  const domain = issue.code === 'custom' ? carried(issue.params) : null

  // A Zod-native issue — a field of the wrong type, say — has no code of ours to
  // carry. It is still a malformed body and still a 400; its message is Zod's,
  // which names the field and what was expected.
  throw new ValidationError(
    domain?.status ?? 400,
    domain?.code ?? 'invalid_body',
    issue.message,
  )
}
