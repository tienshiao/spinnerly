import { WHEEL_VERSION_HEADER } from './model'
import { isSuggestionStatus } from './snapshot'
import type {
  CreatedSuggestion,
  CreatedWheel,
  WheelOption,
  WheelPatch,
  WheelVersion,
} from './model'

/**
 * The write half of the client data path, per design doc sections 3 and 6.
 *
 * Every mutation in this application goes through a route handler rather than
 * through the Firestore SDK — security rules deny every client write, and
 * `spinnerly/no-client-firestore-writes` fails lint on the import that would
 * try. This module is the only thing on the client that talks to those routes,
 * so the URL shapes, the bearer header and the error decoding are stated once.
 *
 * Two consequences of that split show up here rather than in the UI:
 *
 *  - **There is no latency compensation.** The path is client → API → Firestore
 *    → snapshot back, so nothing these methods return is on screen yet. What
 *    they return is what ./optimistic.ts needs in order to know when the
 *    snapshot has caught up.
 *  - **Cold starts are the normal first write.** Design doc section 3 accepts a
 *    one-to-two-second stall on the first request after a quiet period, so the
 *    timeout below is set well clear of it and the pending affordance is
 *    ./optimistic.ts's job rather than a spinner this module could offer.
 */

/**
 * A failed write, in the shape every route already answers with.
 *
 * `code` is the `error` field of the body — `title_too_long`, `options_full`,
 * `not_editor` — and is what a caller branches on. The wire format is fixed by
 * `EditorAuthError.toResponse` and `ValidationError.toResponse` in the server
 * modules; the two codes below are this module's own, for the failures that
 * arrive with no body to read.
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /**
   * Whether retrying the identical request could plausibly succeed.
   *
   * The question this answers is not "did it fail?" but "is it safe to send
   * again?", and those come apart on every failure where the request may
   * already have been carried out. Design doc section 6 makes every mutation
   * COMMUTATIVE, not idempotent, and the difference is the whole point: two
   * adds of the same label both land, so a retry of a write that quietly
   * succeeded is a second option on the wheel.
   *
   * So `timeout` is excluded — we stopped waiting, the server did not stop
   * working — and so are the gateway statuses, for exactly the same reason.
   * A 504 is a proxy saying the function did not answer IN TIME, not that it
   * did not run; a 502 is a proxy that could not read the answer to work that
   * may already be committed. Only failures that mean the request was never
   * carried out are retryable: it never left (`network_error`), or the
   * application itself refused it before writing anything.
   */
  get isRetryable(): boolean {
    if (NOT_SAFE_TO_REPEAT.has(this.status)) return false
    return this.code === NETWORK_ERROR || this.status >= 500
  }
}

/**
 * Statuses that mean "an intermediary gave up", not "nothing happened".
 *
 * 503 is deliberately absent: a load balancer answering "no capacity" has not
 * forwarded the request, so it is the one 5xx from an intermediary that really
 * does mean the write did not happen.
 */
const NOT_SAFE_TO_REPEAT = new Set([408, 502, 504])

/** The request never reached a server, or the answer never came back. */
const NETWORK_ERROR = 'network_error'
/** No answer within `timeoutMs`. Distinct from `network_error`: see `isRetryable`. */
const TIMEOUT = 'timeout'
/** A response arrived that was not the JSON this API is documented to return. */
const UNEXPECTED_RESPONSE = 'unexpected_response'

/**
 * How long to wait before giving up on a request.
 *
 * Set deliberately ABOVE a Vercel function's own limit rather than below it. A
 * shorter client timeout would abort the request while the server was still
 * working and replace whatever it was about to say — a 504, a 500 with a
 * cause — with our generic `timeout`, hiding the real failure behind a symptom.
 * This bound exists for the case where nothing answers at all, which is the one
 * the server cannot report on its own behalf.
 */
const DEFAULT_TIMEOUT_MS = 30_000

