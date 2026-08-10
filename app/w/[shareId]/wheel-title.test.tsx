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
   * `startEditing`, which the page passes on a wheel this tab has just created.
   *
   * The field opens focused AND with the title selected, so the first keystroke
   * replaces "Untitled wheel" rather than appending to it — the same treatment
   * the rename button gives, for the same reason.
   */
  it('opens focused and selected on a wheel this tab just made', () => {
    renderTitle({ startEditing: true })

    expect(document.activeElement).toBe(field())
    expect(
      field().value,
      'an empty field reads as a cancel to commit(), losing the name it opened on',
    ).toBe('Lunch')
    expect(field().selectionStart).toBe(0)
    expect(field().selectionEnd).toBe('Lunch'.length)
  })

  /**
   * Opening the field means a blur happens on every new wheel whose creator
   * clicks anywhere else, so "opened and ignored" has to be a no-op. A PATCH
   * here would be a rename nobody made, and it would slide the wheel's expiry
   * on top of that.
   */
  it('sends nothing when the field is opened and left alone', async () => {
    const user = userEvent.setup()
    const { props } = renderTitle({ startEditing: true })

    await user.tab()

    expect(props.onRename).not.toHaveBeenCalled()
  })

  /** Read once, on mount — a dismissal is final for the life of the page. */
  it('does not re-open once it has been dismissed', async () => {
    const user = userEvent.setup()
    renderTitle({ startEditing: true })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(renameButton()).toBeTruthy()
  })

  /** A participant has no field to open, whatever the page asks for. */
  it('opens nothing for a viewer', () => {
    renderTitle({ editable: false, startEditing: true })

    expect(screen.queryByRole('textbox')).toBeNull()
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
 * The idle title is the one thing on this page that both roles see, and the
 * preview toggle swaps between them in place — so any difference in the box it
 * occupies is a visible jump in the header, not a detail.
 *
 * Asserted on classes because jsdom has no layout: `getBoundingClientRect` is
 * all zeroes here, so there is nothing to measure. The classes are read off the
 * rendered output and compared to each other rather than to a written-down
 * list, which is what keeps this a statement about the two states agreeing
 * instead of a copy of whichever padding was current when it was written.
 */
describe('the box the title sits in', () => {
  /** Every utility that puts space around the text, in a stable order. */
  function spacing(element: Element): string[] {
    return [...element.classList]
      .filter((name) => /^-?[pm][xytrbl]?-/.test(name))
      .sort()
  }

  function idleBox(editable: boolean): Element {
    const { container } = renderTitle({ editable })
    const box = container.firstElementChild
    expect(box, 'the component rendered nothing').not.toBeNull()
    return box as Element
  }

  it('is the same for a viewer as for an editor', () => {
    const asEditor = spacing(idleBox(true))
    cleanup()
    const asViewer = spacing(idleBox(false))

    expect(
      asEditor,
      'the padding under test disappeared from both states, so this compares nothing',
    ).not.toHaveLength(0)
    expect(
      asViewer,
      'the header jumps when an editor opens the viewer preview',
    ).toEqual(asEditor)
  })

  /** The static one is inert: no affordance, and nothing focusable. */
  it('offers a viewer nothing to activate', () => {
    renderTitle({ editable: false })

    expect(screen.queryByRole('button')).toBeNull()
    expect(idleBox(false).className).not.toContain('cursor-pointer')
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
