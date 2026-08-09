import { describe, expect, it } from 'vitest'

import type { Suggestion, Wheel, WheelOption } from './model'
import {
  hasLanded,
  isOptimisticId,
  newMutationKey,
  pendingReducer,
  project,
  retireLanded,
  type LiveState,
  type Mutation,
  type PendingAction,
  type PendingEntry,
} from './optimistic'

/**
 * The reconciliation, which is the part of the client data path that decides
 * whether editing feels instant or feels broken.
 *
 * Two properties carry most of the weight, and both are about what is on
 * screen BETWEEN a click and the snapshot that confirms it:
 *
 *  1. Never two rows for one thing. The optimistic row and the real one must
 *     not overlap.
 *  2. Never zero rows for one thing. The optimistic row must not be retired
 *     until the real one has arrived — retiring on the HTTP response is the
 *     flicker this module exists to prevent, and it is the implementation
 *     anyone would write first.
 *
 * The `walks` helper below asserts both across a whole timeline rather than at
 * a chosen moment, because the bug in each case is a single frame.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const SUGGESTION_ID = 'sUgGeStIoNiDaBcDeFgH'

function option(id: string, extra: Partial<WheelOption> = {}): WheelOption {
  return {
    id,
    label: id,
    addedAt: new Date('2026-08-01T10:00:00.000Z'),
    fromSuggestion: null,
    ...extra,
  }
}

function wheel(extra: Partial<Wheel> = {}): Wheel {
  return {
    shareId: SHARE_ID,
    title: 'Lunch Friday',
    options: [],
    suggestionsOpen: true,
    createdAt: null,
    updatedAt: null,
    expiresAt: null,
    ...extra,
  }
}

function suggestion(id: string, extra: Partial<Suggestion> = {}): Suggestion {
  return {
    id,
    label: id,
    status: 'pending',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    expiresAt: null,
    ...extra,
  }
}

function live(extra: Partial<LiveState> = {}): LiveState {
  return { wheel: wheel(), suggestions: [], queueSeq: 1, ...extra }
}

/**
 * Three instants that stand in for "before our write", "our write" and "someone
 * else's write, after ours". Every version assertion is one of the six
 * comparisons between them.
 */
const BEFORE = new Date('2026-08-01T10:00:00.000Z')
const OURS = new Date('2026-08-01T10:00:01.000Z')
const AFTER = new Date('2026-08-01T10:00:02.000Z')

/** A wheel whose stored version is `at`. */
const wheelAt = (at: Date | null, extra: Partial<Wheel> = {}): Wheel =>
  wheel({ updatedAt: at, ...extra })

/** An entry as it exists between the click and the response. */
function inFlight(mutation: Mutation, key = 'local:1'): PendingEntry {
  return { key, mutation, startedAt: 1_000, settled: null, slow: false }
}

/** The same entry once the server has answered. */
function settled(
  entry: PendingEntry,
  settlement: {
    serverId?: string
    wheelUpdatedAt?: Date | null
    queueSeq?: number
  } = {},
): PendingEntry {
  return {
    ...entry,
    settled: {
      serverId: settlement.serverId,
      // `OURS` unless a case says otherwise, so a fixture never accidentally
      // reads as "no version" — the degraded path has its own cases.
      wheelUpdatedAt:
        'wheelUpdatedAt' in settlement
          ? (settlement.wheelUpdatedAt ?? null)
          : OURS,
      queueSeq: settlement.queueSeq ?? 1,
    },
  }
}

const labelsOf = (state: LiveState, entries: PendingEntry[]): string[] =>
  project(state, entries).wheel?.options.map((row) => row.label) ?? []

const queueOf = (state: LiveState, entries: PendingEntry[]): string[] =>
  project(state, entries).suggestions.map((row) => row.label)

/**
 * Assert an invariant holds at EVERY step of a timeline, not just at the end.
 *
 * Each frame is reconciled first, exactly as ./use-wheel-session.ts does on
 * every snapshot, so a step that should have retired an entry actually has.
 */
function walks(
  frames: { at: string; live: LiveState; entries: PendingEntry[] }[],
  invariant: (state: LiveState, entries: PendingEntry[]) => void,
): void {
  for (const frame of frames) {
    const reconciled = retireLanded(frame.entries, frame.live)
    try {
      invariant(frame.live, reconciled)
    } catch (failure) {
      throw new Error(`invariant broke at "${frame.at}": ${String(failure)}`)
    }
  }
}

