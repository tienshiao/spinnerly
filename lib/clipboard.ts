'use client'

/**
 * Copying text to the clipboard, in the two ways a browser offers.
 *
 * `navigator.clipboard` is the one worth having and is absent more often than
 * its ubiquity suggests: it is gated on a secure context, so it is undefined on
 * a plain-http preview build and on any page reached by IP address rather than
 * by name. Spinnerly's whole interaction model is "send someone a link", so the
 * copy button failing on a LAN preview is not a hypothetical.
 *
 * The fallback is `document.execCommand('copy')` over a throwaway textarea.
 * Deprecated, and kept anyway: nothing has replaced it for insecure contexts,
 * and the alternative is telling the user to select the URL out of an error
 * message by hand.
 */

/**
 * Copies `text`, or throws if neither route worked.
 *
 * **Must be called from a user gesture, and must not be awaited into.** Both
 * routes are gesture-gated, and an `await` before them spends it: the browser
 * checks whether it is still inside the task the click started, and a resolved
 * promise has already left it. This is why the missing-clipboard case below
 * jumps straight to the fallback rather than going through a rejected write.
 */
export async function copyText(text: string): Promise<void> {
  /**
   * Tested for rather than optional-chained, and the difference is a lie on
   * screen. `navigator.clipboard?.writeText(text)` evaluates to `undefined` on a
   * browser that has no clipboard, which awaits successfully — so the caller
   * would confirm a copy that never happened and the user would paste whatever
   * was there before.
   */
  if (globalThis.navigator?.clipboard === undefined) {
    if (copyByExecCommand(text)) return
    throw new Error('This browser would not let the page reach the clipboard.')
  }

  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    /**
     * One more try, and it is worth the attempt rather than being cargo cult:
     * `writeText` rejects on a denied clipboard-write permission, which
     * `execCommand` does not consult. It may well fail here for the reason at
     * the top of this file — the rejection above was awaited, so the gesture is
     * spent — but a fallback that sometimes works beats one that never runs.
     */
    if (copyByExecCommand(text)) return
    throw error
  }
}

/**
 * The pre-2018 way: put the text in a field, select it, and ask the document to
 * copy the selection.
 *
 * Returns whether it worked rather than throwing, because "this browser has no
 * `execCommand`" and "`execCommand` said no" are the same answer to the only
 * caller — try the other thing, or give up.
 */
function copyByExecCommand(text: string): boolean {
  /**
   * Reached through `globalThis`, and checked for the METHOD rather than for the
   * document. A bare `document` is a ReferenceError where there is none — the
   * server render — which `?.` does not save you from, and jsdom (and any other
   * partial DOM) supplies a `document` that has no `execCommand` on it.
   */
  const dom = globalThis.document
  if (typeof dom?.execCommand !== 'function') return false

  const field = document.createElement('textarea')
  field.value = text

  /**
   * Off-screen, but not `display: none` or `hidden`: a field the layout does not
   * place cannot hold a selection, and `execCommand('copy')` copies the
   * selection. `position: fixed` keeps it out of the flow without scrolling the
   * page to it, and `readOnly` stops a mobile keyboard sliding up for the
   * fraction of a second the field exists.
   */
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.opacity = '0'
  field.style.pointerEvents = 'none'
  // Focus follows selection here, so keep it off the tab order — the field is
  // removed again before anything could reach it, but a stray tab stop
  // appearing mid-copy is not worth the saving.
  field.tabIndex = -1
  field.setAttribute('aria-hidden', 'true')

  document.body.append(field)

  // Whatever the user had selected before pressing the button, restored below.
  // Copying should not also clear their selection, and on a page where the
  // thing being copied is a URL they may well have been mid-select on it.
  const previous = document.getSelection()
  const restore =
    previous !== null && previous.rangeCount > 0
      ? previous.getRangeAt(0)
      : undefined

  /**
   * And whatever had focus, for the same reason. `select()` below moves focus
   * into the textarea and `remove()` then drops it to `<body>` — so someone who
   * reached the copy button by tabbing is returned to the top of the document
   * with nothing on screen to explain it. That lands only on the insecure-context
   * build this fallback exists for, which is exactly where nobody is looking.
   */
  const focused = document.activeElement

  let copied = false
  try {
    field.select()
    // iOS ignores `select()` on a readonly field and needs the range set
    // explicitly. Harmless everywhere else.
    field.setSelectionRange(0, text.length)
    copied = document.execCommand('copy')
  } catch {
    // `execCommand` throws rather than returning false in some browsers, and
    // the two mean the same thing to the caller.
    copied = false
  } finally {
    field.remove()

    // Focus before selection, not after: `focus()` collapses the document
    // selection in some engines, so restoring in the other order undoes the
    // restore that just ran.
    if (focused instanceof HTMLElement) focused.focus()

    if (restore !== undefined) {
      const selection = document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(restore)
    }
  }

  return copied
}
