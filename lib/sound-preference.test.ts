// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SOUND_STORAGE_KEY,
  forgetSoundPreference,
  isSoundOn,
  setSoundOn,
  subscribeSound,
} from './sound-preference'

/**
 * The mute flag.
 *
 * Small enough to look self-evident, and two of its cases are the ones that
 * decide whether the feature is well behaved: it is ON when nothing has been
 * stored, so the sound ships rather than hiding behind a control nobody finds;
 * and it survives a `localStorage` that throws, which is not exotic — a browser
 * with site data blocked throws from the property GETTER, before any method is
 * called.
 */

beforeEach(() => {
  globalThis.localStorage.clear()
  // Module state outlives a test file, and the cache is module state.
  forgetSoundPreference()
})

afterEach(() => {
  vi.unstubAllGlobals()
  forgetSoundPreference()
})

describe('the default', () => {
  it('is on, with nothing stored', () => {
    expect(isSoundOn()).toBe(true)
  })

  /**
   * Anything unrecognised reads as on, rather than as off. The slot is written
   * by exactly one line of this app, so a value that is neither is either an
   * older version of it or another product on the same origin — and a wheel
   * that went silent because of somebody else's key would be unexplainable from
   * the page.
   */
  it('is on for a value it did not write', () => {
    globalThis.localStorage.setItem(SOUND_STORAGE_KEY, 'yes-please')

    expect(isSoundOn()).toBe(true)
  })
})

describe('setting it', () => {
  it('remembers off across a reload', () => {
    setSoundOn(false)

    // What a reload is, for a module: the cache goes, the storage stays.
    forgetSoundPreference()
    expect(isSoundOn()).toBe(false)
  })

  /** On is the absence of the key, so unmuting leaves no trace behind. */
  it('clears the key when it goes back on', () => {
    setSoundOn(false)
    setSoundOn(true)

    expect(globalThis.localStorage.getItem(SOUND_STORAGE_KEY)).toBeNull()
    forgetSoundPreference()
    expect(isSoundOn()).toBe(true)
  })

  it('tells its subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSound(listener)

    setSoundOn(false)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setSoundOn(true)
    expect(listener, 'still listening after unsubscribe').toHaveBeenCalledTimes(
      1,
    )
  })

  /**
   * `storage` fires in the OTHER tabs and never in the one that wrote, so a
   * second tab muting the wheel has to arrive this way. Dispatched by hand
   * because jsdom does not cross tabs.
   */
  it('picks up a change made in another tab', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSound(listener)

    globalThis.localStorage.setItem(SOUND_STORAGE_KEY, 'off')
    globalThis.dispatchEvent(
      new StorageEvent('storage', { key: SOUND_STORAGE_KEY }),
    )

    expect(listener).toHaveBeenCalledTimes(1)
    expect(isSoundOn()).toBe(false)

    unsubscribe()
  })

  it('ignores another key changing in another tab', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSound(listener)

    globalThis.dispatchEvent(
      new StorageEvent('storage', { key: 'something-else' }),
    )

    expect(listener).not.toHaveBeenCalled()

    unsubscribe()
  })
})

/**
 * Site data blocked, private browsing, a full quota. The preference still holds
 * for the life of the page — it just does not outlive it, which is a better
 * answer than a toggle that throws when pressed.
 */
describe('storage that refuses', () => {
  function refuse(): void {
    vi.stubGlobal('localStorage', {
      get getItem(): never {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      setItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
      removeItem() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  }

  it('reads as on', () => {
    refuse()

    expect(isSoundOn()).toBe(true)
  })

  it('still mutes for this page', () => {
    refuse()

    expect(() => {
      setSoundOn(false)
    }).not.toThrow()
    expect(isSoundOn()).toBe(false)
  })
})