describe('hasLanded', () => {
  it.each([
    { label: 'an add', mutation: { kind: 'add-option', label: 'Tacos' } },
    { label: 'a remove', mutation: { kind: 'remove-option', optionId: 'o1' } },
    {
      label: 'a submit',
      mutation: { kind: 'submit-suggestion', label: 'Ramen' },
    },
    {
      label: 'a reject',
      mutation: { kind: 'reject-suggestion', suggestionId: SUGGESTION_ID },
    },
    {
      label: 'an accept',
      mutation: {
        kind: 'accept-suggestion',
        suggestionId: SUGGESTION_ID,
        label: 'Ramen',
      },
    },
    {
      label: 'a patch',
      mutation: { kind: 'patch-wheel', patch: { title: 'X' } },
    },
  ] satisfies { label: string; mutation: Mutation }[])(
    'never lands $label that has not settled',
    ({ mutation }) => {
      // Even against a snapshot that satisfies the predicate: without a
      // settlement there is nothing to recognise, and a second editor doing the
      // same thing would otherwise retire our entry before our own write
      // returned.
      const state = live({
        wheel: wheel({
          title: 'X',
          options: [option('o1', { fromSuggestion: SUGGESTION_ID })],
        }),
        suggestions: [suggestion(SUGGESTION_ID, { status: 'accepted' })],
      })

      expect(hasLanded(inFlight(mutation), state)).toBe(false)
    },
  )

  describe('add-option', () => {
    const entry = settled(inFlight({ kind: 'add-option', label: 'Tacos' }), {
      serverId: 'server-1',
    })

    it('lands when the returned ID is in the live options', () => {
      expect(
        hasLanded(
          entry,
          live({ wheel: wheel({ options: [option('server-1')] }) }),
        ),
      ).toBe(true)
    })

    it('does not land on a different option arriving', () => {
      expect(
        hasLanded(
          entry,
          live({ wheel: wheel({ options: [option('other')] }) }),
        ),
      ).toBe(false)
    })

    /**
     * The case a label-keyed implementation gets wrong. Two editors adding
     * "Tacos" at the same moment is ordinary under design doc section 2, and
     * matching on the label would retire the first editor's entry against the
     * second's option — leaving one row on screen where there are two.
     */
    it('does not land on an identical label with a different ID', () => {
      expect(
        hasLanded(
          entry,
          live({
            wheel: wheel({
              options: [option('someone-else', { label: 'Tacos' })],
            }),
          }),
        ),
      ).toBe(false)
    })
  })

  describe('remove-option', () => {
    const entry = settled(inFlight({ kind: 'remove-option', optionId: 'o1' }))

    it('does not land while the option is still there', () => {
      expect(
        hasLanded(entry, live({ wheel: wheel({ options: [option('o1')] }) })),
      ).toBe(false)
    })

    it('lands once the option is gone', () => {
      expect(hasLanded(entry, live())).toBe(true)
    })

    it('lands when the whole wheel is gone', () => {
      expect(hasLanded(entry, live({ wheel: null }))).toBe(true)
    })
  })

  describe('submit-suggestion and reject-suggestion', () => {
    it('a submit lands when the returned ID is in the queue', () => {
      const entry = settled(
        inFlight({ kind: 'submit-suggestion', label: 'Ramen' }),
        { serverId: SUGGESTION_ID },
      )

      expect(hasLanded(entry, live())).toBe(false)
      expect(
        hasLanded(entry, live({ suggestions: [suggestion(SUGGESTION_ID)] })),
      ).toBe(true)
    })

    it('a reject lands when the row is gone', () => {
      const entry = settled(
        inFlight({ kind: 'reject-suggestion', suggestionId: SUGGESTION_ID }),
      )

      expect(
        hasLanded(entry, live({ suggestions: [suggestion(SUGGESTION_ID)] })),
      ).toBe(false)
      expect(hasLanded(entry, live())).toBe(true)
    })
  })

  describe('accept-suggestion', () => {
    const entry = settled(
      inFlight({
        kind: 'accept-suggestion',
        suggestionId: SUGGESTION_ID,
        label: 'Ramen',
      }),
    )

    const accepted = option('server-1', { fromSuggestion: SUGGESTION_ID })

    /**
     * Accept touches two documents, which reach this client as two independent
     * snapshots. Both halves are required precisely because either can arrive
     * first, and retiring on one would show the other half's stale state — a
     * queue row flipping back to pending, or an option briefly missing.
     */
    it.each([
      {
        label: 'neither half has arrived',
        state: live({ suggestions: [suggestion(SUGGESTION_ID)] }),
        expected: false,
      },
      {
        label: 'the option arrived but the row is still pending',
        state: live({
          wheel: wheel({ options: [accepted] }),
          suggestions: [suggestion(SUGGESTION_ID)],
        }),
        expected: false,
      },
      {
        label: 'the row is accepted but the option has not arrived',
        state: live({
          suggestions: [suggestion(SUGGESTION_ID, { status: 'accepted' })],
        }),
        expected: false,
      },
      {
        label: 'both halves have arrived',
        state: live({
          wheel: wheel({ options: [accepted] }),
          suggestions: [suggestion(SUGGESTION_ID, { status: 'accepted' })],
        }),
        expected: true,
      },
    ])('lands when $label: $expected', ({ state, expected }) => {
      expect(hasLanded(entry, state)).toBe(expected)
    })

    it('is not satisfied by an option from a different suggestion', () => {
      expect(
        hasLanded(
          entry,
          live({
            wheel: wheel({
              options: [option('x', { fromSuggestion: 'another-suggestion' })],
            }),
            suggestions: [suggestion(SUGGESTION_ID, { status: 'accepted' })],
          }),
        ),
      ).toBe(false)
    })
  })

  describe('patch-wheel', () => {
    const entry = settled(
      inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }),
    )

    it('lands when the value we asked for is the value that is there', () => {
      // Value is the early signal: it retires the patch the instant its own
      // snapshot arrives, without waiting to compare versions.
      expect(
        hasLanded(entry, live({ wheel: wheelAt(BEFORE, { title: 'Dinner' }) })),
      ).toBe(true)
    })

    it('does not land while the old value is there and the version is behind', () => {
      expect(
        hasLanded(entry, live({ wheel: wheelAt(BEFORE, { title: 'Lunch' }) })),
      ).toBe(false)
    })

    /**
     * The case value alone cannot cover. A second editor's later write means our
     * title is applied and immediately overwritten, so the value we asked for
     * never appears — without the version the overlay would show our title
     * forever, on a wheel that is called something else for everyone.
     */
    it('lands when another editor wrote after us', () => {
      expect(
        hasLanded(entry, live({ wheel: wheelAt(AFTER, { title: 'Brunch' }) })),
      ).toBe(true)
    })

    /**
     * The bug the version replaced a snapshot counter to fix. A delivery that
     * arrives after our response can still be a version generated BEFORE our
     * commit — another write landing in the window just before ours, whose
     * snapshot is slower than a full API round trip. A counter cannot tell the
     * two apart and retires here; a version can, and does not.
     */
    it('does not land on a newer snapshot that still predates our write', () => {
      expect(
        hasLanded(
          entry,
          live({ wheel: wheelAt(BEFORE, { title: 'Someone else’s title' }) }),
        ),
        'retired against a snapshot generated before our own commit',
      ).toBe(false)
    })

    it('lands on the snapshot our own write produced', () => {
      // Equality, not merely "greater": `settled.wheelUpdatedAt` is the value
      // the route told us it stored, so this is the exact document our write
      // made.
      expect(
        hasLanded(entry, live({ wheel: wheelAt(OURS, { title: 'Lunch' }) })),
      ).toBe(true)
    })

    it('needs every field of the patch to match, when matching on value', () => {
      const both = settled(
        inFlight({
          kind: 'patch-wheel',
          patch: { title: 'Dinner', suggestionsOpen: false },
        }),
      )

      expect(
        hasLanded(
          both,
          live({
            wheel: wheelAt(BEFORE, { title: 'Dinner', suggestionsOpen: true }),
          }),
        ),
        'the title matched but the kill switch did not',
      ).toBe(false)

      expect(
        hasLanded(
          both,
          live({
            wheel: wheelAt(BEFORE, { title: 'Dinner', suggestionsOpen: false }),
          }),
        ),
      ).toBe(true)
    })

    it('lands when the wheel is gone, since there is nothing left to patch', () => {
      expect(hasLanded(entry, live({ wheel: null }))).toBe(true)
    })
  })

  /**
   * The version is evidence a response may simply not carry — a proxy that
   * strips unknown headers, an older deployment answering mid-rollout. Losing it
   * must never retire something early; it costs only the ability to conclude
   * "and the answer is no".
   */
  describe('without a version', () => {
    const noVersion = { wheelUpdatedAt: null }

    it('still lands an add on the ID arriving', () => {
      const entry = settled(inFlight({ kind: 'add-option', label: 'Tacos' }), {
        ...noVersion,
        serverId: 'server-1',
      })

      expect(
        hasLanded(
          entry,
          live({ wheel: wheelAt(AFTER, { options: [option('server-1')] }) }),
        ),
      ).toBe(true)
    })

    it('does not land an add on a caught-up wheel it cannot compare', () => {
      const entry = settled(inFlight({ kind: 'add-option', label: 'Tacos' }), {
        ...noVersion,
        serverId: 'server-1',
      })

      expect(hasLanded(entry, live({ wheel: wheelAt(AFTER) }))).toBe(false)
    })

    it('leaves a patch on value alone', () => {
      const entry = settled(
        inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }),
        noVersion,
      )

      expect(
        hasLanded(entry, live({ wheel: wheelAt(AFTER, { title: 'Brunch' }) })),
        'retired on a version it never received',
      ).toBe(false)
      expect(
        hasLanded(entry, live({ wheel: wheelAt(BEFORE, { title: 'Dinner' }) })),
      ).toBe(true)
    })
  })

  /**
   * The wheel document carries a version; the suggestions collection cannot.
   * So a queue mutation needs the wheel to have caught up AND its own listener
   * to have delivered since — otherwise an optimistic row would vanish the
   * moment the wheel advanced and reappear when the queue arrived, which is the
   * flicker again in the other panel.
   */
  describe('the queue needs a delivery of its own', () => {
    const submit = settled(
      inFlight({ kind: 'submit-suggestion', label: 'Ramen' }),
      { serverId: SUGGESTION_ID, queueSeq: 1 },
    )

    it.each([
      {
        label: 'neither the wheel nor the queue has moved',
        state: () => live({ wheel: wheelAt(BEFORE), queueSeq: 1 }),
        expected: false,
      },
      {
        label: 'the wheel caught up but the queue has not delivered',
        state: () => live({ wheel: wheelAt(OURS), queueSeq: 1 }),
        expected: false,
      },
      {
        label: 'the queue delivered but the wheel is behind',
        state: () => live({ wheel: wheelAt(BEFORE), queueSeq: 2 }),
        expected: false,
      },
      {
        label: 'both have moved and the row is not there',
        state: () => live({ wheel: wheelAt(OURS), queueSeq: 2 }),
        expected: true,
      },
    ])('lands when $label: $expected', ({ state, expected }) => {
      expect(hasLanded(submit, state())).toBe(expected)
    })

    /**
     * The stranded row this replaced. A suggestion submitted and rejected
     * inside one round trip may never appear in any snapshot this client
     * receives, because Firestore does not promise to deliver every
     * intermediate version. On identity alone the entry waited forever: a
     * phantom row, a pendingCount that never returned to zero, and a slow
     * affordance with nothing behind it.
     */
    it('clears a suggestion that was created and deleted unseen', () => {
      const state = live({
        wheel: wheelAt(AFTER),
        queueSeq: 2,
        suggestions: [],
      })

      expect(hasLanded(submit, state), 'the phantom row is back').toBe(true)
      expect(project(state, [submit]).suggestions).toEqual([])
      expect(project(state, [submit]).pendingCount).toBe(0)
    })

    it('clears an option that was added and removed unseen', () => {
      const add = settled(inFlight({ kind: 'add-option', label: 'Tacos' }), {
        serverId: 'server-1',
      })
      const state = live({ wheel: wheelAt(AFTER, { options: [] }) })

      expect(hasLanded(add, state)).toBe(true)
      expect(project(state, [add]).wheel?.options).toEqual([])
    })

    it('still lands a reject on the row being gone, with no queue delivery', () => {
      // Identity remains the earliest signal for every queue mutation. Only the
      // negative conclusion needs the extra evidence.
      const reject = settled(
        inFlight({ kind: 'reject-suggestion', suggestionId: SUGGESTION_ID }),
        { queueSeq: 1 },
      )

      expect(
        hasLanded(reject, live({ wheel: wheelAt(BEFORE), queueSeq: 1 })),
      ).toBe(true)
    })

    /**
     * Reject takes identity ALONE, unlike its two neighbours, and the asymmetry
     * is the point. Deleting the row means every snapshot at or after the
     * commit lacks it, so identity is guaranteed to arrive and there is no
     * negative conclusion left for a version to reach. Carrying the fallback
     * anyway would only widen the window in which a queue delivery generated
     * before the commit — `queueMoved` is a count, not a version — retires the
     * entry and flickers the rejected row back.
     */
    it('does not retire a reject early on a stale queue delivery', () => {
      const reject = settled(
        inFlight({ kind: 'reject-suggestion', suggestionId: SUGGESTION_ID }),
        { queueSeq: 1 },
      )
      const stale = live({
        wheel: wheelAt(AFTER),
        queueSeq: 2,
        suggestions: [suggestion(SUGGESTION_ID)],
      })

      expect(
        hasLanded(reject, stale),
        'retired while the row it deleted was still on screen',
      ).toBe(false)
      expect(project(stale, [reject]).suggestions).toEqual([])
    })
  })
})

