// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Wheel } from '@/components/wheel/wheel'
import type { ProjectedOption } from '@/lib/wheels/optimistic'
import { OPTION_LABEL_MAX, OPTIONS_MAX } from '@/lib/wheels/validation'

import { OptionsPanel, type OptionsPanelProps } from './options-panel'

/**
 * The Options panel, rendered from props rather than driven through a wheel.
 *
 * Everything this component does is a function of the projection it is handed,
 * so a state that would take a Firestore listener, a round trip and a
 * reconciliation to reach — an optimistic row, a slow one, a wheel at its
 * option cap — is one object literal here. The two claims that genuinely need
 * the whole page (an add that appears before its snapshot, and a remove that
 * does not wait for one) are in ./wheel-page.test.tsx instead.
 */

function option(
  label: string,
  overrides: Partial<ProjectedOption> = {},
): ProjectedOption {
  return {
    id: `id-${label}`,
    label,
    addedAt: null,
    fromSuggestion: null,
    pending: false,
    optimistic: false,
    slow: false,
    ...overrides,
  }
}

const OPTIONS = ['Tacos', 'Ramen', 'Pho'].map((label) => option(label))

/**
 * The two encodings of `é`, built rather than pasted.
 *
 * A source file has one normalisation form, whichever the editor that saved it
 * chose, so writing both literally is how a test that means to tell them apart
 * ends up comparing a string to itself.
 */
const COMBINING_ACUTE = String.fromCodePoint(0x0301)
const PRECOMPOSED_E_ACUTE = String.fromCodePoint(0x00e9)

function renderPanel(overrides: Partial<OptionsPanelProps> = {}) {
  const props: OptionsPanelProps = {
    options: OPTIONS,
    role: 'editor',
    picked: new Set<string>(),
    onAdd: vi.fn(() => Promise.resolve()),
    onRemove: vi.fn(() => Promise.resolve()),
    onError: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<OptionsPanel {...props} />) }
}

function addField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Add an option' })
}

afterEach(cleanup)

describe('the editor variant', () => {
  /**
   * AC 8, and deliberately stated as a count rather than as an absence. The
   * prototype puts an input on every row; decision 10 drops it, because the API
   * has add and remove and nothing in between. Asserting "no input inside a
   * row" would still pass if a later refactor moved one somewhere else — one
   * textbox in the whole panel is the claim that stays true.
   */
  it('renders labels as static text, with one input for the whole panel', () => {
    renderPanel()

    for (const { label } of OPTIONS)
      expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(addField()).toBeTruthy()
  })

  it('removes an option by id, naming it in the control', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Remove Ramen' }))

    expect(props.onRemove).toHaveBeenCalledWith('id-Ramen')
  })

  it('reports a failed remove rather than swallowing it', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      onRemove: vi.fn(() => Promise.reject(new Error('Wheel is gone.'))),
    })

    await user.click(screen.getByRole('button', { name: 'Remove Tacos' }))

    await waitFor(() =>
      expect(props.onError).toHaveBeenCalledWith('Wheel is gone.'),
    )
  })

  /**
   * An optimistic id is `local:n` and addresses nothing, so `DELETE
   * /options/local:n` is a request that cannot succeed. The row is on screen
   * because the add is in flight; the control has to wait for the real id.
   */
  it('will not offer to remove a row the server has never seen', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel({
      options: [
        option('Tacos'),
        option('Pho', { optimistic: true, pending: true }),
      ],
    })

    const control = screen.getByRole('button', { name: 'Remove Pho' })
    expect(control.hasAttribute('disabled')).toBe(true)

    await user.click(control)
    expect(props.onRemove).not.toHaveBeenCalled()
  })

  it('marks a row with an outstanding write, and says so once it is slow', () => {
    renderPanel({
      options: [
        option('Tacos'),
        option('Pho', { pending: true, optimistic: true, slow: true }),
      ],
    })

    const busy = document.querySelectorAll('[aria-busy="true"]')
    expect(busy, 'only the pending row is busy').toHaveLength(1)
    expect(busy[0].textContent).toContain('Pho')
    expect(screen.getByText('Saving…')).toBeTruthy()
  })

  it('badges the options this browser has landed on, and only those', () => {
    renderPanel({ picked: new Set(['id-Ramen']) })

    const badges = screen.getAllByText('Picked')
    expect(badges).toHaveLength(1)
    expect(badges[0].closest('li')?.textContent).toContain('Ramen')
  })
})

