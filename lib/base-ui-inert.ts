'use client'

import * as React from 'react'

/**
 * Workaround for mui/base-ui#4678 — a modal popup hides background content from
 * assistive technology but leaves it in the tab order.
 *
 * Base UI's FloatingFocusManager calls `markOthers()` with `ariaHidden` and
 * never with `inert`. `aria-hidden` removes an element from the accessibility
 * tree but not from sequential focus navigation, so every button, link and
 * input behind an open modal stays tabbable. axe-core and IBM Equal Access
 * both flag this as a WCAG 2.1 SC 4.1.2 violation.
 *
 * The upstream fix is PR #4714, which applies `inert` for `modal={true}` and
 * skips focus guards. It has been open since June 2026, stalled on reviewer
 * concerns about `inert` side effects and failing Drawer tests. This mirrors
 * that fix from the outside using the marker Base UI already stamps, so when
 * #4714 lands this file and its call sites — `useInertPopup` in both dialogs —
 * can be deleted outright.
 *
 * Two details make this fiddlier than "mirror the marker onto inert":
 *
 *  - The marker is not a modality signal. `markOthers()` stamps it whenever
 *    the popup is open, independent of `modal`, so mirroring it unconditionally
 *    would freeze the page behind a deliberately non-modal dialog. Modality is
 *    therefore passed in by the caller rather than sniffed from the DOM.
 *
 *    Note that `aria-hidden` looks like it should serve as that signal and does
 *    not. Base UI runs two separate `markOthers()` passes with different
 *    inside-sets, so the two attributes land on different elements: `<main>`
 *    gets the marker but no `aria-hidden` (it is kept in the path because it
 *    contains the trigger), while its children get `aria-hidden` but no marker.
 *    Requiring both matches essentially nothing.
 *
 *  - The marker also lands on the focus guards, the internal backdrop and the
 *    overlay, all of which live inside the portal. Inerting the guards would
 *    break the focus trap outright, and inerting the overlay would swallow the
 *    clicks that dismiss the dialog. Anything inside the portal is skipped.
 */

const MARKER = 'data-base-ui-inert'
const FOCUS_GUARD = 'data-base-ui-focus-guard'

/**
 * @param scope an element inside the popup's portal, or null while the popup is
 * unmounted. Everything in that portal is left alone; everything else Base UI
 * has marked as outside the floating tree is made inert.
 *
 * Takes the element rather than a ref on purpose. The popup only mounts when
 * the dialog opens, which is after the calling component mounts, so a ref would
 * still be null when the effect first ran and mutating it would not schedule a
 * re-run. Passing the element from a callback ref makes the effect fire when
 * the popup actually appears.
 *
 * @param enabled pass the popup's own modality. Only a fully modal popup should
 * inert the background — `modal="trap-focus"` deliberately keeps outside
 * pointer interaction alive, and `inert` would kill it.
 *
 * @param restoreFocusTo the trigger, as a focus-restore fallback.
 *
 * Inerting the background costs the library's own focus restore on the Escape
 * path: Base UI returns focus to the trigger while the trigger is still inside
 * the inert subtree, the browser drops the call, and focus lands on <body>.
 * Releasing inert earlier does not fix it — React cannot schedule a cleanup
 * before a handler that runs synchronously on keydown. Measured: closing by
 * button restores correctly, closing by Escape does not.
 *
 * So the restore is redone here, but only as a fallback: it fires on a
 * microtask after inert is released, and only when focus actually fell to
 * <body>. When the library's own restore worked, `document.activeElement` is
 * not <body> and this does nothing.
 */
export function useInertBackground(
  scope: HTMLElement | null,
  enabled: boolean,
  restoreFocusTo?: React.RefObject<HTMLElement | null>,
) {
  React.useEffect(() => {
    if (!scope || !enabled) return

    // Captured now rather than read in the cleanup: the trigger is mounted
    // before the popup and does not change while the dialog is open, and by
    // cleanup time the ref may already have been detached.
    const restoreTarget = restoreFocusTo?.current ?? null

    // The portal root is whichever top-level node the popup ended up inside.
    const portalRoot =
      Array.from(document.body.children).find((el) => el.contains(scope)) ??
      null

    // Only ever release what this hook set, so a pre-existing `inert` from
    // application code or a nested popup survives untouched.
    const owned = new Set<HTMLElement>()

    const sync = () => {
      const current = new Set<HTMLElement>()

      for (const el of document.querySelectorAll<HTMLElement>(`[${MARKER}]`)) {
        if (el.hasAttribute(FOCUS_GUARD)) continue
        if (portalRoot?.contains(el)) continue

        current.add(el)
        if (!el.inert) {
          el.inert = true
          owned.add(el)
        }
      }

      for (const el of owned) {
        if (!current.has(el)) {
          el.inert = false
          owned.delete(el)
        }
      }
    }

    // Base UI marks the background in its own effect, which may not have run
    // yet, so observe rather than only sampling once.
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [MARKER],
    })

    return () => {
      observer.disconnect()
      for (const el of owned) el.inert = false
      owned.clear()

      // The background is focusable again as of the line above, but the
      // library's restore has usually already run and failed by now. Defer one
      // microtask so any restore still in flight wins, then only step in if
      // focus genuinely ended up nowhere.
      if (!restoreTarget) return
      queueMicrotask(() => {
        if (
          document.activeElement === document.body &&
          restoreTarget.isConnected
        ) {
          restoreTarget.focus()
        }
      })
    }
  }, [scope, enabled, restoreFocusTo])
}

/**
 * The plumbing a dialog needs to drive `useInertBackground`, in one place.
 *
 * The popup's element has to be carried twice, and the pairing is the subtle
 * part: a REF for Base UI's `initialFocus`, which wants one, and STATE so that
 * the popup mounting — which happens when the dialog opens, long after the
 * calling component mounts — actually re-runs the inert effect. A ref alone
 * would still be null the one time the effect ran, and an inert effect that
 * never fires fails silently: the page behind the dialog simply stays tabbable.
 *
 * Extracted because that pairing was copied line for line into both dialogs,
 * where a future copy that forgets the state half would reintroduce exactly
 * that silent failure. Deleted along with `useInertBackground` when the
 * upstream fix lands.
 *
 * @param enabled the popup's modality AND its openness — pass what
 * `useInertBackground` should see, e.g. `modal === true && open`.
 * @param restoreFocusTo where focus goes back to when the dialog closes, as the
 * fallback `useInertBackground` documents.
 */
export function useInertPopup(
  enabled: boolean,
  restoreFocusTo?: React.RefObject<HTMLElement | null>,
): {
  popupRef: React.RefObject<HTMLDivElement | null>
  attachPopup: (node: HTMLDivElement | null) => void
} {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const [popupEl, setPopupEl] = React.useState<HTMLDivElement | null>(null)
  const attachPopup = React.useCallback((node: HTMLDivElement | null) => {
    popupRef.current = node
    setPopupEl(node)
  }, [])

  useInertBackground(popupEl, enabled, restoreFocusTo)

  return { popupRef, attachPopup }
}
