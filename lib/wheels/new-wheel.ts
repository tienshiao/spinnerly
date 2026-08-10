'use client'

/**
 * "This tab is the one that made this wheel" — a one-shot signal from the create
 * flow to the page it navigates to.
 *
 * Not part of the client data path the CLAUDE.md table describes: nothing here
 * reads or writes Firestore, and no other module in ./ depends on it. It lives
 * beside them because both of its callers are about wheels — app/create-wheel-button.tsx
 * sets it, app/w/[shareId]/wheel-page.tsx spends it — and a lone util at the top
 * of lib/ would be harder to find than a wrongly-filed one.
 *
 * **`sessionStorage`, not a `?new=1` on the URL**, and the difference matters
 * more than it looks. The edit URL is the only key to the wheel (design doc
 * section 2) so people bookmark it, paste it and hand it on — and a query
 * parameter goes with it, announcing "just created" to a co-organiser opening
 * the link a week later. What is being recorded is a fact about this tab's
 * history, not about the wheel, so it belongs in this tab's storage. It also
 * keeps the URL exactly what §2 says it is, with the token in the fragment and
 * nothing else anywhere.
 */

/**
 * One slot, holding the most recently created share ID.
 *
 * A slot per wheel would accumulate for the life of the tab and would keep a
 * promise nobody asked for: make a wheel, go back, make another, and the first
 * one is no longer the wheel you just created — so the banner not appearing on
 * it later is right rather than a lost flag.
 */
const KEY = 'spinnerly:created-wheel'

/**
 * Every access is wrapped, because `sessionStorage` is not merely absent on the
 * server — it throws on read AND on write when storage is disabled, which is an
 * ordinary browser setting and not an exotic one. Nothing here is worth an
 * exception escaping into a create flow that otherwise worked: the cost of
 * losing it is one missing banner.
 */
function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined
  } catch {
    return undefined
  }
}

/** Called by the create flow, before it navigates. */
export function markWheelCreated(shareId: string): void {
  try {
    storage()?.setItem(KEY, shareId)
  } catch {
    // Storage full, or refused. See above.
  }
}

/**
 * Answered once per wheel per page load, and then remembered.
 *
 * This is what makes `consumeWheelCreated` safe to call from a `useState`
 * initializer, which is where its caller needs it: React invokes an initializer
 * twice in development to shake out impure ones, and a second call that went
 * back to a storage slot it had already emptied would answer differently from
 * the first. Idempotence turns "spend it" into "ask what it said", which is a
 * question with the same answer every time.
 */
const answers = new Map<string, boolean>()

/**
 * Called by the wheel page on arrival. Answers "was this wheel created in this
 * tab" and forgets on the way out, so a RELOAD of the same URL is an ordinary
 * visit — which is what makes the notice a moment rather than a fixture the
 * reader learns to skip. Within one page load the answer stands, so a remount
 * does not lose a notice that was never read.
 */
export function consumeWheelCreated(shareId: string): boolean {
  const remembered = answers.get(shareId)
  if (remembered !== undefined) return remembered

  /**
   * No storage, no memory — and the early return is about the SERVER rather
   * than about a browser with storage disabled. This module is imported by a
   * client component, which Next still renders on the server, so `answers` is
   * also module state in a long-lived Node process where nothing ever ends a
   * "page load" to clear it. Caching there would add an entry per distinct
   * share ID ever requested and never drop one. There is nothing to remember
   * anyway: with no storage the answer is `false` on every call by
   * construction, so idempotence holds without the map.
   */
  const store = storage()
  if (store === undefined) return false

  const answer = spend(store, shareId)
  answers.set(shareId, answer)
  return answer
}

function spend(store: Storage, shareId: string): boolean {
  try {
    if (store.getItem(KEY) !== shareId) return false
    store.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

/**
 * Test-only. The cache above is module state, which in a browser is scoped to a
 * page load and in a test file is scoped to the whole run — so without this,
 * the second case to use a given share ID gets the first case's answer.
 */
export function forgetCreatedWheels(): void {
  answers.clear()
}
