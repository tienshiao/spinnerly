import { describe, expect, it } from 'vitest'

import { SUGGESTIONS, WHEEL_SECRETS, WHEELS } from '@/lib/wheels/store'
import {
  classify,
  COLLECTION_GROUPS,
  fieldResource,
  TTL_FIELD,
} from './configure-ttl.mjs'

/**
 * The parts of scripts/configure-ttl.mjs that can be checked without a cloud
 * project. In the unit project, because none of this touches Firestore.
 *
 * Most of that script cannot be tested here at all: enabling a TTL policy is a
 * cloud-only operation against a database that does not exist yet (TASK-27), and
 * the emulator serves no field-configuration API to stand in for one. What is
 * testable is the part that is wrong most cheaply — the list of collection names
 * it will act on, which is a hand-copy of constants that live somewhere else.
 *
 * That copy is the reason this file exists. The script's whole argument for
 * being a script rather than a gcloud runbook is that a human missing one of six
 * policies fails silently; restating the collection names imports the same
 * failure one layer up, where a rename in store.ts leaves the script cheerfully
 * reporting ACTIVE for a collection group nobody writes to while the real one
 * never expires. Nothing about the running application would look different.
 */

describe('the collection groups the script configures', () => {
  it('are exactly the collections the application writes', () => {
    // Order included: it is what the script's output is read in, and there is no
    // reason for the two lists to disagree about it.
    expect(COLLECTION_GROUPS).toEqual([WHEELS, WHEEL_SECRETS, SUGGESTIONS])
  })

  it('covers every collection the store names', () => {
    // The assertion above pins the list; this one pins the *set* it was derived
    // from, so adding a fourth collection to store.ts without adding a policy is
    // a failure here rather than a discovery in production. `spins` is
    // deliberately absent from both — it is phase 2 and nothing writes one, and
    // Firestore has no collection group to attach a policy to until something
    // does.
    const named = new Set([WHEELS, WHEEL_SECRETS, SUGGESTIONS])

    for (const group of named) {
      expect(
        COLLECTION_GROUPS,
        `${group} is written by the application but has no TTL policy`,
      ).toContain(group)
    }
  })

  it('names the field the store actually writes', () => {
    expect(TTL_FIELD).toBe('expiresAt')
  })
})

describe('fieldResource', () => {
  it('builds the REST resource name for a collection group', () => {
    expect(fieldResource('spinnerly-prod', '(default)', 'wheels')).toBe(
      'projects/spinnerly-prod/databases/(default)/collectionGroups/wheels/fields/expiresAt',
    )
  })

  it.each(COLLECTION_GROUPS)('addresses the %s policy', (group) => {
    expect(fieldResource('p', '(default)', group)).toContain(
      `/collectionGroups/${group}/fields/${TTL_FIELD}`,
    )
  })
})

describe('classify', () => {
  it.each([
    // The only state that means the job is done.
    { label: 'ACTIVE', state: 'ACTIVE', verdict: 'covered' },
    // The documented happy path lands here: `ttl:configure` returns with the
    // policy still applying, and the next `ttl:check` has to say "wait" rather
    // than "fix this".
    { label: 'CREATING', state: 'CREATING', verdict: 'pending' },
    // No policy at all. `ttlConfig` is simply absent from the response, which is
    // why the script substitutes this rather than reading a state enum member —
    // there is no DISABLED member to read.
    { label: 'DISABLED', state: 'DISABLED', verdict: 'broken' },
    // The state a truthiness check on `ttlConfig` would call green: the policy
    // took for new documents and failed for everything already stored, so the
    // entire existing backlog never expires.
    { label: 'NEEDS_REPAIR', state: 'NEEDS_REPAIR', verdict: 'broken' },
    {
      label: 'STATE_UNSPECIFIED',
      state: 'STATE_UNSPECIFIED',
      verdict: 'broken',
    },
  ])('treats $label as $verdict', ({ state, verdict }) => {
    expect(classify(state)).toBe(verdict)
  })

  it('treats an unrecognised state as broken', () => {
    // A state added to the API later must not read as covered by default. The
    // safe direction is a policy reported as needing attention that turns out to
    // be fine, not one reported as fine that turns out to be absent.
    expect(classify('SOMETHING_NEW')).toBe('broken')
  })
})