export type WheelApiOptions = {
  /**
   * Injected in tests, exactly as `store.ts` injects its `Firestore`. Left
   * alone in the browser, where the global is the one thing that can actually
   * reach the route handlers.
   */
  fetch?: typeof globalThis.fetch
  /** Overridden in tests to keep a timeout case from taking half a minute. */
  timeoutMs?: number
  /** The route prefix. Relative by design — same origin, same deployment. */
  baseUrl?: string
}

/**
 * The typed client. One method per v1 endpoint in the design doc section 6
 * table; `POST /spins` is phase 2 and deliberately absent.
 *
 * The editor methods take `editToken` as a required parameter rather than the
 * factory holding one. A client that carried a token could be handed to a
 * component that has none — the participant view — and would then send editor
 * requests that 403, or worse, send an editor's token from a page that had no
 * business holding it. Requiring it at the call site makes "does this caller
 * have edit rights" a question the type checker asks.
 */
export type WheelApi = ReturnType<typeof createWheelApi>

export function createWheelApi(options: WheelApiOptions = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    baseUrl = '/api/wheels',
  } = options

  /**
   * Every path segment is encoded, including ones that ./model.ts would have
   * rejected. The guards run on the server, which is where they have to run;
   * encoding here is what stops a malformed ID reaching the route as extra path
   * segments and being answered by the wrong handler — a 405 or a 404 from
   * Next's router rather than the `no_such_wheel` the caller can act on.
   */
  const path = (...segments: (string | number)[]): string =>
    `${baseUrl}${segments.map((segment) => `/${encodeURIComponent(segment)}`).join('')}`

  /**
   * What a mutating call learns from its response: whatever body there was, and
   * the version the write produced.
   */
  type Sent = { body: unknown; updatedAt: Date | null }

  async function send(
    url: string,
    init: { method: string; token?: string; body?: unknown },
  ): Promise<Sent> {
    const headers: Record<string, string> = {}

    // Only ever on the five editor endpoints. Create, duplicate and submit are
    // `auth: none` in design doc section 6, and attaching a bearer to one of
    // them would put the token through a request that has no use for it — one
    // more place it can end up in a log for no benefit at all.
    if (init.token !== undefined) {
      headers.authorization = `Bearer ${init.token}`
    }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json'
    }

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        // No caller-supplied `signal`. An aborted write is not an undone write:
        // the request may already have committed, and a caller that treated
        // "I cancelled it" as "it did not happen" would roll back an optimistic
        // entry for a change the next snapshot then delivers anyway.
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (cause) {
      const timedOut =
        cause instanceof Error &&
        (cause.name === 'TimeoutError' || cause.name === 'AbortError')

      throw timedOut
        ? new ApiError(
            0,
            TIMEOUT,
            'That took too long. It may still have gone through — check before trying again.',
            cause,
          )
        : new ApiError(
            0,
            NETWORK_ERROR,
            'Could not reach the server. Check your connection and try again.',
            cause,
          )
    }

    const updatedAt = versionOf(response)

    // 204 is the documented success for every editor mutation that changes
    // something the snapshot will deliver anyway — PATCH, DELETE, accept. There
    // is no body to read and `response.json()` on one throws. The version still
    // arrives, because it rides on a header rather than in the body — see
    // `WHEEL_VERSION_HEADER`.
    if (response.status === 204) return { body: undefined, updatedAt }

    const body = await readJson(response)

    if (!response.ok) throw errorFrom(response.status, body)

    return { body, updatedAt }
  }

  return {
    /**
     * `GET /wheels/{shareId}/editor` — is this token this wheel's?
     *
     * The one read in this module, and the one method that does not throw on a
     * refusal. A 401 or a 403 is the ANSWER here rather than a failure, so it
     * comes back as a value; everything else is a failure and says so.
     *
     * **`'unknown'` is not a polite way of saying no.** Only an authoritative
     * refusal demotes a caller to the participant view. A dropped connection, a
     * cold start that timed out or a 502 from the platform are all evidence
     * about the network and none about the token, and treating them as "not an
     * editor" would silently strip the role from someone holding a perfectly
     * good edit link — recoverable only by a reload they have no reason to
     * attempt, since the page would look like an ordinary share view.
     *
     * A 404 is `'unknown'` for a different reason: the wheel is gone, which the
     * snapshot listener reports on its own and in more detail. Answering
     * `'not-editor'` would race it and put "that edit link isn't valid" on
     * screen for a wheel that simply no longer exists.
     */
    async verifyEditor(
      shareId: string,
      editToken: string,
    ): Promise<'editor' | 'not-editor' | 'unknown'> {
      try {
        await send(path(shareId, 'editor'), { method: 'GET', token: editToken })
        return 'editor'
      } catch (error) {
        if (!(error instanceof ApiError)) throw error
        return error.status === 401 || error.status === 403
          ? 'not-editor'
          : 'unknown'
      }
    },

    /** `POST /wheels` — create. The only other time a raw token is emitted. */
    async createWheel(input: { title?: string } = {}): Promise<CreatedWheel> {
      const { body } = await send(path(), { method: 'POST', body: input })
      return asCreatedWheel(body)
    },

    /**
     * `POST /wheels/{shareId}/duplicate` — fork. Unauthenticated by design:
     * anyone holding the share URL may fork (decision 5), which is what makes
     * it the escape hatch for a wheel whose editor has vanished.
     */
    async duplicateWheel(shareId: string): Promise<CreatedWheel> {
      const { body } = await send(path(shareId, 'duplicate'), {
        method: 'POST',
      })
      return asCreatedWheel(body)
    },

    /** `PATCH /wheels/{shareId}` — title and the suggestions kill switch. */
    async updateWheel(
      shareId: string,
      patch: WheelPatch,
      editToken: string,
    ): Promise<WheelVersion> {
      const { updatedAt } = await send(path(shareId), {
        method: 'PATCH',
        token: editToken,
        body: patch,
      })
      return { updatedAt }
    },

    /**
     * `POST /wheels/{shareId}/options` — add one.
     *
     * One at a time, never the whole array: the edit URL is transferable, so
     * two editors adding at once is ordinary, and a whole-array write would
     * have the second erase the first (design doc section 6).
     *
     * The returned `id` is the server's, and ./optimistic.ts needs it — it is
     * how the optimistic row recognises its own arrival in the next snapshot
     * instead of rendering alongside it.
     */
    async addOption(
      shareId: string,
      input: { label: string },
      editToken: string,
    ): Promise<WheelVersion & { option: WheelOption }> {
      const { body, updatedAt } = await send(path(shareId, 'options'), {
        method: 'POST',
        token: editToken,
        body: input,
      })
      return { option: asOption(body), updatedAt }
    },

    /** `DELETE /wheels/{shareId}/options/{optionId}` — remove one. */
    async removeOption(
      shareId: string,
      optionId: string,
      editToken: string,
    ): Promise<WheelVersion> {
      const { updatedAt } = await send(path(shareId, 'options', optionId), {
        method: 'DELETE',
        token: editToken,
      })
      return { updatedAt }
    },

    /** `POST /wheels/{shareId}/suggestions` — participant submission. */
    async submitSuggestion(
      shareId: string,
      input: { label: string },
    ): Promise<WheelVersion & { suggestion: CreatedSuggestion }> {
      const { body, updatedAt } = await send(path(shareId, 'suggestions'), {
        method: 'POST',
        body: input,
      })
      return { suggestion: asCreatedSuggestion(body), updatedAt }
    },

    /**
     * `POST /wheels/{shareId}/suggestions/{id}/accept` — accept into options.
     *
     * Answers 204, so there is no new option ID to learn here. ./optimistic.ts
     * keys the optimistic row on `fromSuggestion` instead, which the accept
     * transaction writes onto the option it creates.
     */
    async acceptSuggestion(
      shareId: string,
      suggestionId: string,
      editToken: string,
    ): Promise<WheelVersion> {
      const { updatedAt } = await send(
        path(shareId, 'suggestions', suggestionId, 'accept'),
        { method: 'POST', token: editToken },
      )
      return { updatedAt }
    },

    /** `DELETE /wheels/{shareId}/suggestions/{id}` — reject, a hard delete. */
    async rejectSuggestion(
      shareId: string,
      suggestionId: string,
      editToken: string,
    ): Promise<WheelVersion> {
      const { updatedAt } = await send(
        path(shareId, 'suggestions', suggestionId),
        {
          method: 'DELETE',
          token: editToken,
        },
      )
      return { updatedAt }
    },
  }
}

