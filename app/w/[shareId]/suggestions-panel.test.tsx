// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProjectedSuggestion } from '@/lib/wheels/optimistic'
import {
  PENDING_SUGGESTIONS_MAX,
  SUGGESTION_LABEL_MAX,
} from '@/lib/wheels/validation'

import {
  SuggestionsPanel,
  type SuggestionsPanelProps,
} from './suggestions-panel'

/**
 * The Suggestions panel, rendered from props rather than driven through a
 * wheel, for the reason ./options-panel.test.tsx gives: a queue at its cap, an
 * accept in flight and a closed wheel are each one object literal here, where
 * reaching any of them through the session would take a listener, a round trip
 * and a reconciliation.
 *
 * The two claims that genuinely need the whole page — an accept whose option
 * appears before any snapshot confirms it, and a kill switch one client sets
 * that another sees — are in ./wheel-page.test.tsx instead.
 *
 * AC 1 and AC 10 are not asserted here and deliberately so. jsdom has no
 * layout and no cascade, so a test of the accent-2 fill or of the panel at
 * 320px would be asserting the class strings this file already contains rather
 * than anything a user could see. Both were checked in a browser.
 */

function suggestion(
  label: string,
  overrides: Partial<ProjectedSuggestion> = {},
): ProjectedSuggestion {
  return {
    id: `id-${label}`,
    label,
    status: 'pending',
    createdAt: null,
    expiresAt: null,
    pending: false,
    optimistic: false,
    slow: false,
    ...overrides,
  }
}

const QUEUE = [
  suggestion('Tacos'),
  suggestion('Ramen', { status: 'accepted' }),
  suggestion('Pho'),
]

function renderPanel(overrides: Partial<SuggestionsPanelProps> = {}) {
  const props: SuggestionsPanelProps = {
    suggestions: QUEUE,
    role: 'editor',
    suggestionsOpen: true,
    savingSuggestionsOpen: false,
    onAccept: vi.fn(() => Promise.resolve()),
    onReject: vi.fn(() => Promise.resolve()),
    onSubmit: vi.fn(() => Promise.resolve()),
    onSetSuggestionsOpen: vi.fn(() => Promise.resolve()),
    onError: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<SuggestionsPanel {...props} />) }
}

function queue(): HTMLElement {
  return screen.getByRole('list', { name: 'Suggestions for this wheel' })
}

function rowFor(label: string): HTMLElement {
  const row = within(queue())
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(label))
  expect(row, `no row for ${label}`).toBeTruthy()
  return row as HTMLElement
}

function submitField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Suggest an option' })
}

afterEach(cleanup)

/**
 * AC 2. Decision 3 makes the queue public: both roles read the same list, and
 * what differs between them is who may act on a row.
 */
describe('the public queue', () => {
  it.each([
    { label: 'an editor', role: 'editor' as const },
    { label: 'a participant', role: 'participant' as const },
  ])('shows pending and accepted suggestions to $label', ({ role }) => {
    renderPanel({ role })

    expect(within(queue()).getAllByRole('listitem')).toHaveLength(3)
    for (const { label } of QUEUE)
      expect(within(queue()).getByText(label)).toBeTruthy()
  })

  /**
   * AC 9, decision 12. Stated as "the row holds the label and its own controls
   * and nothing else" rather than as the absence of a name, because there is no
   * name to look for — `clientHint` was removed outright — so an assertion
   * naming one would pass for the wrong reason forever.
   */
  it('renders nothing beside a label but the controls that act on it', () => {
    renderPanel({ role: 'participant', suggestions: [suggestion('Tacos')] })

    expect(rowFor('Tacos').textContent).toBe('TacosWaiting')
  })

  /**
   * AC 8, decision 11. Reject is a hard delete, so there is no third state to
   * render — the prototype's Declined chip describes a row that cannot exist.
   * Asserted over both roles because an editor's view is the one that has a
   * Reject control at all, and a chip is the obvious thing to put where the
   * control used to be.
   */
  it.each([
    { label: 'an editor', role: 'editor' as const },
    { label: 'a participant', role: 'participant' as const },
  ])('never renders a rejected or declined state to $label', ({ role }) => {
    renderPanel({ role })

    expect(screen.queryByText(/declined/i)).toBeNull()
    expect(screen.queryByText(/^rejected$/i)).toBeNull()
  })
})