describe('retireLanded', () => {
  it('returns the identical array when nothing is retired', () => {
    // Not a micro-optimisation: ./use-wheel-session.ts reconciles from an
    // effect whose dependencies include this array, so a fresh one every time
    // is an infinite render loop.
    const entries = [inFlight({ kind: 'add-option', label: 'Tacos' })]
    expect(retireLanded(entries, live())).toBe(entries)
  })

  it('returns a new array when something is retired', () => {
    const entries = [
      settled(inFlight({ kind: 'add-option', label: 'Tacos' }), {
        serverId: 'server-1',
      }),
    ]
    const state = live({ wheel: wheel({ options: [option('server-1')] }) })

    expect(retireLanded(entries, state)).toEqual([])
  })
})

describe('project — adding an option', () => {
  const mutation: Mutation = { kind: 'add-option', label: 'Tacos' }

  it('shows the row from the click, before the server has answered', () => {
    const view = project(live(), [inFlight(mutation)])

    expect(view.wheel?.options).toHaveLength(1)
    expect(view.wheel?.options[0].label).toBe('Tacos')
    expect(view.wheel?.options[0].optimistic).toBe(true)
    expect(isOptimisticId(view.wheel?.options[0].id ?? '')).toBe(true)
  })

  /**
   * The whole point, as a timeline. A row appears on the click and there is
   * exactly one of it at every step afterwards — including the step between the
   * 201 and the snapshot, which is where retiring on the response goes wrong.
   */
  it('never shows zero rows or two, from click to snapshot', () => {
    const entry = inFlight(mutation)
    const arrived = live({
      wheel: wheel({ options: [option('server-1', { label: 'Tacos' })] }),
    })

    walks(
      [
        { at: 'the click', live: live(), entries: [entry] },
        {
          at: 'the 201, before the snapshot',
          live: live(),
          entries: [settled(entry, { serverId: 'server-1' })],
        },
        {
          at: 'the snapshot',
          live: arrived,
          entries: [settled(entry, { serverId: 'server-1' })],
        },
        { at: 'steady state', live: arrived, entries: [] },
      ],
      (state, entries) => {
        expect(labelsOf(state, entries)).toEqual(['Tacos'])
      },
    )
  })

  it('leaves one real row once the snapshot has arrived', () => {
    const arrived = live({
      wheel: wheel({ options: [option('server-1', { label: 'Tacos' })] }),
    })
    const entries = retireLanded(
      [settled(inFlight(mutation), { serverId: 'server-1' })],
      arrived,
    )
    const view = project(arrived, entries)

    expect(view.wheel?.options).toHaveLength(1)
    expect(view.wheel?.options[0].optimistic).toBe(false)
    expect(view.wheel?.options[0].id).toBe('server-1')
  })

  it('appends, where arrayUnion will put the real one', () => {
    // Design doc section 6: `arrayUnion` appends and Firestore preserves array
    // order, so the optimistic row is already where the snapshot will place it
    // and the list does not reshuffle on reconcile.
    const state = live({ wheel: wheel({ options: [option('first')] }) })
    expect(labelsOf(state, [inFlight(mutation)])).toEqual(['first', 'Tacos'])
  })

  it('shows both rows when two adds are outstanding', () => {
    const view = project(live(), [
      inFlight({ kind: 'add-option', label: 'Tacos' }, 'local:1'),
      inFlight({ kind: 'add-option', label: 'Pizza' }, 'local:2'),
    ])

    expect(view.wheel?.options.map((row) => row.label)).toEqual([
      'Tacos',
      'Pizza',
    ])
    expect(new Set(view.wheel?.options.map((row) => row.id)).size).toBe(2)
  })

  it('drops the row when the mutation fails', () => {
    const entries = pendingReducer([inFlight(mutation)], {
      type: 'fail',
      key: 'local:1',
    })
    expect(labelsOf(live(), entries)).toEqual([])
  })

  it('invents no timestamp for a row the server has not stored', () => {
    // A fabricated `addedAt` is a value some later feature would sort by
    // without knowing where it came from.
    expect(
      project(live(), [inFlight(mutation)]).wheel?.options[0].addedAt,
    ).toBeNull()
  })
})

