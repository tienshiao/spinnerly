// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WheelTitle, type WheelTitleProps } from './wheel-title'

/**
 * The click-to-edit title, rendered from props.
 *
 * What it does through the page — the PATCH, Escape abandoning a rename, an
 * over-length title reverting on blur — is covered in ./wheel-page.test.tsx
 * against the fetch driver there. What is here is the two things that are
 * properties of this component and awkward to reach through a page: the field
 * being torn down and rebuilt underneath an open rename, and the encoding of
 * what it counts and sends.
 */

/**
 * The two encodings of `é`, built rather than pasted. A source file has one
 * normalisation form, whichever the editor that saved it chose, so writing both
 * literally is how a test meaning to tell them apart compares a string to
 * itself.
 */
const COMBINING_ACUTE = String.fromCodePoint(0x0301)
const PRECOMPOSED_E_ACUTE = String.fromCodePoint(0x00e9)

function renderTitle(overrides: Partial<WheelTitleProps> = {}) {
  const props: WheelTitleProps = {
    title: 'Lunch',
    editable: true,
    saving: false,
    onRename: vi.fn(() => Promise.resolve()),
    onError: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<WheelTitle {...props} />) }
}

function field(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Wheel title' })
}

function renameButton() {
  return screen.getByRole('button', { name: /^Rename wheel/ })
}

afterEach(cleanup)

describe('opening the field', () => {
  it('focuses and selects, so what is typed replaces the old title', async () => {
    const user = userEvent.setup()
    renderTitle()

    await user.click(renameButton())

    expect(document.activeElement).toBe(field())
    expect(field().selectionStart).toBe(0)
    expect(field().selectionEnd).toBe('Lunch'.length)
  })

  /**
   * The editor opens the viewer preview mid-rename. `editable` goes false, the
   * input unmounts, `editing` stays true — the component is explicit that the
   * draft is kept for the way back. On the way back the input is a *new* node,
   * so the focus it was given before is gone with the old one, and an effect
   * keyed on `editing` alone does not run again to restore it: the editor is
   * returned to a field they must click into before it will take a keystroke.
   */
  it('focuses the field again when it comes back from the viewer preview', async () => {
    const user = userEvent.setup()
    const { props, rerender } = renderTitle()

    await user.click(renameButton())
    await user.keyboard('Dinner')

    rerender(<WheelTitle {...props} editable={false} />)
    expect(screen.queryByRole('textbox'), 'no field in the preview').toBeNull()

    rerender(<WheelTitle {...props} editable />)

    expect(field().value, 'the draft survived the preview').toBe('Dinner')
    expect(document.activeElement).toBe(field())
    expect(field().selectionEnd).toBe('Dinner'.length)
  })
})

/**
 * `validateText` normalises to NFC and collapses whitespace before it counts and
 * before it stores, so a client measuring the raw draft disagrees with the
 * server about strings that render identically.
 */
describe('the form a title is counted and sent in', () => {
  it('does not refuse a title that is only over the cap before normalisation', async () => {
    const user = userEvent.setup()
    const { props } = renderTitle()

    await user.click(renameButton())
    await user.paste(`e${COMBINING_ACUTE}`.repeat(80))
    await user.keyboard('{Enter}')

    expect(props.onRename).toHaveBeenCalledWith(PRECOMPOSED_E_ACUTE.repeat(80))
  })

  /** An "edit" that changes nothing but the encoding is not an edit, and
   *  sending it would bump `updatedAt` and slide the wheel's expiry for a
   *  rename the editor did not make. */
  it('sends nothing when only the encoding differs from the stored title', async () => {
    const user = userEvent.setup()
    const { props } = renderTitle({ title: `Caf${PRECOMPOSED_E_ACUTE}` })

    await user.click(renameButton())
    await user.paste(`Cafe${COMBINING_ACUTE}`)
    await user.keyboard('{Enter}')

    expect(props.onRename).not.toHaveBeenCalled()
  })
})
