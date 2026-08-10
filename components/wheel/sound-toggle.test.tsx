// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SOUND_STORAGE_KEY,
  forgetSoundPreference,
  isSoundOn,
} from '@/lib/sound-preference'

import { SoundToggle } from './sound-toggle'

/** The control, and the two things about it that are not obvious from reading it. */

function toggle(): HTMLElement {
  return screen.getByRole('button', { name: 'Sound effects' })
}

beforeEach(() => {
  globalThis.localStorage.clear()
  forgetSoundPreference()
})

afterEach(() => {
  cleanup()
  forgetSoundPreference()
})

it('starts pressed, because the sound starts on', () => {
  render(<SoundToggle />)

  expect(toggle().getAttribute('aria-pressed')).toBe('true')
})

it('mutes, and says so', async () => {
  const user = userEvent.setup()
  render(<SoundToggle />)

  await user.click(toggle())

  expect(toggle().getAttribute('aria-pressed')).toBe('false')
  expect(isSoundOn()).toBe(false)
  expect(globalThis.localStorage.getItem(SOUND_STORAGE_KEY)).toBe('off')
})

it('unmutes again', async () => {
  const user = userEvent.setup()
  render(<SoundToggle />)

  await user.click(toggle())
  await user.click(toggle())

  expect(toggle().getAttribute('aria-pressed')).toBe('true')
  expect(isSoundOn()).toBe(true)
})

/**
 * It reads the store rather than holding its own state, which is what a second
 * instance proves: both are drawn from the same value, so the icon in one place
 * cannot disagree with what the audio layer is obeying — or with another tab.
 */
it('follows the store rather than its own state', async () => {
  const user = userEvent.setup()
  render(
    <>
      <SoundToggle />
      <SoundToggle />
    </>,
  )

  const [first, second] = screen.getAllByRole('button', {
    name: 'Sound effects',
  })
  await user.click(first)

  expect(second.getAttribute('aria-pressed')).toBe('false')
})

describe('what it shows', () => {
  it('names the action for a pointer, and the state for everyone else', () => {
    render(<SoundToggle />)

    // The label is stable and `aria-pressed` carries the state, which is the
    // toggle-button pattern; the title is for the mouse user who gets neither.
    expect(toggle().getAttribute('title')).toBe('Mute the wheel')
  })
})