describe('project — removing an option', () => {
  const state = live({
    wheel: wheel({ options: [option('o1', { label: 'Tacos' }), option('o2')] }),
  })
  const mutation: Mutation = { kind: 'remove-option', optionId: 'o1' }

  it('hides the row from the click', () => {
    expect(labelsOf(state, [inFlight(mutation)])).toEqual(['o2'])
  })

  it('never shows the row again between the click and the snapshot', () => {
    const entry = inFlight(mutation)
    const gone = live({
      wheel: wheel({ options: [option('o2')] }),
    })

    walks(
      [
        { at: 'the click', live: state, entries: [entry] },
        { at: 'the 204', live: state, entries: [settled(entry)] },
        { at: 'the snapshot', live: gone, entries: [settled(entry)] },
        { at: 'steady state', live: gone, entries: [] },
      ],
      (frameState, entries) => {
        expect(labelsOf(frameState, entries)).toEqual(['o2'])
      },
    )
  })

  it('restores the row when the mutation fails', () => {
    const entries = pendingReducer([inFlight(mutation)], {
      type: 'fail',
      key: 'local:1',
    })
    expect(labelsOf(state, entries)).toEqual(['Tacos', 'o2'])
  })
})

describe('project — accepting a suggestion', () => {
  const mutation: Mutation = {
    kind: 'accept-suggestion',
    suggestionId: SUGGESTION_ID,
    label: 'Ramen',
  }
  const queued = live({
    suggestions: [suggestion(SUGGESTION_ID, { label: 'Ramen' })],
  })

  it('adds the option and marks the queue row accepted at once', () => {
    const view = project(queued, [inFlight(mutation)])

    expect(view.wheel?.options.map((row) => row.label)).toEqual(['Ramen'])
    expect(view.wheel?.options[0].fromSuggestion).toBe(SUGGESTION_ID)
    expect(view.suggestions[0].status).toBe('accepted')
    expect(view.suggestions[0].pending).toBe(true)
    expect(view.suggestions[0].optimistic).toBe(false)
  })

  /**
   * The half-landed frame, and the reason `fromSuggestion` is on the projected
   * row at all. The wheel snapshot can arrive before the suggestion one, and
   * without the filter that keys on it, the optimistic option would be drawn
   * next to the real option it just became.
   */
  it('never shows the option twice while only one half has arrived', () => {
    const entry = settled(inFlight(mutation))
    const optionArrived = live({
      wheel: wheel({
        options: [
          option('server-1', { label: 'Ramen', fromSuggestion: SUGGESTION_ID }),
        ],
      }),
      suggestions: [suggestion(SUGGESTION_ID, { label: 'Ramen' })],
    })
    const bothArrived = live({
      wheel: optionArrived.wheel,
      suggestions: [
        suggestion(SUGGESTION_ID, { label: 'Ramen', status: 'accepted' }),
      ],
    })

    walks(
      [
        { at: 'the click', live: queued, entries: [inFlight(mutation)] },
        { at: 'the 204', live: queued, entries: [entry] },
        {
          at: 'the wheel snapshot only',
          live: optionArrived,
          entries: [entry],
        },
        { at: 'both snapshots', live: bothArrived, entries: [entry] },
        { at: 'steady state', live: bothArrived, entries: [] },
      ],
      (state, entries) => {
        const view = project(state, entries)
        expect(view.wheel?.options.map((row) => row.label)).toEqual(['Ramen'])
        expect(view.suggestions.map((row) => row.status)).toEqual(['accepted'])
      },
    )
  })

  it('restores the pending row when the accept fails', () => {
    const entries = pendingReducer([inFlight(mutation)], {
      type: 'fail',
      key: 'local:1',
    })
    const view = project(queued, entries)

    expect(view.wheel?.options).toEqual([])
    expect(view.suggestions[0].status).toBe('pending')
    expect(view.suggestions[0].pending).toBe(false)
  })
})

