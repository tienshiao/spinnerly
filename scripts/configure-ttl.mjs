/**
 * Apply and verify the Firestore TTL policies. Design doc section 8.
 *
 * A TTL policy names one field of one collection group as that group's
 * expiration time. Firestore then deletes matching documents, typically within
 * 24 hours of the timestamp passing. It is the only cleanup mechanism this
 * application has: there are no accounts, so nobody can ever delete a wheel by
 * hand, and without a policy the collections only grow.
 *
 * **Run this once per environment, before that environment takes real data.** A
 * policy applies to documents as they expire, so configuring it late still
 * reaps — but "late" means a period in which users were told a wheel lives for
 * 30 days while nothing was reaping anything, which is the promise section 8
 * exists to keep.
 *
 *   npm run ttl:configure -- --project spinnerly-prod   # enable what is missing
 *   npm run ttl:check     -- --project spinnerly-prod   # verify; this is the gate
 *
 * **`ttl:configure` does not verify, and cannot.** Enabling is a long-running
 * operation, so it returns with the policies in `CREATING` and Firestore still
 * working through the documents already stored. `ttl:check` reporting `ACTIVE`
 * for every collection group is the only thing that means the job is done. Its
 * exit codes are 0 for covered, 2 for still applying, and 1 for anything that
 * needs a human — so a provisioning script can retry on 2 and stop on 1.
 *
 * Authentication is Application Default Credentials: point
 * GOOGLE_APPLICATION_CREDENTIALS at the service-account JSON that TASK-27 step 4
 * downloads, or be logged in with `gcloud auth application-default login`. The
 * three FIREBASE_* variables the app itself uses are deliberately not accepted —
 * they exist for Vercel's environment UI, and a key pasted through a shell is
 * the one input that fails as an unreadable PEM error.
 *
 * There is no firebase-tools command for this: the CLI covers databases,
 * backups, indexes and deletes, and field-level TTL configuration is not among
 * them. It is also deliberately not left as a gcloud runbook. The policy has to
 * cover three collection groups in each of two projects, and the failure mode of
 * a human missing one of those six is silent — the application behaves
 * identically and the data simply never goes away.
 */

import { pathToFileURL } from 'node:url'

import { applicationDefault, initializeApp } from 'firebase-admin/app'

/**
 * The field every policy acts on, and the collection groups it is applied to.
 *
 * Three groups, not one, and each is load-bearing:
 *
 *  - `wheels` — the wheel itself, the document the whole lifecycle is about.
 *  - `wheelSecrets` — its edit token hash. Without a policy here the secret
 *    outlives its wheel forever, `assertEditor` keeps authorising for a wheel
 *    that has been reaped, and the collection grows without bound. The secret is
 *    written with a margin past the wheel's own expiry so the two are never
 *    reaped in the dangerous order — see SECRET_EXPIRY_MARGIN_DAYS in
 *    lib/wheels/store.ts.
 *  - `suggestions` — the queue. **A TTL delete does not cascade to the deleted
 *    document's subcollections**, so without this a reaped wheel leaves its
 *    whole queue behind: arbitrary user-submitted text with nothing left to
 *    reach it from. A policy is per collection group and covers every instance
 *    of that name in the hierarchy, so this one entry reaps
 *    `wheels/{any}/suggestions`.
 *
 * `spins` is deliberately absent. It is phase 2 (design doc section 9) and
 * nothing writes one yet. Add it here in the same change that first writes a
 * spin, not before.
 *
 * **Exported, and held against lib/wheels/store.ts by a test.** These are the
 * same three collection names the application writes to, restated here because a
 * .mjs script cannot import them — store.ts is TypeScript and pulls in
 * `server-only`, which throws by design. Restating them reintroduces exactly the
 * silent miss this script exists to prevent, one layer up: rename
 * `WHEEL_SECRETS` and this would go on reporting ACTIVE for a collection group
 * nobody writes while the real secrets never expired. scripts/configure-ttl.test.ts
 * is what stops that, and it is the reason these are exports rather than consts.
 */
export const TTL_FIELD = 'expiresAt'
export const COLLECTION_GROUPS = ['wheels', 'wheelSecrets', 'suggestions']

/** The REST resource name of one collection group's TTL field. */
export function fieldResource(projectId, databaseId, collectionGroup) {
  return (
    `projects/${projectId}` +
    `/databases/${encodeURIComponent(databaseId)}` +
    `/collectionGroups/${collectionGroup}` +
    `/fields/${TTL_FIELD}`
  )
}

/**
 * How a state is reported and whether it is the operator's problem.
 *
 * ACTIVE is the only state that counts as covered, and NEEDS_REPAIR is the
 * reason this is not a truthiness check on `ttlConfig`. It means the policy took
 * for newly written documents and failed for the ones already stored — so "is
 * there a ttlConfig?" reports green while the entire existing backlog of wheels
 * quietly never expires.
 *
 * CREATING is separated from both, because it is the state the documented happy
 * path lands in: `ttl:configure` then `ttl:check` will find it, and telling an
 * operator to fix a policy whose only remedy is waiting is how a correct run
 * gets treated as a broken one.
 */
