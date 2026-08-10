'use client'

import { useSyncExternalStore } from 'react'

/**
 * Whether the wheel makes a noise, as an external store.
 *
 * One source of truth for two readers that must not disagree: the speaker
 * toggle, which draws it, and components/wheel/sounds.ts, which obeys it. A
 * `useState` in the page would leave the audio layer asking React for a value it
 * cannot see, and a prop threaded down to it would mean the sound stops
 * depending on a render having happened first.
 *
 * **On unless someone has said otherwise.** The sound is only ever the direct
 * consequence of a click on Spin the wheel — never on load, never in the
 * background — so it is not the autoplay pattern the default-off convention
 * exists to protect people from.
 */

export const SOUND_STORAGE_KEY = 'spinnerly.sound'

/** What `setSoundOn(false)` writes. Anything else in the slot reads as on. */
const OFF = 'off'

const listeners = new Set<() => void>()

/**
 * Cached, and that is not an optimisation.
 *
 * `useSyncExternalStore` compares snapshots by identity on every render and
 * re-renders when they differ — so a getter that touched `localStorage` each
 * time would be fine here only because booleans compare by value. What it would
 * not be fine for is the cost: this is read during render, and `localStorage` is
 * synchronous and blocks. `null` means "not read yet".
 */
let cached: boolean | null = null

function readStorage(): boolean {
  try {
    // Optional-chained because the whole `localStorage` GETTER throws in a
    // browser with site data blocked, not merely `getItem` — so the try/catch
    // is doing the work and the chain is only for a non-browser environment.
    return globalThis.localStorage?.getItem(SOUND_STORAGE_KEY) !== OFF
  } catch {
    return true
  }
}

export function isSoundOn(): boolean {
  if (cached === null) cached = readStorage()
  return cached
}

export function setSoundOn(on: boolean): void {
  cached = on

  try {
    if (on) globalThis.localStorage?.removeItem(SOUND_STORAGE_KEY)
    else globalThis.localStorage?.setItem(SOUND_STORAGE_KEY, OFF)
  } catch {
    // Private browsing, a full quota, blocked site data. The preference still
    // holds for this page — it just will not outlive it, which is a better
    // answer than a toggle that throws when pressed.
  }

  for (const listener of listeners) listener()
}

/**
 * Forgets the cached value. Tests only, where one file's `localStorage` is the
 * next file's, and module state outlives both.
 */
export function forgetSoundPreference(): void {
  cached = null
}

export function subscribeSound(onChange: () => void): () => void {
  listeners.add(onChange)

  /**
   * `storage` fires in the OTHER tabs, never the one that wrote — which is why
   * the local set above notifies its own listeners by hand. Together they mean
   * muting in one tab mutes the wheel in all of them, which is what someone
   * reaching for the control in a hurry expects.
   */
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SOUND_STORAGE_KEY) return
    cached = readStorage()
    onChange()
  }

  globalThis.addEventListener?.('storage', onStorage)

  return () => {
    listeners.delete(onChange)
    globalThis.removeEventListener?.('storage', onStorage)
  }
}

/**
 * The server renders the sound as on.
 *
 * It cannot know better — the preference is in the browser's storage — and
 * `useSyncExternalStore` is built for exactly this: it renders the server
 * snapshot through hydration and re-renders with the real one immediately
 * after, so a muted visitor gets no hydration mismatch and at worst one frame of
 * the wrong icon. In practice not even that, since the wheel page waits on its
 * first snapshot and on the role before it draws anything at all.
 */
function getServerSnapshot(): boolean {
  return true
}

export function useSoundOn(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundOn, getServerSnapshot)
}
