import 'client-only'

import { getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'

/**
 * The read half of the split in design doc section 3. The browser talks to
 * Firestore directly, but only ever to read: live `onSnapshot` listeners are
 * the entire reason this app is on Firestore rather than Postgres.
 *
 * The client has no write path, and that is enforced in three independent
 * places rather than asserted once:
 *
 *   - Security rules deny every client write (design doc section 5).
 *   - `spinnerly/no-client-firestore-writes` fails lint on importing any write
 *     function from `firebase/firestore`, so the mistake does not survive to a
 *     review, let alone to runtime.
 *   - This module exports a Firestore handle and nothing that writes.
 *
 * `client-only` makes importing this from a Server Component a build error.
 * Nothing here is secret — the config below is public by design — but a server
 * import would mean a read path that silently bypasses the realtime layer.
 */

type Cache = { app?: FirebaseApp; db?: Firestore }

/**
 * Cached on `globalThis` for the same hot-reload reason as the Admin SDK:
 * `next dev` re-evaluates the module while the page lives on, and
 * `connectFirestoreEmulator` throws if it runs against a Firestore instance
 * that has already issued a call.
 */
const CACHE_KEY = Symbol.for('spinnerly.firebase.client')

const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: Cache
}

globalCache[CACHE_KEY] ??= {}
const cache = globalCache[CACHE_KEY]

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. It is inlined at build time, so it must be present when the app is built, ` +
        'not merely at runtime. See .env.example.',
    )
  }
  return value
}

/**
 * Each `process.env.NEXT_PUBLIC_*` is written out as a complete property access
 * because that literal form is what Next.js substitutes at build time. A
 * computed lookup — `process.env[name]` — survives the transform untouched and
 * becomes a runtime read of an object the browser does not have.
 */
function createApp(): FirebaseApp {
  const existing = getApps()
  if (existing.length > 0) return existing[0]

  return initializeApp({
    apiKey: required(
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    ),
    projectId: required(
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    ),
    // Optional, and absent locally. App Check wants it (TASK-24).
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  })
}

/**
 * Split `host:port`, rejecting anything that is not both.
 *
 * `connectFirestoreEmulator(db, host, NaN)` does not throw — it produces a
 * client that quietly never reaches the emulator, which looks exactly like an
 * empty database. Since `.env.local` is explicitly invited to override this
 * value, a bare `localhost` with no port is a plausible typo, and so is an
 * IPv6 form that a naive `split(':')` would tear in half.
 */
function parseEmulatorHost(value: string): { host: string; port: number } {
  const separator = value.lastIndexOf(':')
  const host = value.slice(0, separator)
  const port = Number(value.slice(separator + 1))

  if (separator <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `NEXT_PUBLIC_FIREBASE_EMULATOR_HOST must be host:port, got "${value}". ` +
        'An unparseable value would leave the client pointed away from the emulator, ' +
        'which reads as an empty database rather than as an error.',
    )
  }
  return { host, port }
}

/**
 * The read-only Firestore handle.
 *
 * `connectFirestoreEmulator` has to run before the instance issues any other
 * call or it throws, which is why it happens here, inside the same lazy
 * initialisation that creates the instance, rather than at module scope or in a
 * provider component. There is no window in which a caller can get an
 * unconnected handle.
 *
 * Note that `cache.db` is set only after a successful connect, so a failure
 * here throws again on every subsequent call rather than being papered over.
 * That is the intended behaviour: caching the handle first would make the next
 * caller receive a working-looking client aimed at the wrong Firestore, and a
 * loud repeated error beats a silent wrong target.
 */
export function getClientDb(): Firestore {
  if (cache.db) return cache.db

  cache.app ??= createApp()
  const db = getFirestore(cache.app)

  const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST
  if (emulatorHost) {
    const { host, port } = parseEmulatorHost(emulatorHost)
    try {
      connectFirestoreEmulator(db, host, port)
    } catch (cause) {
      throw new Error(
        `Could not point the client SDK at the emulator on ${host}:${port}. ` +
          'connectFirestoreEmulator must run before the Firestore instance issues any other call, ' +
          'so something reached getFirestore() outside this module.',
        { cause },
      )
    }
  }

  cache.db = db
  return db
}