describe('the count label', () => {
  /** AC 7. Accepted rows are no longer anything anyone has to do. */
  it.each([
    {
      label: 'two of three still waiting',
      queue: QUEUE,
      expected: '2 waiting',
    },
    {
      label: 'every row actioned',
      queue: [suggestion('Ramen', { status: 'accepted' })],
      expected: 'all caught up',
    },
    { label: 'an empty queue', queue: [], expected: 'all caught up' },
  ])('reads $expected with $label', ({ queue: rows, expected }) => {
    renderPanel({ suggestions: rows })

    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('says so in the body when there is nothing waiting at all', () => {
    renderPanel({ suggestions: [] })

    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText(/nothing waiting/i)).toBeTruthy()
  })
})

describe('the editor variant', () => {
  it('approves a suggestion by id, carrying the label the row shows', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Approve Tacos' }))

    // The label goes with it because the optimistic option row needs it before
    // any snapshot confirms the accept — see `acceptSuggestion` in
    // lib/wheels/use-wheel-session.ts.
    expect(props.onAccept).toHaveBeenCalledWith('id-Tacos', 'Tacos')
  })

  /** AC 4. What makes it vanish everywhere is the hard delete; this is the call. */
  it('rejects a suggestion by id', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Reject Pho' }))

    expect(props.onReject).toHaveBeenCalledWith('id-Pho')
  })

  /**
   * AC 3. The projection marks the row `pending` for as long as the accept is
   * outstanding, and a decision already taken should not be offered again — a
   * second accept would project a second optimistic option (TASK-32).
   */
  it('will not offer to action a row whose own write is still in flight', () => {
    renderPanel({ suggestions: [suggestion('Tacos', { pending: true })] })

    expect(
      screen.getByRole('button', { name: 'Approve Tacos' }),
    ).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reject Tacos' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  /**
   * The same guard from the other side: an optimistic id is `local:n`, and
   * `POST /suggestions/local:n/accept` addresses nothing. A participant's own
   * submission is on screen from the click, so this row is reachable.
   */
  it('will not offer to action a row the server has never seen', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      suggestions: [
        suggestion('Tacos', { id: 'local:4', pending: true, optimistic: true }),
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Approve Tacos' }))

    expect(props.onAccept).not.toHaveBeenCalled()
  })

  it('shows an accepted row as settled rather than as actionable', () => {
    renderPanel()

    expect(within(rowFor('Ramen')).getByText('Added')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve Ramen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject Ramen' })).toBeNull()
  })

  it.each([
    { label: 'an approve', name: 'Approve Tacos', prop: 'onAccept' as const },
    { label: 'a reject', name: 'Reject Tacos', prop: 'onReject' as const },
  ])(
    'reports a failed $label rather than swallowing it',
    async ({ name, prop }) => {
      const user = userEvent.setup()
      const { props } = renderPanel({
        [prop]: vi.fn(() => Promise.reject(new Error('Wheel is gone.'))),
      })

      await user.click(screen.getByRole('button', { name }))

      await waitFor(() =>
        expect(props.onError).toHaveBeenCalledWith('Wheel is gone.'),
      )
    },
  )

  /** AC 5. There is no submit row for someone who can put an option on directly. */
  it('has no submit row', () => {
    renderPanel()

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Suggest' })).toBeNull()
  })
})

/**
 * AC 11 and the panel's half of AC 12. Design doc section 7 puts this control
 * here rather than behind the header's overflow icon: it is the only tool an
 * editor has while a wheel is being spammed.
 */
describe('the suggestions kill switch', () => {
  it('is present for an editor and absent for a participant', () => {
    const { unmount } = renderPanel({ role: 'editor' })
    expect(
      screen.getByRole('switch', { name: 'Accepting suggestions' }),
    ).toBeTruthy()

    unmount()
    renderPanel({ role: 'participant' })
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it.each([
    { label: 'open', open: true, expected: false },
    { label: 'closed', open: false, expected: true },
  ])('asks for the opposite of $label', async ({ open, expected }) => {
    const user = userEvent.setup()
    const { props } = renderPanel({ suggestionsOpen: open })

    await user.click(screen.getByRole('switch'))

    expect(props.onSetSuggestionsOpen).toHaveBeenCalledWith(expected)
  })

  it('reports the projected state rather than its own', () => {
    renderPanel({ suggestionsOpen: false })

    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe(
      'false',
    )
  })

  /**
   * Two rapid toggles settle on the second, both here and on the server — the
   * `patch-wheel` case in lib/wheels/optimistic.ts applies outstanding patches
   * in order. Disabling the control for a round trip would take it away in the
   * one case it exists for: the mis-click during a spam wave.
   */
  it('stays usable while its own write is outstanding', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      suggestionsOpen: false,
      savingSuggestionsOpen: true,
    })

    await user.click(screen.getByRole('switch'))

    expect(props.onSetSuggestionsOpen).toHaveBeenCalledWith(true)
  })

  it('reports a failed toggle rather than swallowing it', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      onSetSuggestionsOpen: vi.fn(() => Promise.reject(new Error('No token.'))),
    })

    await user.click(screen.getByRole('switch'))

    await waitFor(() => expect(props.onError).toHaveBeenCalledWith('No token.'))
  })
})

