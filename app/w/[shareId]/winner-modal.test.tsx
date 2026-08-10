// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WinnerModal } from './winner-modal'

/**
 * The winner card.
 *
 * Everything here is about the card as a MODAL rather than as a picture: the
 * ways out of it (AC 4), where focus lands when it goes, and what is suppressed
 * under `prefers-reduced-motion` (AC 3). Its wiring to `useSpin` — that every
 * one of those ways out has to thaw the wheel — belongs to the page and is
 * asserted in ./wheel-page.test.tsx.
 */

/** As ./use-spin.test.ts: jsdom's own `matchMedia` never matches anything. */
function stubReducedMotion(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/**
 * The page in miniature: a spin button that opens the card, and a card whose
 * every exit closes it. Built this way rather than by driving `open` from the
 * test so that focus has somewhere real to go back to — AC 4 is about a button
 * that exists.
 */
function Harness({
  label = 'Tacos',
  onClose,
  onSpinAgain,
}: {
  label?: string
  onClose?: () => void
  onSpinAgain?: () => void
}) {
  const spinButton = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)

  return (
    <>
      <button
        ref={spinButton}
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Spin the wheel
      </button>
      {/* Something else focusable behind the card, so "the background is not
          tabbable" is a claim with more than one element behind it. */}
      <button type="button">Copy share link</button>

      <WinnerModal
        open={open}
        label={label}
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        onSpinAgain={() => {
          setOpen(false)
          onSpinAgain?.()
        }}
        returnFocusTo={spinButton}
      />
    </>
  )
}

function spinButton(): HTMLElement {
  return screen.getByRole('button', { name: /spin the wheel/i })
}

beforeEach(() => {
  stubReducedMotion(false)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('what it says', () => {
  it('names the winner, and says the option survives', () => {
    render(<Harness label="Ramen" />)

    const card = screen.getByRole('dialog')
    // The label is the dialog's own title, so a screen reader announcing the
    // dialog announces the result with it.
    expect(within(card).getByText('Ramen')).toBeTruthy()
    expect(within(card).getByText(/keeps every option/i)).toBeTruthy()
  })

  /**
   * Design doc section 10: the prototype's "Lunch is decided" narrows the
   * product to the one use case its mockup happens to show, and the landing
   * page already sells the general tool.
   */
  it('does not mention lunch', () => {
    render(<Harness />)

    expect(screen.getByRole('dialog').textContent).not.toMatch(/lunch|spot/i)
  })
})

describe('the ways out', () => {
  it('closes on Nice', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /^nice$/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  /**
   * "Spin again" closes as well as re-spinning, and the two are one callback
   * rather than two: a version that only re-spun would leave the card up over a
   * wheel that had started moving underneath it.
   */
  it('closes on Spin again, and asks for another spin', async () => {
    const onClose = vi.fn()
    const onSpinAgain = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} onSpinAgain={onSpinAgain} />)

    await user.click(screen.getByRole('button', { name: /spin again/i }))

    expect(onSpinAgain).toHaveBeenCalledTimes(1)
    expect(onClose, 'the two paths must not both fire').not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Harness onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes on a click on the backdrop', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { baseElement } = render(<Harness onClose={onClose} />)

    const backdrop = baseElement.querySelector('[data-slot="winner-backdrop"]')
    expect(backdrop, 'no backdrop to click').toBeTruthy()
    await user.click(backdrop as HTMLElement)

    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('focus', () => {
  /**
   * The whole page behind a modal has to be untabbable, and Base UI only hides
   * it from assistive tech — see lib/base-ui-inert.ts. Asserted through
   * `getByRole`, which reads the accessibility tree: a background that is still
   * in it is a background that is still tabbable.
   */
  it('takes the page behind out of reach', () => {
    render(<Harness />)

    expect(
      screen.queryByRole('button', { name: /copy share link/i }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: /spin the wheel/i })).toBeNull()
  })

  /**
   * Focus has to ENTER the card, and this is the half that is easy to lose: the
   * card opens from a timer rather than from a click, so nothing about the
   * interaction moves focus on its own. Left where it was, focus would be on
   * the spin button — which this modal has just made inert — and the browser
   * would drop it to `<body>`, where a screen reader is told nothing has
   * happened and a keyboard user has to Tab in from the top of the document.
   */
  it('moves focus into the card when it opens', async () => {
    render(<Harness />)

    const card = screen.getByRole('dialog')
    await waitFor(() =>
      expect(card.contains(document.activeElement)).toBe(true),
    )
  })

  /**
   * AC 4. There is no `Dialog.Trigger` to infer this from — the card opens from
   * a timer four seconds after the click — so the spin button is handed in, and
   * this is what proves the handing-in is wired up.
   */
  it('goes back to the spin button on Nice', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /^nice$/i }))

    await waitFor(() => expect(document.activeElement).toBe(spinButton()))
  })

  /**
   * The Escape path separately, because it is the one the inert workaround
   * breaks: Base UI restores focus while the spin button is still inside the
   * inert subtree, the browser drops the call, and focus lands on `<body>`. A
   * keyboard user then starts again from the top of the page.
   */
  it('goes back to the spin button on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.keyboard('{Escape}')

    await waitFor(() => expect(document.activeElement).toBe(spinButton()))
  })
})

describe('prefers-reduced-motion', () => {
  /**
   * AC 3, in both halves — and neither is a shortened animation. The card still
   * appears and still says the same thing; what goes is the movement.
   */
  it('drops the pop and the confetti, and keeps the card', () => {
    stubReducedMotion(true)

    const { baseElement } = render(<Harness label="Ramen" />)

    const card = screen.getByRole('dialog')
    expect(
      within(card).getByText('Ramen'),
      'the result still has to be shown',
    ).toBeTruthy()
    expect(card.className).not.toContain('animate-winner-pop')
    expect(baseElement.querySelector('[data-slot="confetti"]')).toBeNull()
  })

  /**
   * The variant is asserted along with the animation. A bare
   * `animate-winner-pop` fills `both`, so it stays applied to a closed popup
   * and holds it at its final frame — and Base UI works out when a closed popup
   * may leave the DOM from the animations still attached to it.
   */
  it('pops and bursts when motion is allowed', () => {
    const { baseElement } = render(<Harness />)

    expect(screen.getByRole('dialog').className).toContain(
      'data-open:animate-winner-pop',
    )
    expect(baseElement.querySelector('[data-slot="confetti"]')).toBeTruthy()
  })
})