describe('project — the suggestion queue', () => {
  it('shows a submitted row from the click, at the end of the queue', () => {
    const state = live({
      suggestions: [suggestion('existing', { label: 'Tacos' })],
    })
    const view = project(state, [
      inFlight({ kind: 'submit-suggestion', label: 'Ramen' }),
    ])

    expect(view.suggestions.map((row) => row.label)).toEqual(['Tacos', 'Ramen'])
    expect(view.suggestions[1].optimistic).toBe(true)
    expect(view.suggestions[1].status).toBe('pending')
  })

  it('never shows a submitted row twice or not at all', () => {
    const entry = inFlight({ kind: 'submit-suggestion', label: 'Ramen' })
    const arrived = live({
      suggestions: [suggestion(SUGGESTION_ID, { label: 'Ramen' })],
    })

    walks(
      [
        { at: 'the click', live: live(), entries: [entry] },
        {
          at: 'the 201',
          live: live(),
          entries: [settled(entry, { serverId: SUGGESTION_ID })],
        },
        {
          at: 'the snapshot',
          live: arrived,
          entries: [settled(entry, { serverId: SUGGESTION_ID })],
        },
        { at: 'steady state', live: arrived, entries: [] },
      ],
      (state, entries) => {
        expect(queueOf(state, entries)).toEqual(['Ramen'])
      },
    )
  })

  it('hides a rejected row from the click and never restores it', () => {
    const entry = inFlight({
      kind: 'reject-suggestion',
      suggestionId: SUGGESTION_ID,
    })
    const present = live({ suggestions: [suggestion(SUGGESTION_ID)] })

    walks(
      [
        { at: 'the click', live: present, entries: [entry] },
        { at: 'the 204', live: present, entries: [settled(entry)] },
        { at: 'the snapshot', live: live(), entries: [settled(entry)] },
      ],
      (state, entries) => {
        expect(queueOf(state, entries)).toEqual([])
      },
    )
  })
})