/**
 * Read the version the write produced off the response.
 *
 * Anything unusable — absent, not a date, an Invalid Date — becomes null rather
 * than throwing. A malformed header is not a reason to tell the caller their
 * write failed when the status says it did not.
 */
function versionOf(response: Response): Date | null {
  const raw = response.headers.get(WHEEL_VERSION_HEADER)
  if (raw === null) return null

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Read a body without letting a non-JSON response surface as a parse bug.
 *
 * The case this exists for is a platform error page: a Vercel 502 or a proxy's
 * 504 is HTML, and `response.json()` on it throws a `SyntaxError` reading
 * "Unexpected token '<'". A caller seeing that in a toast learns nothing, and
 * whoever debugs it starts by looking for a bug in the parsing rather than for
 * an outage. Returning `undefined` lets `errorFrom` answer with the status,
 * which is the part that was actually informative.
 */
async function readJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    return text === '' ? undefined : (JSON.parse(text) as unknown)
  } catch {
    return undefined
  }
}

/**
 * Build the error for a non-2xx response.
 *
 * Prefers the route's own `error` code, because that is the vocabulary the
 * whole application shares — a caller branching on `options_full` or
 * `suggestions_closed` needs the server's word for it, not a status class.
 */
function errorFrom(status: number, body: unknown): ApiError {
  const raw =
    typeof body === 'object' && body !== null
      ? (body as { error?: unknown; message?: unknown })
      : {}

  const code = typeof raw.error === 'string' ? raw.error : UNEXPECTED_RESPONSE
  const message =
    typeof raw.message === 'string'
      ? raw.message
      : `The server answered ${status}.`

  return new ApiError(status, code, message)
}