describe('the participant variant', () => {
  it('renders the options with no way to change them', () => {
    renderPanel({ role: 'participant' })

    for (const { label } of OPTIONS)
      expect(screen.getByText(label)).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  /**
   * AC 10. The badge is a fact about the browser that spun, and a participant's
   * browser has not — decision 15 keeps it out of the schema precisely so there
   * is nothing here to leak. This also covers the editor previewing the shared
   * view, which is the same render.
   */
  it('never badges a picked option', () => {
    renderPanel({
      role: 'participant',
      picked: new Set(['id-Ramen', 'id-Tacos']),
    })

    expect(screen.queryByText('Picked')).toBeNull()
  })
})

/**
 * AC 3, and it compares the two renders rather than checking each against
 * `sliceColors`. Asserting both against the palette separately would pass just
 * as happily if only one of them had stopped consulting it — which is the whole
 * failure this criterion is about.
 *
 * Twelve options, so the wrap past the ten-colour palette is exercised too.
 */
describe('the dots and the slices', () => {
  /** jsdom normalises a colour on the way into a style property and not on the
   *  way into an SVG attribute, so the two are compared through the same
   *  parser rather than as strings. */
  function normalise(color: string): string {
    const probe = document.createElement('div')
    probe.style.background = color
    return probe.style.background
  }

  it.each([
    { label: 'the editor variant', role: 'editor' as const },
    { label: 'the participant variant', role: 'participant' as const },
  ])('gives each option its own slice colour in $label', ({ role }) => {
    const many = Array.from({ length: 12 }, (_, index) =>
      option(`Option ${index}`),
    )

    const { container } = render(
      <>
        <Wheel options={many} rotation={0} transition="none" title="Lunch" />
        <OptionsPanel
          options={many}
          role={role}
          picked={new Set()}
          onAdd={vi.fn(() => Promise.resolve())}
          onRemove={vi.fn(() => Promise.resolve())}
          onError={vi.fn()}
        />
      </>,
    )

    const wedges = [...container.querySelectorAll('path')].map((wedge) =>
      normalise(wedge.getAttribute('fill') ?? ''),
    )
    const dots = [
      ...container.querySelectorAll('[data-slot="option-dot"]'),
    ].map((dot) => (dot as HTMLElement).style.background)

    expect(wedges).toHaveLength(many.length)
    expect(dots).toEqual(wedges)
  })
})

describe('adding an option', () => {
  it('submits the trimmed label on Enter and clears the field', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(addField())
    await user.keyboard('  Pizza  {Enter}')

    expect(props.onAdd).toHaveBeenCalledWith('Pizza')
    expect(addField().value).toBe('')
  })

  it('submits from the Add button too', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.type(addField(), 'Pizza')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(props.onAdd).toHaveBeenCalledWith('Pizza')
  })

  it('sends nothing for a draft that is only whitespace', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(addField())
    await user.keyboard('   {Enter}')

    expect(props.onAdd).not.toHaveBeenCalled()
  })

  /**
   * Refused locally so the editor can shorten what they wrote, rather than
   * after a round trip that throws it away. Measured in code points, as
   * `countCharacters` is — the point that module makes about emoji.
   */
  it('refuses an over-length label before it is sent', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(addField())
    await user.paste('a'.repeat(OPTION_LABEL_MAX + 1))

    expect(
      screen.getByText(`Options are ${OPTION_LABEL_MAX} characters at most.`),
    ).toBeTruthy()
    expect(addField().getAttribute('aria-invalid')).toBe('true')

    await user.keyboard('{Enter}')
    expect(props.onAdd).not.toHaveBeenCalled()
  })

  it('gives the label back when the write fails', async () => {
    const user = userEvent.setup()
    let refuse!: (error: Error) => void
    const pending = new Promise<void>((_, reject) => {
      refuse = reject
    })
    const { props } = renderPanel({ onAdd: vi.fn(() => pending) })

    await user.click(addField())
    await user.keyboard('Pizza{Enter}')
    expect(addField().value, 'cleared for the next one').toBe('')

    await act(async () => {
      refuse(new Error('This wheel is full.'))
      await pending.catch(() => {})
    })

    expect(addField().value).toBe('Pizza')
    expect(props.onError).toHaveBeenCalledWith('This wheel is full.')
  })

  /**
   * The other half of that restore, and the reason it is conditional. An editor
   * entering a list types the next option while the last one is still in
   * flight; putting the failed label back over it would cost them a second one.
   */
  it('does not put a failed label over something newer', async () => {
    const user = userEvent.setup()
    let refuse!: (error: Error) => void
    const pending = new Promise<void>((_, reject) => {
      refuse = reject
    })
    renderPanel({ onAdd: vi.fn(() => pending) })

    await user.click(addField())
    await user.keyboard('Pizza{Enter}')
    await user.keyboard('Sushi')

    await act(async () => {
      refuse(new Error('Nope.'))
      await pending.catch(() => {})
    })

    expect(addField().value).toBe('Sushi')
  })

  /**
   * The draft belongs to the panel and not to the add row, and this is the case
   * that decides it: an add on a wheel at 49 draws its own optimistic row, which
   * takes the count to the cap and takes the field away with it. Were the draft
   * the field's own state, the restore above would be setting state on an
   * unmounted component and the label would be lost — in `options_full`, the one
   * refusal where the editor cannot simply retry.
   */
  it('keeps the label when the wheel fills up under the add row', async () => {
    const user = userEvent.setup()
    let refuse!: (error: Error) => void
    const pending = new Promise<void>((_, reject) => {
      refuse = reject
    })
    const nearlyFull = Array.from({ length: OPTIONS_MAX - 1 }, (_, index) =>
      option(`Option ${index}`),
    )
    const props: OptionsPanelProps = {
      options: nearlyFull,
      role: 'editor',
      picked: new Set<string>(),
      onAdd: vi.fn(() => pending),
      onRemove: vi.fn(() => Promise.resolve()),
      onError: vi.fn(),
    }
    const { rerender } = render(<OptionsPanel {...props} />)

    await user.click(addField())
    await user.keyboard('Pho{Enter}')

    // The optimistic row arrives and the wheel is at its cap, so the field goes.
    rerender(
      <OptionsPanel
        {...props}
        options={[...nearlyFull, option('Pho', { optimistic: true })]}
      />,
    )
    expect(screen.queryByRole('textbox'), 'no field at the cap').toBeNull()

    // The server refuses, the entry rolls back, and the field comes back.
    await act(async () => {
      refuse(new Error('This wheel is full.'))
      await pending.catch(() => {})
    })
    rerender(<OptionsPanel {...props} options={nearlyFull} />)

    expect(addField().value).toBe('Pho')
  })

  /**
   * The server counts after `normalize('NFC')` and collapsing whitespace, so a
   * client counting the raw draft disagrees with it about labels nobody can see
   * the difference in. `é` typed on a Mac is two code points; sixty of them read
   * 120 raw and 60 stored, and the raw count refuses a label that was always
   * going to be accepted.
   */
  it('counts and sends a label the way the server will store it', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()
    const decomposed = `e${COMBINING_ACUTE}`.repeat(OPTION_LABEL_MAX)

    await user.click(addField())
    await user.paste(decomposed)

    expect(
      screen.queryByText(`Options are ${OPTION_LABEL_MAX} characters at most.`),
      'sixty stored characters is not over the cap',
    ).toBeNull()

    await user.keyboard('{Enter}')
    expect(props.onAdd).toHaveBeenCalledWith(
      PRECOMPOSED_E_ACUTE.repeat(OPTION_LABEL_MAX),
    )
  })

  /** The other half of the stored form, and the one an editor pasting from a
   *  chat message meets: the server keeps one space, so the optimistic row has
   *  to show one too or the snapshot quietly rewrites it. */
  it('collapses the whitespace the server would have collapsed', async () => {
    const user = userEvent.setup()
    const { props } = renderPanel()

    await user.click(addField())
    await user.paste('Deep  dish')
    await user.keyboard('{Enter}')

    expect(props.onAdd).toHaveBeenCalledWith('Deep dish')
  })

  /**
   * The server's `options_full` 409 remains the authority — two editors can
   * both be looking at 49 — so this only declines to offer a click that is
   * already known to fail.
   */
  it('offers no field at all once the wheel is full', () => {
    renderPanel({
      options: Array.from({ length: OPTIONS_MAX }, (_, index) =>
        option(`Option ${index}`),
      ),
    })

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(
      screen.getByText(
        `That is the ${OPTIONS_MAX}-option maximum. Remove one to add another.`,
      ),
    ).toBeTruthy()
  })
})

describe('the count', () => {
  it.each([
    { label: 'an empty wheel', count: 0, expected: 'Nothing on it yet' },
    { label: 'one option', count: 1, expected: '1 on the wheel' },
    { label: 'several', count: 3, expected: '3 on the wheel' },
  ])('reads sensibly for $label', ({ count, expected }) => {
    renderPanel({
      options: Array.from({ length: count }, (_, index) =>
        option(`Option ${index}`),
      ),
    })

    expect(screen.getByText(expected)).toBeTruthy()
  })

  /** AC 6's other half: an empty panel has to say something useful, and what is
   *  useful differs by role — one of them can do something about it. */
  it.each([
    { label: 'an editor', role: 'editor' as const, expected: /add the first/i },
    {
      label: 'a participant',
      role: 'participant' as const,
      expected: /organiser has not added/i,
    },
  ])('tells $label what an empty wheel means', ({ role, expected }) => {
    renderPanel({ options: [], role })

    expect(screen.getByText(expected)).toBeTruthy()
  })
})