describe('the participant submit row', () => {
  /** AC 5. */
  it('is present, and submits on Enter', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    await user.type(submitField(), 'Sushi{Enter}')

    expect(props.onSubmit).toHaveBeenCalledWith('Sushi')
  })

  it('submits on the button too', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    await user.type(submitField(), 'Sushi')
    await user.click(screen.getByRole('button', { name: 'Suggest' }))

    expect(props.onSubmit).toHaveBeenCalledWith('Sushi')
  })

  /**
   * Sent as the server will store it, not as it was typed. `toStoredForm`
   * collapses the whitespace and normalises, so the optimistic row carries the
   * label the snapshot will later confirm rather than one it quietly changes.
   */
  it('sends the stored form of the draft', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    await user.type(submitField(), '  Deep   dish  {Enter}')

    expect(props.onSubmit).toHaveBeenCalledWith('Deep dish')
  })

  it('ignores a stray Enter on an empty field', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    await user.type(submitField(), '{Enter}')

    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it('clears the field on submit and confirms what happened', async () => {
    const user = userEvent.setup()
    renderPanel({ role: 'participant' })

    await user.type(submitField(), 'Sushi{Enter}')

    expect(submitField().value).toBe('')
    // The optimistic row lands at the END of a queue that may be off screen,
    // so nothing else says this happened where the participant is looking.
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
  })

  /**
   * Restored only into a field left alone — the rule `AddRow` records next
   * door. A participant may type their second suggestion while the first is in
   * flight, and putting the failed label back over it costs them that one too.
   */
  it('gives a failed suggestion back, unless something else has been typed', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      role: 'participant',
      onSubmit: vi.fn(() => Promise.reject(new Error('Suggestions closed.'))),
    })

    await user.type(submitField(), 'Sushi{Enter}')

    await waitFor(() => expect(submitField().value).toBe('Sushi'))
    expect(props.onError).toHaveBeenCalledWith('Suggestions closed.')
  })

  /**
   * The draft belongs to the panel, not to the row, because both conditions
   * that replace the row are things OTHER people do — and neither is exotic.
   * The editor throwing the kill switch mid-sentence is the one a participant
   * would notice; another participant filling the queue to the cap is the same
   * shape with no editor involved at all.
   *
   * `it.each` over both, because it is the hoisting that is under test and the
   * two conditions are only two ways of unmounting the same field.
   */
  it.each([
    {
      label: 'the editor closes suggestions',
      closed: { suggestionsOpen: false },
    },
    {
      label: 'the queue reaches its cap',
      closed: {
        suggestions: Array.from(
          { length: PENDING_SUGGESTIONS_MAX },
          (_, index) => suggestion(`Spot ${index}`),
        ),
      },
    },
  ])(
    'keeps a half-typed suggestion when $label under it',
    async ({ closed }) => {
      const user = userEvent.setup()
      const { props, rerender } = renderPanel({ role: 'participant' })

      await user.type(submitField(), 'The bahn mi cart')

      // A snapshot arriving, which is a prop change and not a remount.
      rerender(<SuggestionsPanel {...props} {...closed} />)
      expect(
        screen.queryByRole('textbox', { name: 'Suggest an option' }),
        'the field must have gone, or this proves nothing',
      ).toBeNull()

      rerender(<SuggestionsPanel {...props} />)
      expect(submitField().value).toBe('The bahn mi cart')
    },
  )

  /**
   * Measured with `countCharacters` against the server's own cap, never
   * `.length` — 40 emoji read 80 as UTF-16 units, and a counter built on that
   * refuses labels that were always going to be accepted.
   */
  it('refuses a label past the cap, locally, and says what the cap is', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    await user.type(submitField(), '🌮'.repeat(SUGGESTION_LABEL_MAX + 1))
    await user.keyboard('{Enter}')

    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        `Suggestions are ${SUGGESTION_LABEL_MAX} characters at most.`,
      ),
    ).toBeTruthy()
  })

  it('accepts a label of exactly the cap in emoji', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({ role: 'participant' })

    const label = '🌮'.repeat(SUGGESTION_LABEL_MAX)
    await user.type(submitField(), label)
    await user.keyboard('{Enter}')

    expect(props.onSubmit).toHaveBeenCalledWith(label)
  })

  /** AC 6. Replaced, not disabled — a field that invites typing and then 409s. */
  it('is replaced by a message when the wheel is closed to suggestions', () => {
    renderPanel({ role: 'participant', suggestionsOpen: false })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/closed suggestions on this wheel/i)).toBeTruthy()
  })

  it('is replaced by a message when the queue is at its cap', () => {
    renderPanel({
      role: 'participant',
      suggestions: Array.from({ length: PENDING_SUGGESTIONS_MAX }, (_, index) =>
        suggestion(`Spot ${index}`),
      ),
    })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(
      screen.getByText(
        new RegExp(`${PENDING_SUGGESTIONS_MAX} suggestions\\s+waiting`, 'i'),
      ),
    ).toBeTruthy()
  })

  /**
   * Accepted rows do not count towards the cap, because the server counts
   * pending only — `assertPendingSuggestionCapacity` in lib/wheels/validation.ts.
   * A client that counted the whole queue would close the field on a wheel the
   * route would still accept a submission for.
   */
  it('stays open on a long queue whose rows have all been actioned', () => {
    renderPanel({
      role: 'participant',
      suggestions: Array.from({ length: PENDING_SUGGESTIONS_MAX }, (_, index) =>
        suggestion(`Spot ${index}`, { status: 'accepted' }),
      ),
    })

    expect(submitField()).toBeTruthy()
  })
})