describe('project — patching the wheel', () => {
  it('shows the new title before the server confirms it', () => {
    const view = project(live(), [
      inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }),
    ])

    expect(view.wheel?.title).toBe('Dinner')
    expect(view.saving.title).toBe(true)
    expect(view.saving.suggestionsOpen).toBe(false)
  })

  it('shows the kill switch closed before the server confirms it', () => {
    const view = project(live(), [
      inFlight({ kind: 'patch-wheel', patch: { suggestionsOpen: false } }),
    ])

    expect(view.wheel?.suggestionsOpen).toBe(false)
    expect(view.saving.suggestionsOpen).toBe(true)
    expect(view.saving.title).toBe(false)
  })

  it('lets the last of two rapid toggles win, as the server will', () => {
    const view = project(live(), [
      inFlight(
        { kind: 'patch-wheel', patch: { suggestionsOpen: false } },
        'local:1',
      ),
      inFlight(
        { kind: 'patch-wheel', patch: { suggestionsOpen: true } },
        'local:2',
      ),
    ])

    expect(view.wheel?.suggestionsOpen).toBe(true)
  })

  it('leaves untouched fields alone', () => {
    const state = live({
      wheel: wheel({ title: 'Lunch', suggestionsOpen: true }),
    })
    const view = project(state, [
      inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }),
    ])

    expect(view.wheel?.suggestionsOpen).toBe(true)
  })

  it('never shows the old title again between the click and the snapshot', () => {
    const entry = inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } })
    const before = live({ wheel: wheelAt(BEFORE, { title: 'Lunch' }) })
    const after = live({ wheel: wheelAt(OURS, { title: 'Dinner' }) })

    walks(
      [
        { at: 'the click', live: before, entries: [entry] },
        {
          at: 'the 204',
          live: before,
          entries: [settled(entry)],
        },
        {
          at: 'the snapshot',
          live: after,
          entries: [settled(entry)],
        },
        { at: 'steady state', live: after, entries: [] },
      ],
      (state, entries) => {
        expect(project(state, entries).wheel?.title).toBe('Dinner')
      },
    )
  })

  it('yields to a concurrent editor once the server has moved on', () => {
    const entry = settled(
      inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }),
    )
    const overwritten = live({ wheel: wheelAt(AFTER, { title: 'Brunch' }) })

    expect(
      project(overwritten, retireLanded([entry], overwritten)).wheel?.title,
      'the other editor wrote last, so their title is the one that is true',
    ).toBe('Brunch')
  })

  it('restores the old title when the patch fails', () => {
    const state = live({ wheel: wheel({ title: 'Lunch' }) })
    const entries = pendingReducer(
      [inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } })],
      { type: 'fail', key: 'local:1' },
    )

    expect(project(state, entries).wheel?.title).toBe('Lunch')
    expect(project(state, entries).saving.title).toBe(false)
  })
})