export function classify(state) {
  if (state === 'ACTIVE') return 'covered'
  if (state === 'CREATING') return 'pending'
  return 'broken'
}

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')

  /**
   * Refuse to run anywhere the answer would be meaningless.
   *
   * The inverse of the seed script's guard, and for the same reason. That one
   * refuses to touch anything but the emulator; this one refuses to touch the
   * emulator, because TTL is a cloud-only feature — the emulator serves no
   * field-configuration API and runs no reaper, so there is nothing local for
   * this to configure and nothing local that could verify it.
   */
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      'FIRESTORE_EMULATOR_HOST is set. TTL policies are a cloud-only feature: the\n' +
        'emulator serves no field-configuration API and runs no reaper, so there is\n' +
        'nothing here to configure. Unset it and authenticate against the project you\n' +
        'mean to change.',
    )
    return 1
  }

  const flag = args.indexOf('--project')
  const projectId = flag === -1 ? undefined : args[flag + 1]

  if (!projectId || projectId.startsWith('--')) {
    console.error(
      'Usage: npm run ttl:configure -- --project <projectId>\n\n' +
        'The project is named explicitly and never inferred from the ambient\n' +
        'credential. This writes database configuration, and the two projects are\n' +
        'called things like spinnerly-prod and spinnerly-preview — close enough that\n' +
        'a silent default is how the wrong one gets configured.',
    )
    return 1
  }

  if (projectId.startsWith('demo-')) {
    console.error(
      `Project ID "${projectId}" starts with "demo-", which is the emulator's\n` +
        'reserved prefix rather than a real project. Refusing to run.',
    )
    return 1
  }

  /**
   * The database to configure.
   *
   * `(default)` unless something has deliberately created a named one. A policy
   * is scoped to a database rather than to a project, so a project with two
   * databases needs this run twice — which is why it is a variable rather than
   * inlined.
   */
  const databaseId = process.env.FIRESTORE_DATABASE_ID ?? '(default)'

  const credential = applicationDefault()
  initializeApp({ credential, projectId })

  let accessToken
  try {
    ;({ access_token: accessToken } = await credential.getAccessToken())
  } catch (error) {
    console.error(
      `Could not obtain credentials: ${error.message}\n\n` +
        'Point GOOGLE_APPLICATION_CREDENTIALS at the service-account JSON for this\n' +
        'project, or run `gcloud auth application-default login`.',
    )
    return 1
  }

  async function firestoreAdmin(path, init = {}) {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/${path}`,
      {
        ...init,
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          ...init.headers,
        },
      },
    )

    const body = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(
        `${response.status} ${body?.error?.message ?? response.statusText}`,
      )
    }

    return body
  }

  /**
   * The TTL state of one collection group.
   *
   * `ttlConfig` is absent from the response when no policy is set, which is the
   * only way to tell disabled from enabled — the state enum has no DISABLED
   * member, so there is nothing to compare against.
   */
  async function readState(collectionGroup) {
    const field = await firestoreAdmin(
      fieldResource(projectId, databaseId, collectionGroup),
    )
    return field.ttlConfig?.state ?? 'DISABLED'
  }

  async function enable(collectionGroup) {
    // An empty `ttlConfig` is what enables the policy; the field it acts on is
    // named by the resource path rather than by the body. `updateMask` confines
    // the patch to TTL, leaving any index configuration on the same field alone.
    const operation = await firestoreAdmin(
      `${fieldResource(projectId, databaseId, collectionGroup)}?updateMask=ttlConfig`,
      { method: 'PATCH', body: JSON.stringify({ ttlConfig: {} }) },
    )

    return operation.name
  }

  console.log(
    `${checkOnly ? 'Checking' : 'Configuring'} TTL on ${TTL_FIELD} — ` +
      `project ${projectId}, database ${databaseId}\n`,
  )

  let broken = false
  let pending = false

  for (const collectionGroup of COLLECTION_GROUPS) {
    let state
    try {
      state = await readState(collectionGroup)
    } catch (error) {
      console.error(
        `  ${collectionGroup}: could not be read — ${error.message}`,
      )
      broken = true
      continue
    }

    const verdict = classify(state)

    if (verdict === 'covered') {
      console.log(`  ${collectionGroup}: ACTIVE`)
      continue
    }

    if (verdict === 'pending') {
      // Already on its way, from this run's own patch on a previous invocation
      // or from someone else's. Patching again would start a second operation
      // towards the state the first one is already reaching.
      console.log(`  ${collectionGroup}: CREATING (still applying)`)
      pending = true
      continue
    }

    if (checkOnly) {
      console.error(`  ${collectionGroup}: ${state}`)
      broken = true
      continue
    }

    try {
      console.log(
        `  ${collectionGroup}: ${state} → applying (${await enable(collectionGroup)})`,
      )
      pending = true
    } catch (error) {
      console.error(
        `  ${collectionGroup}: could not be enabled — ${error.message}`,
      )
      broken = true
    }
  }

  if (broken) {
    console.error(
      '\nAt least one collection group is not covered. Nothing in the application\n' +
        'depends on a policy existing, so this fails silently in production: wheels\n' +
        'keep working and simply never go away. Fix it before this environment takes\n' +
        'real data.',
    )
    return 1
  }

  if (pending) {
    console.log(
      '\nStill applying. Enabling a policy is a long-running operation, so the state\n' +
        'reads CREATING until Firestore has worked through the documents already\n' +
        'stored. Nothing is wrong and there is nothing to do but wait — re-run\n' +
        '`npm run ttl:check` until every group reports ACTIVE.',
    )
    return 2
  }

  console.log(
    '\nEvery collection group is covered. Note what this does and does not say: the\n' +
      'policies exist and are active, not that anything has been deleted. Firestore\n' +
      'reaps typically within 24 hours of expiry, and expired documents keep serving\n' +
      'reads until it does (design doc section 8).',
  )
  return 0
}

// Only when run as a command. The constants and pure helpers above are imported
// by scripts/configure-ttl.test.ts, which must not initialise an app, resolve a
// credential or call process.exit as a side effect of importing them.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await main())
}
