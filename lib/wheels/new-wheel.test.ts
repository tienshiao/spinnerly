// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  consumeWheelCreated,
  forgetCreatedWheels,
  markWheelCreated,
} from './new-wheel'

/**
 * The one-shot "this tab made this wheel" signal behind the edit-key warning.
 *
 * Two properties carry the whole thing, and they pull in opposite directions:
 * it has to be spent — a warning that returns on every visit is one nobody
 * reads — and it has to be stable within a page load, because its reader is a
 * `useState` initializer and React calls those twice in development. The cases
 * below are mostly about the seam between them.
 */

const A = 'aBcDeFgHiJkLmNoPqRsT'
const B = 'zYxWvUtSrQpOnMlKjIhG'

/** What a reload is, from this module's point of view: the cache goes, the
 *  storage stays. Also what `beforeEach` needs, since the cache is module state
 *  and outlives any one case. */
function reload() {
  forgetCreatedWheels()
}

/** Puts a `sessionStorage` in place of jsdom's, or removes it entirely. */
function setStorage(value: unknown) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value,
    configurable: true,
  })
}

const realStorage = globalThis.sessionStorage

beforeEach(() => {
  setStorage(realStorage)
  globalThis.sessionStorage.clear()
  reload()
})

afterEach(() => {
  setStorage(realStorage)
})

describe('the created-wheel signal', () => {
  it('is set by the create flow and read by the wheel it created', () => {
    markWheelCreated(A)

    expect(consumeWheelCreated(A)).toBe(true)
  })

  it('is not set for a wheel that was merely visited', () => {
    expect(consumeWheelCreated(A)).toBe(false)
  })

  /**
   * The double-invocation property. React calls a `useState` initializer twice
   * in development to shake out impure ones, so an implementation that went back
   * to an emptied storage slot on the second call would answer `false` — and the
   * banner would be missing in development and present in production, which is
   * the worst way round to find out.
   */
  it('gives the same answer to a repeated read within a page load', () => {
    markWheelCreated(A)

    expect(consumeWheelCreated(A)).toBe(true)
    expect(consumeWheelCreated(A), 'the second read is React’s').toBe(true)
  })

  /** Spent, though — so the warning is a moment and not a fixture. */
  it('is gone on the next load of the same URL', () => {
    markWheelCreated(A)
    expect(consumeWheelCreated(A)).toBe(true)

    reload()

    expect(consumeWheelCreated(A)).toBe(false)
  })

  /**
   * One slot, so the most recent creation wins. Reaching the older wheel again
   * later is an ordinary visit, which is the right answer: it is no longer the
   * wheel you just made.
   */
  it('follows the most recently created wheel', () => {
    markWheelCreated(A)
    markWheelCreated(B)

    expect(consumeWheelCreated(A)).toBe(false)
    expect(consumeWheelCreated(B)).toBe(true)
  })

  /** Asking about someone else's wheel must not spend the answer to your own. */
  it('is not consumed by a read for a different wheel', () => {
    markWheelCreated(A)

    expect(consumeWheelCreated(B)).toBe(false)
    expect(consumeWheelCreated(A)).toBe(true)
  })
})

/**
 * Storage is refusable — it is an ordinary browser setting, and Safari's private
 * mode throws rather than returning null. None of that is worth an exception
 * escaping into a create flow that otherwise worked: the cost of losing this
 * signal is one missing notice.
 */
describe('when sessionStorage will not cooperate', () => {
  const throwing = {
    getItem() {
      throw new Error('access denied')
    },
    setItem() {
      throw new Error('access denied')
    },
    removeItem() {
      throw new Error('access denied')
    },
  }

  it.each([
    { label: 'it is absent, as on the server', value: undefined },
    { label: 'every access throws', value: throwing },
  ])('marks and reads without throwing when $label', ({ value }) => {
    setStorage(value)

    expect(() => {
      markWheelCreated(A)
    }).not.toThrow()
    expect(consumeWheelCreated(A)).toBe(false)
  })

  /**
   * A slot that reads back but will not clear. The read must not report a
   * creation it cannot then spend, or the notice returns on every load — the
   * fixture the whole design is arranged to avoid.
   */
  it('does not claim a creation it cannot spend', () => {
    setStorage({
      getItem: () => A,
      setItem: () => undefined,
      removeItem() {
        throw new Error('access denied')
      },
    })

    expect(consumeWheelCreated(A)).toBe(false)
  })
})