describe('project — a wheel that is not there', () => {
  it('reports no wheel rather than inventing one from the overlay', () => {
    const view = project(live({ wheel: null }), [
      inFlight({ kind: 'add-option', label: 'Tacos' }),
      inFlight({ kind: 'patch-wheel', patch: { title: 'Dinner' } }, 'local:2'),
    ])

    expect(view.wheel).toBeNull()
  })

  it('still projects the queue, which lives in its own collection', () => {
    const view = project(
      live({ wheel: null, suggestions: [suggestion(SUGGESTION_ID)] }),
      [],
    )
    expect(view.suggestions).toHaveLength(1)
  })
})

describe('project — the pending affordance', () => {
  const mutation: Mutation = { kind: 'add-option', label: 'Tacos' }

  it('counts what is outstanding', () => {
    const view = project(live(), [
      inFlight(mutation, 'local:1'),
      inFlight({ kind: 'submit-suggestion', label: 'Ramen' }, 'local:2'),
    ])

    expect(view.pendingCount).toBe(2)
    expect(view.slow).toBe(false)
  })

  it('reports slow only once the entry has been marked slow', () => {
    const entries = pendingReducer([inFlight(mutation)], {
      type: 'slow',
      keys: ['local:1'],
    })
    const view = project(live(), entries)

    expect(view.slow).toBe(true)
    expect(view.wheel?.options[0].slow).toBe(true)
  })

  it('stops counting an entry once it has landed', () => {
    const arrived = live({
      wheel: wheel({ options: [option('server-1', { label: 'Tacos' })] }),
    })
    const entries = [settled(inFlight(mutation), { serverId: 'server-1' })]

    expect(project(arrived, entries).pendingCount).toBe(0)
  })
})

