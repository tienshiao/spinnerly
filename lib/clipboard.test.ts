// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './clipboard'

/**
 * Copying, and specifically the two ways it goes wrong quietly.
 *
 * A copy button is the one control that cannot show its own result: the
 * clipboard is somewhere else, and the user does not find out until they paste
 * into a message they are about to send. So the thing under test is not really
 * "does it copy" — it is "does it ever claim to have copied when it did not",
 * and every case here is arranged around that.
 *
 * jsdom implements neither API, which is convenient: nothing is stubbed out from
 * under a working implementation, and the "no clipboard at all" case is simply
 * the environment as it comes.
 */

const TEXT = 'https://spinnerly.app/w/aBcDeFgHiJkLmNoPqRsT'

/** Installs a `navigator.clipboard`, or removes it when handed `undefined`. */
function setClipboard(
  clipboard: { writeText: (text: string) => Promise<void> } | undefined,
) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  })
}

/**
 * Installs a `document.execCommand`, which jsdom does not have. The stub reports
 * what was actually in the DOM at the moment it was called, since the whole
 * mechanism is "put the text in a field, select it, copy the selection" and a
 * stub that only counted calls would pass over an empty field.
 */
function setExecCommand(result: boolean | (() => boolean)) {
  const copied: string[] = []
  const execCommand = vi.fn((command: string) => {
    if (command !== 'copy') return false
    copied.push(document.querySelector('textarea')?.value ?? '')
    return typeof result === 'function' ? result() : result
  })

  Object.defineProperty(globalThis.document, 'execCommand', {
    value: execCommand,
    configurable: true,
  })

  return { execCommand, copied }
}

afterEach(() => {
  setClipboard(undefined)
  Reflect.deleteProperty(globalThis.document, 'execCommand')
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('writes through the clipboard API when there is one', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    setClipboard({ writeText })
    const { execCommand } = setExecCommand(true)

    await copyText(TEXT)

    expect(writeText).toHaveBeenCalledWith(TEXT)
    expect(
      execCommand,
      'the deprecated path is a fallback, not a belt-and-braces second write',
    ).not.toHaveBeenCalled()
  })

  it('falls back to execCommand outside a secure context', async () => {
    setClipboard(undefined)
    const { execCommand, copied } = setExecCommand(true)

    await copyText(TEXT)

    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(
      copied,
      'the field must hold the text when the copy happens',
    ).toEqual([TEXT])
  })

  /**
   * The gesture is the point. Both routes are gesture-gated, and the browser
   * decides by asking whether it is still inside the task the click started — so
   * an `await` before the fallback spends it, and the fallback then fails for a
   * reason that has nothing to do with the clipboard. Asserting that the call
   * has already happened before the promise settles is what pins that down; a
   * plain `await copyText(...)` would pass either way.
   */
  it('reaches the fallback synchronously, while the gesture is still live', () => {
    setClipboard(undefined)
    const { execCommand } = setExecCommand(true)

    void copyText(TEXT)

    expect(execCommand).toHaveBeenCalledTimes(1)
  })

  /**
   * A rejection is not the same as an absence: `writeText` rejects when the
   * clipboard-write permission is denied, which `execCommand` does not consult.
   * It may well fail for the gesture reason above, but a fallback that sometimes
   * works beats one that never runs.
   */
  it('tries the fallback when the clipboard API refuses', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('denied')) })
    const { execCommand } = setExecCommand(true)

    await copyText(TEXT)

    expect(execCommand).toHaveBeenCalledWith('copy')
  })

  it.each([
    {
      label: 'no clipboard and no execCommand',
      arrange: () => {
        setClipboard(undefined)
      },
    },
    {
      label: 'no clipboard and a refused execCommand',
      arrange: () => {
        setClipboard(undefined)
        setExecCommand(false)
      },
    },
    {
      label: 'no clipboard and an execCommand that throws',
      arrange: () => {
        setClipboard(undefined)
        setExecCommand(() => {
          throw new Error('not allowed')
        })
      },
    },
    {
      label: 'a refused clipboard and a refused execCommand',
      arrange: () => {
        setClipboard({ writeText: () => Promise.reject(new Error('denied')) })
        setExecCommand(false)
      },
    },
  ])('rejects rather than reporting a copy — $label', async ({ arrange }) => {
    arrange()

    await expect(
      copyText(TEXT),
      'a caller that resolves here shows “Copied” over an untouched clipboard',
    ).rejects.toThrow()
  })

  it.each([
    { label: 'a successful copy', result: true },
    { label: 'a refused copy', result: false },
  ])('leaves no field behind after $label', async ({ result }) => {
    setClipboard(undefined)
    setExecCommand(result)

    await copyText(TEXT).catch(() => undefined)

    expect(
      document.querySelector('textarea'),
      'the throwaway field outlived the copy',
    ).toBeNull()
  })

  /**
   * Copying a link should not also destroy whatever the user had highlighted —
   * plausibly the URL itself, half-selected by hand, which is why they reached
   * for the button.
   *
   * **The stub has to clear the selection for this to test anything**, and that
   * is the awkward part of the case rather than a trick. In a browser it is
   * `field.select()` that takes the selection away; jsdom's `select()` moves the
   * textarea's own selection range and leaves `document.getSelection()` alone,
   * so with a passive stub this case passes just as happily against an
   * implementation that never restores anything — verified by disabling the
   * restore and watching it stay green. Simulating the loss at the point a
   * browser causes it puts the capture-and-restore back under test: that the
   * range is taken before the field is appended, and put back after it is gone.
   */
  it('puts the user’s own selection back', async () => {
    const paragraph = document.createElement('p')
    paragraph.textContent = 'the sentence the user had selected'
    document.body.append(paragraph)

    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    setClipboard(undefined)
    setExecCommand(() => {
      document.getSelection()?.removeAllRanges()
      return true
    })

    await copyText(TEXT)

    expect(document.getSelection()?.toString()).toBe(
      'the sentence the user had selected',
    )
  })
})
