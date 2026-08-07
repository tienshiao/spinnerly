import 'server-only'

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

/**
 * The server half of the read/write split in design doc section 3: every write
 * goes through a route handler using the Admin SDK, which bypasses security
 * rules and does its own authorization against the edit token.
 *
 * `server-only` makes importing this from a Client Component a build error. The
 * module reads FIREBASE_PRIVATE_KEY, so the failure mode it prevents is not a
 * subtle one.
 */

/**
 * Initialisation is lazy and cached on `globalThis` for two separate reasons:
 *
 *   - Hot reload. `next dev` re-evaluates modules on every edit while the Node
 *     process lives on. `initializeApp` at module scope throws "The default
 *     Firebase app already exists" on the second reload, and module-level state
 *     does not survive to prevent it. `globalThis` does.
 *   - Warm lambdas. A serverless invocation reuses the process, so the app and
 *     its gRPC channel are established once and reused across requests rather
 *     than rebuilt per request.
 */
const CACHE_KEY = Symbol.for('spinnerly.firebase.admin')

type Cache = { app?: App; db?: Firestore }

const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Cache
}

globalCache[CACHE_KEY] ??= {}
const cache = globalCache[CACHE_KEY]

/**
 * True when the process is pointed at the Firebase Emulator Suite.
 *
 * This is the single switch between local and cloud (design doc decision 19).
 * The Admin SDK reads FIRESTORE_EMULATOR_HOST itself and, when it is set,
 * skips credential resolution entirely — there is nothing to authenticate
 * against. So the emulator branch below deliberately passes no credential: a
 * service account is not merely unnecessary locally, it is never present.
 */
function usingEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing ${name}. Deployed environments need the service account variables from .env.example; ` +
        'local development should have FIRESTORE_EMULATOR_HOST set instead — run `npm run dev:emulator`.',
    )
  }
  return value
}

/**
 * A service account private key survives two incompatible storage conventions,
 * and the round trip between them is what breaks deployments.
 *
 * The `private_key` field in the service account JSON holds real newlines. An
 * env file cannot, so the convention is to escape them as a backslash followed
 * by `n`. Vercel's dashboard, meanwhile, accepts the real newlines pasted
 * straight from the JSON. A value copied out of Vercel into a local env file
 * therefore arrives with real newlines, and a value copied the other way
 * arrives escaped — either way something is holding the form the other end does
 * not expect.
 *
 * Accepting both costs one line and removes the whole class of "works locally,
 * `error:0909006C:PEM routines:get_name:no start line` in production".
 * Surrounding quotes are stripped for the same reason: some env-file dialects
 * keep them, and `dotenv` does not always.
 *
 * Note what this deliberately does *not* do: trim the value. A PEM key ends in
 * a newline, and `raw.trim()` silently eats it — which is the same class of
 * quiet mangling this function exists to undo. Whitespace is only stripped from
 * outside the quotes, never from the key itself.
 */
export function normalizePrivateKey(raw: string): string {
  const unquoted = raw.replace(/^\s*(['"])([\s\S]*)\1\s*$/, '$2')
  return unquoted.replace(/\\n/g, '\n')
}

function createApp(): App {
  // Reuse an app another module already initialised — belt and braces against
  // the hot-reload duplicate-app throw, since `getApps()` is the SDK's own
  // source of truth rather than ours.
  const existing = getApps()
  if (existing.length > 0) return existing[0]

  if (usingEmulator()) {
    return initializeApp({
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'demo-spinnerly',
    })
  }

  return initializeApp({
    credential: cert({
      projectId: required('FIREBASE_PROJECT_ID'),
      clientEmail: required('FIREBASE_CLIENT_EMAIL'),
      privateKey: normalizePrivateKey(required('FIREBASE_PRIVATE_KEY')),
    }),
  })
}

/** The Admin Firestore handle. Initialised on first use, reused thereafter. */
export function getAdminDb(): Firestore {
  cache.app ??= createApp()
  cache.db ??= getFirestore(cache.app)
  return cache.db
}