describe('pendingReducer', () => {
  const mutation: Mutation = { kind: 'add-option', label: 'Tacos' }

  it('begins an entry in flight', () => {
    const entries = pendingReducer([], {
      type: 'begin',
      key: 'local:1',
      mutation,
      at: 1_000,
    })

    expect(entries).toEqual([
      {
        key: 'local:1',
        mutation,
        startedAt: 1_000,
        settled: null,
        slow: false,
      },
    ])
  })

  it('settles the named entry and leaves the others alone', () => {
    const before = [
      inFlight(mutation, 'local:1'),
      inFlight(mutation, 'local:2'),
    ]
    const after = pendingReducer(before, {
      type: 'settle',
      key: 'local:1',
      serverId: 'server-1',
      wheelUpdatedAt: OURS,
      queueSeq: 4,
    })

    expect(after[0].settled).toEqual({
      serverId: 'server-1',
      wheelUpdatedAt: OURS,
      queueSeq: 4,
    })
    expect(after[1]).toBe(before[1])
  })

  it('drops the named entry on failure', () => {
    const before = [
      inFlight(mutation, 'local:1'),
      inFlight(mutation, 'local:2'),
    ]
    expect(
      pendingReducer(before, { type: 'fail', key: 'local:1' }).map(
        (e) => e.key,
      ),
    ).toEqual(['local:2'])
  })

  /**
   * Every identity-stability case in one place. ./use-wheel-session.ts
   * dispatches all three from effects that depend on the array they return, so
   * a fresh array for a no-op change is an infinite render loop rather than a
   * wasted allocation.
   */
  it.each([
    {
      label: 'reconcile with nothing landed',
      entries: () => [inFlight(mutation)],
      action: { type: 'reconcile', live: live() },
    },
    {
      label: 'slow on an entry already marked slow',
      entries: () => [{ ...inFlight(mutation), slow: true }],
      action: { type: 'slow', keys: ['local:1'] },
    },
    {
      label: 'slow naming an entry that has been retired',
      entries: () => [inFlight(mutation, 'local:2')],
      action: { type: 'slow', keys: ['local:1'] },
    },
    {
      label: 'reset on an already empty list',
      entries: () => [],
      action: { type: 'reset' },
    },
    {
      // Reachable whenever a write is in flight across a shareId change: the
      // reset empties the list, then the response settles against a key that
      // has gone.
      label: 'settle naming an entry that has been discarded',
      entries: () => [],
      action: {
        type: 'settle',
        key: 'local:1',
        wheelUpdatedAt: OURS,
        queueSeq: 1,
      },
    },
  ] satisfies {
    label: string
    entries: () => PendingEntry[]
    action: PendingAction
  }[])('returns the identical array for $label', ({ entries, action }) => {
    const before = entries()
    expect(pendingReducer(before, action)).toBe(before)
  })

  it('marks only the named entries slow', () => {
    const after = pendingReducer(
      [inFlight(mutation, 'local:1'), inFlight(mutation, 'local:2')],
      { type: 'slow', keys: ['local:2'] },
    )

    expect(after.map((entry) => entry.slow)).toEqual([false, true])
  })

  it('discards everything on reset, since entries belong to one wheel', () => {
    expect(pendingReducer([inFlight(mutation)], { type: 'reset' })).toEqual([])
  })
})

describe('newMutationKey', () => {
  it('never repeats', () => {
    const keys = Array.from({ length: 50 }, newMutationKey)
    expect(new Set(keys).size).toBe(50)
  })

  /**
   * Server IDs are UUIDs or 20-character Firestore auto-IDs, so the prefix
   * cannot collide with one — which is what keeps a local ID out of a request
   * path by accident.
   */
  it('is recognisable as local, and a server ID is not', () => {
    expect(isOptimisticId(newMutationKey())).toBe(true)
    expect(isOptimisticId(SUGGESTION_ID)).toBe(false)
    expect(isOptimisticId('7c3f1e6a-2b40-4f8e-9c1d-5a6b7c8d9e0f')).toBe(false)
  })
})