/**
 * Validate a success body before handing it on.
 *
 * A 2xx whose body is not the documented shape is not a success — it is a proxy
 * or a rewrite that answered in the route's place. Accepting it would put
 * `undefined` into a URL fragment as an edit token, producing a share link that
 * looks right and opens nothing.
 */
function asCreatedWheel(body: unknown): CreatedWheel {
  const raw = body as Partial<CreatedWheel> | undefined

  if (
    typeof raw?.shareId !== 'string' ||
    typeof raw.editToken !== 'string' ||
    raw.editToken === ''
  ) {
    throw new ApiError(
      200,
      UNEXPECTED_RESPONSE,
      'The wheel may have been created, but the response did not contain an edit link.',
    )
  }

  return { shareId: raw.shareId, editToken: raw.editToken }
}

function asOption(body: unknown): WheelOption {
  const raw = body as Partial<Record<keyof WheelOption, unknown>> | undefined

  if (typeof raw?.id !== 'string' || typeof raw.label !== 'string') {
    throw new ApiError(
      200,
      UNEXPECTED_RESPONSE,
      'The option may have been added, but the response did not identify it.',
    )
  }

  // `addedAt` is ISO 8601 on the wire and a `Date` in the model, so a caller
  // cannot tell whether an option reached it from here or from a snapshot.
  const addedAt =
    typeof raw.addedAt === 'string' ? new Date(raw.addedAt) : new Date(NaN)

  return {
    id: raw.id,
    label: raw.label,
    addedAt: Number.isNaN(addedAt.getTime()) ? null : addedAt,
    fromSuggestion:
      typeof raw.fromSuggestion === 'string' ? raw.fromSuggestion : null,
  }
}

function asCreatedSuggestion(body: unknown): CreatedSuggestion {
  const raw = body as Partial<Record<string, unknown>> | undefined

  if (typeof raw?.id !== 'string' || typeof raw.label !== 'string') {
    throw new ApiError(
      200,
      UNEXPECTED_RESPONSE,
      'The suggestion may have been submitted, but the response did not identify it.',
    )
  }

  return {
    id: raw.id,
    label: raw.label,
    status: isSuggestionStatus(raw.status) ? raw.status : 'pending',
  }
}
