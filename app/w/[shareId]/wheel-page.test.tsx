// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WheelApi } from '@/lib/wheels/api-client'
import {
  consumeWheelCreated,
  forgetCreatedWheels,
  markWheelCreated,
} from '@/lib/wheels/new-wheel'

/**
 * The wheel page shell: role resolution, the header, and the states either side
 * of a wheel that loaded.
 *
 * Role is the whole subject. Design doc section 2 makes it a property of the
 * URL and of nothing else, and the failure modes are all invisible in review:
 * a page that renders the participant view for one frame before flipping (AC 5),
 * a truncated edit link rendering a full editor that fails on use (AC 3), or a
 * "copy link" button that copies the fragment along with it and quietly hands
 * everyone in the channel edit rights.
 *
 * Firestore is driven by hand, as in lib/wheels/use-wheel-session.test.ts, so a
 * snapshot can be made to arrive before or after the verification it races.
 */

const SHARE_ID = 'aBcDeFgHiJkLmNoPqRsT'
const TOKEN = 'K3n8x_Qw-2bT4vZ1'
const NEW_ID = 'zYxWvUtSrQpOnMlKjIhG'
/** The id `POST /options` answers with, and the one the snapshot then carries. */
const ADDED_ID = 'o3'
/** The same, for `POST /suggestions`. */
const SENT_ID = 's9'

type Recorded = {
  path: string
  next: (snapshot: unknown) => void
  fail: (error: unknown) => void
}

const firestore = vi.hoisted(() => ({ listeners: [] as Recorded[] }))
const nav = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('@/lib/firebase/client', () => ({
  getClientDb: () => ({ marker: 'client-db' }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
}))

vi.mock('firebase/firestore', () => {
  const reference = (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })
  return {
    doc: reference,
    collection: reference,
    onSnapshot: (
      ref: { path: string },
      next: (snapshot: unknown) => void,
      fail: (error: unknown) => void,
    ) => {
      firestore.listeners.push({ path: ref.path, next, fail })
      return vi.fn()
    },
  }
})

const { WheelPage } = await import('./wheel-page')

function listener(suffix: string): Recorded {
  const found = firestore.listeners.filter((entry) =>
    entry.path.endsWith(suffix),
  )
  expect(found, `no listener on ${suffix}`).toHaveLength(1)
  return found[0]
}

type QueuedSuggestion = {
  id: string
  label: string
  status?: 'pending' | 'accepted'
}

/** Deliver a wheel and a queue, which together are what "loaded" means here. */
function deliver(
  options: { id: string; label: string; fromSuggestion?: string }[] = [],
  queue: QueuedSuggestion[] = [],
  wheel: { suggestionsOpen?: boolean } = {},
) {
  act(() => {
    listener(SHARE_ID).next({
      exists: () => true,
      data: () => ({
        title: 'Team lunch',
        suggestionsOpen: wheel.suggestionsOpen ?? true,
        updatedAt: new Date('2026-08-01T10:00:00.000Z'),
        options: options.map((option) => ({
          ...option,
          addedAt: null,
          fromSuggestion: option.fromSuggestion ?? null,
        })),
      }),
    })
    listener('suggestions').next({
      docs: queue.map((entry, index) => ({
        id: entry.id,
        data: () => ({
          label: entry.label,
          status: entry.status ?? 'pending',
          // Spaced a minute apart so `bySubmissionOrder` puts the queue in the
          // order it was written here rather than falling back to sorting on id.
          createdAt: new Date(Date.UTC(2026, 7, 1, 9, index)),
          expiresAt: null,
        }),
      })),
    })
  })
}

type Verdict = Awaited<ReturnType<WheelApi['verifyEditor']>>

/** A `WheelApi` with a controllable verdict and spies on what a test drives. */
function fakeApi(verdict: Verdict | Promise<Verdict> = 'editor') {
  const api = {
    verifyEditor: vi.fn(() => Promise.resolve(verdict)),
    updateWheel: vi.fn(() =>
      Promise.resolve({ updatedAt: new Date('2026-08-01T10:00:01.000Z') }),
    ),
    addOption: vi.fn((_shareId: string, input: { label: string }) =>
      Promise.resolve({
        option: {
          id: ADDED_ID,
          label: input.label,
          addedAt: null,
          fromSuggestion: null,
        },
        updatedAt: new Date('2026-08-01T10:00:01.000Z'),
      }),
    ),
    removeOption: vi.fn(() =>
      Promise.resolve({ updatedAt: new Date('2026-08-01T10:00:01.000Z') }),
    ),
    submitSuggestion: vi.fn((_shareId: string, input: { label: string }) =>
      Promise.resolve({
        suggestion: { id: SENT_ID, label: input.label, status: 'pending' },
        updatedAt: new Date('2026-08-01T10:00:01.000Z'),
      }),
    ),
    acceptSuggestion: vi.fn(() =>
      Promise.resolve({ updatedAt: new Date('2026-08-01T10:00:01.000Z') }),
    ),
    rejectSuggestion: vi.fn(() =>
      Promise.resolve({ updatedAt: new Date('2026-08-01T10:00:01.000Z') }),
    ),
    duplicateWheel: vi.fn(() =>
      Promise.resolve({ shareId: NEW_ID, editToken: 'forked-token' }),
    ),
  } as unknown as WheelApi

  return api as WheelApi & {
    verifyEditor: ReturnType<typeof vi.fn>
    updateWheel: ReturnType<typeof vi.fn>
    duplicateWheel: ReturnType<typeof vi.fn>
    addOption: ReturnType<typeof vi.fn>
    removeOption: ReturnType<typeof vi.fn>
    submitSuggestion: ReturnType<typeof vi.fn>
    acceptSuggestion: ReturnType<typeof vi.fn>
    rejectSuggestion: ReturnType<typeof vi.fn>
  }
}

function setHash(hash: string): void {
  globalThis.location.hash = hash
}

/** Mount, deliver a loaded wheel, and wait for the role to settle. */
async function mount(api: WheelApi, options?: { id: string; label: string }[]) {
  const view = render(<WheelPage shareId={SHARE_ID} api={api} />)
  deliver(
    options ?? [
      { id: 'o1', label: 'Tacos' },
      { id: 'o2', label: 'Ramen' },
    ],
  )
  await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy())
  return view
}

beforeEach(() => {
  firestore.listeners.length = 0
  nav.push.mockClear()
  setHash('')
  // Both, and both matter: the flag lives in storage, and the answer to it is
  // cached in module state that outlives any one case.
  globalThis.sessionStorage.clear()
  forgetCreatedWheels()
})

afterEach(cleanup)

describe('role resolution', () => {
  it('renders the participant view for a URL with no fragment', async () => {
    const api = fakeApi()

    await mount(api)

    expect(screen.getByText('Viewer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /spin the wheel/i })).toBeNull()
    // A share link asks nobody anything: the URL already says what it is.
    expect(api.verifyEditor).not.toHaveBeenCalled()
  })

  it('renders the editor view for a fragment the server accepts', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')

    await mount(api)

    expect(screen.getByText('Editor')).toBeTruthy()
    expect(screen.getByRole('button', { name: /spin the wheel/i })).toBeTruthy()
    expect(api.verifyEditor).toHaveBeenCalledWith(SHARE_ID, TOKEN)
  })

  /**
   * AC 3. Not an error page: the wheel is fine, and the holder of a truncated
   * link can still read it and suggest to it. The message has to name the
   * fragment, since dropping the part after the `#` is how this happens.
   */
  it('degrades a refused fragment to the participant view, with a message', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('not-editor')

    await mount(api)

    expect(screen.getByText('Viewer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /spin the wheel/i })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain(
      'not valid for this wheel',
    )
  })

  /**
   * AC 5, and the reason the page waits on both gates rather than the faster
   * one. The wheel has arrived and could be drawn; the role has not, so drawing
   * it would mean picking a side and correcting it a moment later — with the
   * spin button, the header controls and both panel variants moving when it
   * does.
   */
  it('shows a loading state, not a role, while verification is outstanding', async () => {
    setHash(`#e=${TOKEN}`)
    let answer!: (verdict: Verdict) => void
    const pending = new Promise<Verdict>((resolve) => {
      answer = resolve
    })
    const api = fakeApi(pending)

    render(<WheelPage shareId={SHARE_ID} api={api} />)
    deliver([{ id: 'o1', label: 'Tacos' }])

    expect(screen.getByText(/loading this wheel/i)).toBeTruthy()
    expect(screen.queryByText('Viewer')).toBeNull()
    expect(screen.queryByText('Editor')).toBeNull()

    await act(async () => {
      answer('editor')
      await pending
    })

    expect(screen.getByText('Editor')).toBeTruthy()
  })
})

describe('the header', () => {
  it('offers the title as static text to a participant', async () => {
    await mount(fakeApi())

    expect(screen.getByText('Team lunch')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /rename wheel/i })).toBeNull()
  })

  it('renames through PATCH when an editor commits the title', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.click(screen.getByRole('button', { name: /rename wheel/i }))
    await user.keyboard('Team dinner{Enter}')

    expect(api.updateWheel).toHaveBeenCalledWith(
      SHARE_ID,
      { title: 'Team dinner' },
      TOKEN,
    )
  })

  it('sends nothing when a rename is abandoned with Escape', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.click(screen.getByRole('button', { name: /rename wheel/i }))
    await user.keyboard('Team dinner{Escape}')

    expect(api.updateWheel).not.toHaveBeenCalled()
    expect(screen.getByText('Team lunch')).toBeTruthy()
  })

  /**
   * Blur closes an over-length draft instead of refusing it.
   *
   * Refusing is right for Enter, where the editor is still in the field and can
   * shorten what they wrote. On blur the focus has already gone, so refusing
   * left the input mounted, invalid and effectively unreachable — the header
   * stuck in edit mode with no visible way out.
   */
  it('reverts an over-length title when the field loses focus', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.click(screen.getByRole('button', { name: /rename wheel/i }))
    await user.keyboard('x'.repeat(90))

    expect(screen.getByText(/characters at most/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /copy share link/i }))

    expect(screen.queryByRole('textbox', { name: /wheel title/i })).toBeNull()
    expect(screen.getByText('Team lunch')).toBeTruthy()
    expect(api.updateWheel).not.toHaveBeenCalled()
  })

  /**
   * The confirmation belongs to the click that earned it. Without restarting
   * the timer, a second click at 1.9s reverts on the FIRST click's timer 100ms
   * later — so the copy the user was watching for is the one whose "Copied"
   * flashes past.
   */
  it('restarts the “Copied” label rather than letting an old timer end it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      })

      await mount(fakeApi())
      await user.click(screen.getByRole('button', { name: /copy share link/i }))
      expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1900)
      })
      await user.click(screen.getByRole('button', { name: /copied/i }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })

      expect(
        screen.queryByRole('button', { name: /copied/i }),
        'the second click’s confirmation must not end on the first click’s timer',
      ).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The copy button is the one control that can leak edit rights. An editor's
   * own address bar holds the token, so a button that copied "the current URL"
   * would promote every recipient of the link to an editor of a wheel they were
   * only meant to see.
   */
  it('copies the share URL without the fragment', async () => {
    setHash(`#e=${TOKEN}`)
    const user = userEvent.setup()
    // After `setup()`, deliberately: user-event installs a clipboard stub of
    // its own, so a spy planted first is silently replaced and the assertion
    // below would report zero calls for a button that worked perfectly.
    const writeText = vi.fn((text: string) => Promise.resolve(text))
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await mount(fakeApi('editor'))
    await user.click(screen.getByRole('button', { name: /copy share link/i }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = String(writeText.mock.calls[0][0])
    expect(copied).toContain(`/w/${SHARE_ID}`)
    expect(copied).not.toContain(TOKEN)
    expect(copied).not.toContain('#')
  })

  /**
   * TASK-21 AC 3, end to end. The clipboard API is gated on a secure context, so it is
   * absent on a plain-http preview build and on any page opened by IP address —
   * and "send someone a link" is the entire product, so this button failing on a
   * LAN preview is not a hypothetical.
   *
   * The point of the case is the pair of assertions at the end together: the
   * fallback carried the same fragment-free URL, AND the page said nothing went
   * wrong. Either alone would be satisfied by an implementation that quietly
   * confirmed a copy that never happened.
   */
  it('falls back to execCommand where there is no clipboard API', async () => {
    setHash(`#e=${TOKEN}`)
    const user = userEvent.setup()

    // Captured so the `finally` can put it back. Left as `undefined` it happens
    // to suit every later case in this file, which is exactly what makes it a
    // trap for the next one added.
    const realClipboard = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    )
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    const copied: string[] = []
    Object.defineProperty(globalThis.document, 'execCommand', {
      value: vi.fn((command: string) => {
        if (command !== 'copy') return false
        copied.push(document.querySelector('textarea')?.value ?? '')
        return true
      }),
      configurable: true,
    })

    try {
      await mount(fakeApi('editor'))
      await user.click(screen.getByRole('button', { name: /copy share link/i }))

      expect(screen.getByRole('button', { name: /copied/i })).toBeTruthy()
      expect(copied).toHaveLength(1)
      expect(copied[0]).toContain(`/w/${SHARE_ID}`)
      expect(copied[0], 'the fallback path leaked the token').not.toContain(
        TOKEN,
      )
      expect(
        screen.queryByRole('status'),
        'a successful fallback must not also report a failure',
      ).toBeNull()
    } finally {
      Reflect.deleteProperty(globalThis.document, 'execCommand')
      if (realClipboard === undefined) {
        Reflect.deleteProperty(globalThis.navigator, 'clipboard')
      } else {
        Object.defineProperty(globalThis.navigator, 'clipboard', realClipboard)
      }
    }
  })

  /**
   * AC 9, and decision 5: duplicate is unauthenticated, so it is the escape
   * hatch for a wheel whose editor has vanished — gating it behind being an
   * editor would take it away from the person most likely to need it.
   */
  it.each([
    { label: 'an editor', hash: `#e=${TOKEN}`, verdict: 'editor' as Verdict },
    { label: 'a participant', hash: '', verdict: 'editor' as Verdict },
  ])('offers Duplicate to $label', async ({ hash, verdict }) => {
    setHash(hash)
    const api = fakeApi(verdict)
    const user = userEvent.setup()

    await mount(api)
    await user.click(
      screen.getByRole('button', { name: /more wheel actions/i }),
    )

    // `find`, not `get`: Base UI positions the popup on a later frame, so the
    // menu is not in the document at the moment the click resolves.
    expect(
      await screen.findByRole('menuitem', { name: /duplicate wheel/i }),
    ).toBeTruthy()
  })

  it('navigates to the fork’s edit URL after duplicating', async () => {
    const api = fakeApi()
    const user = userEvent.setup()

    await mount(api)
    await user.click(
      screen.getByRole('button', { name: /more wheel actions/i }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: /duplicate wheel/i }),
    )

    // The fork's token is emitted exactly once, in that response. Navigating
    // to the share URL instead would strand a wheel nobody can ever edit.
    await waitFor(() =>
      expect(nav.push).toHaveBeenCalledWith(`/w/${NEW_ID}#e=forked-token`),
    )
  })

  /**
   * A fork is a new wheel, so it earns the same AC 5 warning — and the person
   * who gets it is very often a participant, since duplicate is the escape
   * hatch for a wheel whose editor has vanished. They arrive as the fork's only
   * editor, holding a token minted once and unrecoverable, having never seen
   * the create flow that explains what that URL is.
   *
   * Read at the moment `push` is called rather than afterwards, for the reason
   * the create-flow case gives: marking it after the navigation is a race the
   * page usually wins, so an end-state assertion would pass while the notice
   * appeared for some users and not others.
   */
  it('marks the fork as this tab’s before navigating to it', async () => {
    const api = fakeApi()
    const user = userEvent.setup()
    let markedAtPush: boolean | undefined
    nav.push.mockImplementation(() => {
      markedAtPush = consumeWheelCreated(NEW_ID)
    })

    await mount(api)
    await user.click(
      screen.getByRole('button', { name: /more wheel actions/i }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: /duplicate wheel/i }),
    )

    await waitFor(() => expect(nav.push).toHaveBeenCalled())
    expect(markedAtPush).toBe(true)
  })
})

describe('previewing as a viewer', () => {
  it('hides every editor affordance and restores them on the way back', async () => {
    setHash(`#e=${TOKEN}`)
    const user = userEvent.setup()

    await mount(fakeApi('editor'))
    await user.click(screen.getByRole('button', { name: /preview as viewer/i }))

    expect(screen.getByText('Viewer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /spin the wheel/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /rename wheel/i })).toBeNull()
    // The panel is handed the previewed role rather than `isEditor`, so the
    // preview is a view of the whole page and not of the header alone.
    expect(screen.queryByRole('textbox', { name: 'Add an option' })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove tacos/i })).toBeNull()

    await user.click(screen.getByRole('button', { name: /back to editing/i }))

    expect(screen.getByText('Editor')).toBeTruthy()
    expect(screen.getByRole('button', { name: /spin the wheel/i })).toBeTruthy()
  })

  it('is offered to an editor and to nobody else', async () => {
    await mount(fakeApi())

    expect(
      screen.queryByRole('button', { name: /preview as viewer/i }),
    ).toBeNull()
  })

  /**
   * Refused for the 4.3 seconds a spin is running, because `dismiss()` is itself
   * guarded against running mid-spin — so previewing there would freeze the
   * wheel with no control left to thaw it, and the result would land behind the
   * preview and be cleared unseen on the way back to editing. Asserted on
   * behaviour rather than on the disabled attribute: what must be true is that
   * the editor still learns what the wheel landed on.
   */
  it('refuses to preview mid-spin, and still announces the result', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'))
      await user.click(screen.getByRole('button', { name: /spin the wheel/i }))

      await user.click(
        screen.getByRole('button', { name: /preview as viewer/i }),
      )

      expect(screen.getByText('Editor')).toBeTruthy()
      expect(
        screen.queryByRole('button', { name: /back to editing/i }),
        'the preview must not have opened',
      ).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      // The whole point of refusing: the winner modal is editor-only, so it
      // would have opened behind the preview and been dismissed unread.
      expect(screen.getByText(/landed on/i)).toBeTruthy()

      // And the refusal lasts exactly as long as the spin. The modal has to be
      // closed first — it is modal, so the header behind it is inert, which is
      // itself the reason the guard cannot be reached this way any more.
      await user.click(screen.getByRole('button', { name: /^nice$/i }))
      await user.click(
        screen.getByRole('button', { name: /preview as viewer/i }),
      )
      expect(screen.getByText('Viewer')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * The two claims the Options panel cannot make on its own, because both are
 * about what happens between a click and a snapshot. The panel's own suite
 * (./options-panel.test.tsx) renders it from props; these drive the write
 * client and the listener.
 */
describe('editing the options', () => {
  /** Scoped, because the wheel beside the panel draws the same labels as SVG
   *  text — an unscoped `getAllByText` counts each option twice. */
  function optionRows() {
    return within(screen.getByRole('list', { name: 'Options on the wheel' }))
  }

  /**
   * AC 4, in both halves. The row has to be there before the snapshot — that is
   * the whole of the optimistic layer — and there has to be exactly one of it
   * afterwards, which is the part that breaks when an entry is retired on the
   * HTTP response instead of on the snapshot that carries it.
   */
  it('shows an added option immediately and reconciles to a single row', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.type(
      screen.getByRole('textbox', { name: 'Add an option' }),
      'Pho{Enter}',
    )

    expect(api.addOption).toHaveBeenCalledWith(
      SHARE_ID,
      { label: 'Pho' },
      TOKEN,
    )
    expect(
      optionRows().getAllByText('Pho'),
      'the optimistic row, before any snapshot has carried it',
    ).toHaveLength(1)

    deliver([
      { id: 'o1', label: 'Tacos' },
      { id: 'o2', label: 'Ramen' },
      { id: ADDED_ID, label: 'Pho' },
    ])

    await waitFor(() =>
      expect(optionRows().getAllByText('Pho')).toHaveLength(1),
    )
  })

  /** AC 5. No snapshot is delivered at all: the row goes on the click. */
  it('removes an option without waiting for a snapshot', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.click(screen.getByRole('button', { name: 'Remove Tacos' }))

    expect(api.removeOption).toHaveBeenCalledWith(SHARE_ID, 'o1', TOKEN)
    expect(optionRows().queryByText('Tacos')).toBeNull()
    expect(optionRows().getByText('Ramen')).toBeTruthy()
  })

  /**
   * A rejected write rolls its row back, and the page — not the panel — is what
   * tells the user. The row disappearing IS the rollback (see `pendingReducer`),
   * so without the message an add would simply not happen.
   */
  it('rolls back a refused add and explains it', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    api.addOption.mockRejectedValueOnce(new Error('This wheel is full.'))
    const user = userEvent.setup()

    await mount(api)
    await user.type(
      screen.getByRole('textbox', { name: 'Add an option' }),
      'Pho{Enter}',
    )

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'This wheel is full.',
      ),
    )
    expect(optionRows().queryByText('Pho')).toBeNull()
  })
})

/**
 * The claims the Suggestions panel cannot make on its own, for the same reason
 * the option ones are here: each is about what happens between a click and a
 * snapshot, or about a change this client did not make.
 */
describe('the suggestions queue', () => {
  function queueRows() {
    return within(
      screen.getByRole('list', { name: 'Suggestions for this wheel' }),
    )
  }

  /** The wheel beside the panel draws the same labels as SVG text. */
  function optionRows() {
    return within(screen.getByRole('list', { name: 'Options on the wheel' }))
  }

  /**
   * AC 3, in the one step it promises. Accept is a transaction over the wheel
   * document and the suggestion document, and until either snapshot lands the
   * optimistic layer is the whole of what the editor can see — the option on
   * the wheel keyed on `fromSuggestion`, and the queue row already reading as
   * settled.
   */
  it('puts an approved suggestion on the wheel before any snapshot confirms it', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    render(<WheelPage shareId={SHARE_ID} api={api} />)
    deliver([{ id: 'o1', label: 'Tacos' }], [{ id: 's1', label: 'Sushi' }])
    await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Approve Sushi' }))

    expect(api.acceptSuggestion).toHaveBeenCalledWith(SHARE_ID, 's1', TOKEN)
    expect(
      optionRows().getAllByText('Sushi'),
      'the option, before either half of the transaction has been delivered',
    ).toHaveLength(1)
    expect(queueRows().getByText('Added')).toBeTruthy()

    // Both halves, as they arrive: the option carrying its provenance, and the
    // row flipped. Retiring on one alone is what makes the row read pending
    // again in between.
    deliver(
      [
        { id: 'o1', label: 'Tacos' },
        { id: ADDED_ID, label: 'Sushi', fromSuggestion: 's1' },
      ],
      [{ id: 's1', label: 'Sushi', status: 'accepted' }],
    )

    await waitFor(() =>
      expect(
        optionRows().getAllByText('Sushi'),
        'the optimistic option and the real one must reconcile to one row',
      ).toHaveLength(1),
    )
  })

  /** AC 4. The row goes on the click; the hard delete is what makes it go everywhere. */
  it('removes a rejected suggestion without waiting for a snapshot', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    render(<WheelPage shareId={SHARE_ID} api={api} />)
    deliver(
      [{ id: 'o1', label: 'Tacos' }],
      [
        { id: 's1', label: 'Sushi' },
        { id: 's2', label: 'Pizza' },
      ],
    )
    await waitFor(() => expect(screen.getByRole('banner')).toBeTruthy())

    await user.click(screen.getByRole('button', { name: 'Reject Sushi' }))

    expect(api.rejectSuggestion).toHaveBeenCalledWith(SHARE_ID, 's1', TOKEN)
    expect(queueRows().queryByText('Sushi')).toBeNull()
    expect(queueRows().getByText('Pizza')).toBeTruthy()
  })

  /**
   * The participant's half. Their own submission is in the public queue from
   * the click, which is the only acknowledgement the panel gives that does not
   * depend on a round trip.
   */
  it('shows a participant their own suggestion at once', async () => {
    const api = fakeApi()
    const user = userEvent.setup()

    await mount(api)
    await user.type(
      screen.getByRole('textbox', { name: 'Suggest an option' }),
      'Sushi{Enter}',
    )

    expect(api.submitSuggestion).toHaveBeenCalledWith(SHARE_ID, {
      label: 'Sushi',
    })
    expect(queueRows().getByText('Sushi')).toBeTruthy()
    expect(queueRows().getByText('Waiting')).toBeTruthy()
  })

  /**
   * AC 12, stated from the side that proves it: this client never touched the
   * switch. The kill switch is a field on the wheel document, so a listener is
   * the whole delivery mechanism and no reload is involved.
   */
  it('closes the submit row on a client that only listened', async () => {
    const api = fakeApi()

    await mount(api)
    expect(
      screen.getByRole('textbox', { name: 'Suggest an option' }),
    ).toBeTruthy()

    deliver([{ id: 'o1', label: 'Tacos' }], [], { suggestionsOpen: false })

    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Suggest an option' }),
      ).toBeNull(),
    )
    expect(screen.getByText(/closed suggestions on this wheel/i)).toBeTruthy()
  })

  /** And the editor's side of the same write, which flips before it lands. */
  it('flips the kill switch on the click and patches the wheel', async () => {
    setHash(`#e=${TOKEN}`)
    const api = fakeApi('editor')
    const user = userEvent.setup()

    await mount(api)
    await user.click(
      screen.getByRole('switch', { name: 'Accepting suggestions' }),
    )

    expect(api.updateWheel).toHaveBeenCalledWith(
      SHARE_ID,
      { suggestionsOpen: false },
      TOKEN,
    )
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe(
      'false',
    )
  })
})

/**
 * The notice strip, and specifically whose dismissal is whose.
 *
 * One shared `dismissed` flag let an unrelated dismissal swallow AC 3's message
 * outright, which is the worst possible thing for it to swallow: the page then
 * sits in the participant view with no account of why, holding an edit link the
 * user believes in.
 */
/**
 * The failure any page can produce without an editor token: no clipboard, and
 * no `execCommand` to fall back to either — which is jsdom as it comes, so
 * removing the one API is enough to exhaust both routes.
 *
 * At module scope because two describes need it: a failure is the thing shown
 * over every other notice, so it is how each of the others is tested for what
 * happens underneath one.
 */
async function failToCopy(user: ReturnType<typeof userEvent.setup>) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  })
  await user.click(screen.getByRole('button', { name: /copy share link/i }))
  await screen.findByText(/could not reach the clipboard/i)
}

describe('the notice strip', () => {
  it('explains a refused token even after an earlier failure was dismissed', async () => {
    const user = userEvent.setup()
    const api = fakeApi('not-editor')

    // A plain share link: no fragment, so nothing is asked of the server yet.
    await mount(api)
    await failToCopy(user)
    await user.click(screen.getByRole('button', { name: /dismiss this/i }))
    expect(screen.queryByRole('status')).toBeNull()

    // The edit URL pasted into the address bar of an already-open share view.
    // `useEditToken` is subscribed to `hashchange`, so no reload is involved.
    act(() => {
      setHash(`#e=${TOKEN}`)
      globalThis.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'not valid for this wheel',
      ),
    )
  })

  /**
   * The other half of the same rule. A failure is dismissed by clearing it, so
   * the standing fact underneath — the token in this URL is refused — comes
   * back, because nobody dismissed that.
   */
  it('restores the refused-token message when a failure over it is dismissed', async () => {
    setHash(`#e=${TOKEN}`)
    const user = userEvent.setup()

    await mount(fakeApi('not-editor'))
    expect(screen.getByRole('status').textContent).toContain(
      'not valid for this wheel',
    )

    await failToCopy(user)
    await user.click(screen.getByRole('button', { name: /dismiss this/i }))

    expect(screen.getByRole('status').textContent).toContain(
      'not valid for this wheel',
    )
  })

  it('drops the refused-token message for good once it is dismissed', async () => {
    setHash(`#e=${TOKEN}`)
    const user = userEvent.setup()

    await mount(fakeApi('not-editor'))
    await user.click(screen.getByRole('button', { name: /dismiss this/i }))

    expect(screen.queryByRole('status')).toBeNull()
  })
})

/**
 * TASK-21 AC 5: the edit URL is the only key, and there is no locksmith.
 *
 * There are no accounts, so a lost edit link cannot be reissued by anyone — the
 * wheel is simply read-only forever, for its own creator, with no error and
 * nothing to click. The warning has to land at the one moment it can still be
 * acted on, which is arrival, and then get out of the way: a banner that
 * returned on every visit would be gone from the reader's attention long before
 * the visit where it mattered.
 */
describe('the edit-key warning', () => {
  /** Arrival on a wheel this tab just created, as `CreateWheelButton` leaves it. */
  async function arriveOnANewWheel(api: WheelApi) {
    setHash(`#e=${TOKEN}`)
    markWheelCreated(SHARE_ID)
    return mount(api)
  }

  it('warns the creator that the link cannot be recovered', async () => {
    await arriveOnANewWheel(fakeApi('editor'))

    const notice = screen.getByRole('status').textContent ?? ''
    expect(notice).toContain('Bookmark')
    expect(
      notice,
      'the warning has to say the link is unrecoverable, not merely that it is important',
    ).toMatch(/no way back in/i)
  })

  it('says nothing on an ordinary visit to the same wheel', async () => {
    setHash(`#e=${TOKEN}`)

    await mount(fakeApi('editor'))

    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * Spent on arrival, so a reload is an ordinary visit. Mounted twice against
   * one `markWheelCreated`, which is what a refresh looks like from here.
   *
   * `forgetCreatedWheels` is what makes the second mount a RELOAD rather than a
   * remount, and the distinction is the module's own: within a page load the
   * answer is deliberately stable, because its reader is a `useState`
   * initializer and React calls those twice. A reload is the case where that
   * stability ends — a fresh JavaScript context, so a fresh module — and the
   * only thing left is the storage slot, which arrival emptied.
   */
  it('is gone when the page is loaded again', async () => {
    await arriveOnANewWheel(fakeApi('editor'))
    expect(screen.getByRole('status')).toBeTruthy()

    cleanup()
    firestore.listeners.length = 0
    forgetCreatedWheels()
    await mount(fakeApi('editor'))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('can be dismissed, and stays dismissed', async () => {
    const user = userEvent.setup()
    await arriveOnANewWheel(fakeApi('editor'))

    await user.click(screen.getByRole('button', { name: /dismiss this/i }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * The precedence case, and the reason the answer is remembered for the life of
   * the page rather than re-read per render. A failure outranks the warning
   * while it is showing — it is newer, and the user's own action produced it —
   * but it must not consume it. The pairing is not hypothetical: the failure
   * most likely to appear on this page is the copy button refusing, and the
   * warning is about the very link they were trying to copy.
   */
  it('comes back when a failure shown over it is dismissed', async () => {
    const user = userEvent.setup()
    await arriveOnANewWheel(fakeApi('editor'))

    await failToCopy(user)
    expect(screen.getByRole('status').textContent).toMatch(
      /could not reach the clipboard/i,
    )

    await user.click(screen.getByRole('button', { name: /dismiss this/i }))

    expect(screen.getByRole('status').textContent).toContain('Bookmark')
  })

  /**
   * The signal is one-shot, so WHERE it is spent decides whether it can be lost.
   *
   * Spending it on the first render — which is what a `useState` initializer at
   * the top of the component does — spends it during the loading render, before
   * either gate has opened. A first snapshot that then fails renders the "could
   * not be loaded" page instead, and the reload that succeeds finds an empty
   * slot: no warning, on the one page whose URL is the only key to the wheel,
   * for the person who has just this moment created it.
   *
   * Asserted on the storage rather than on the screen, because the screen here
   * is the error page by construction — the claim is that the signal SURVIVES a
   * load that could not show it.
   */
  it('keeps the warning for the reload when the wheel fails to load', async () => {
    setHash(`#e=${TOKEN}`)
    markWheelCreated(SHARE_ID)

    render(<WheelPage shareId={SHARE_ID} api={fakeApi('editor')} />)
    act(() => {
      listener(SHARE_ID).fail({ code: 'unavailable' })
      listener('suggestions').next({ docs: [] })
    })
    // `find`, not `get`: both gates have to settle before the error page
    // replaces the skeleton, and the token in the hash means the role is still
    // resolving at the moment the failed snapshot lands.
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy()

    // The reload: a fresh JavaScript context, so a fresh module cache. All that
    // is left is the storage slot this load must not have emptied.
    cleanup()
    firestore.listeners.length = 0
    forgetCreatedWheels()
    await mount(fakeApi('editor'))

    expect(screen.getByRole('status').textContent).toContain('Bookmark')
  })
})

/**
 * The other half of arriving on a wheel this tab has just made.
 *
 * The wheel is called "Untitled wheel" and naming it is what its creator came
 * here to do, so the title opens as a field rather than as text with a hover
 * state — an affordance that says nothing on a touch screen and nothing to
 * someone who never thought to click it.
 */
describe('naming a wheel on arrival', () => {
  function titleField() {
    return screen.queryByRole('textbox', { name: 'Wheel title' })
  }

  it('opens the title focused for the tab that created the wheel', async () => {
    setHash(`#e=${TOKEN}`)
    markWheelCreated(SHARE_ID)

    await mount(fakeApi('editor'))

    const field = titleField()
    expect(field).not.toBeNull()
    expect(document.activeElement).toBe(field)
  })

  it('leaves the title alone on an ordinary visit', async () => {
    setHash(`#e=${TOKEN}`)

    await mount(fakeApi('editor'))

    expect(titleField()).toBeNull()
    expect(
      screen.getByRole('button', { name: /^Rename wheel/ }),
      'the title is still editable, just not opened',
    ).toBeTruthy()
  })

  /**
   * The signal survives a refused token — it is a fact about this tab, not
   * about the URL — so the participant view has to be the thing that refuses.
   * A field opened here would be one the server rejects every write from.
   */
  it('opens nothing for a tab whose token was refused', async () => {
    setHash(`#e=${TOKEN}`)
    markWheelCreated(SHARE_ID)

    await mount(fakeApi('not-editor'))

    expect(titleField()).toBeNull()
  })
})

/**
 * AC 6, from decision 13: the spin exists only in the spinning browser in v1.
 * The prototype's "Watching live" is gone, because a participant told to watch
 * a wheel that will never move will reasonably conclude the page is broken.
 */
describe('what a participant is promised', () => {
  it('says nothing about watching, live updates, or a spin', async () => {
    await mount(fakeApi())

    const page = document.body.textContent ?? ''
    for (const forbidden of ['Watching', 'watch', 'live', 'Spinning']) {
      expect(page, `viewer copy must not mention "${forbidden}"`).not.toContain(
        forbidden,
      )
    }
  })
})

describe('states with no wheel to draw', () => {
  it('explains a reaped wheel rather than erroring', async () => {
    render(<WheelPage shareId={SHARE_ID} api={fakeApi()} />)

    act(() => {
      listener(SHARE_ID).next({ exists: () => false, data: () => undefined })
      listener('suggestions').next({ docs: [] })
    })

    expect(screen.getByText(/this wheel is gone/i)).toBeTruthy()
    // A share link outliving its wheel is the ordinary end of one, per design
    // doc section 8 — so the page offers the next step rather than an apology.
    expect(screen.getByRole('link', { name: /make a new wheel/i })).toBeTruthy()
  })

  it('reports a listener that was refused', async () => {
    render(<WheelPage shareId={SHARE_ID} api={fakeApi()} />)

    act(() => {
      listener(SHARE_ID).fail({ code: 'permission-denied' })
      listener('suggestions').next({ docs: [] })
    })

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
  })
})

/**
 * The spin, end to end: the button, the modal it opens four seconds later, and
 * the thaw on the way out.
 *
 * The modal's own behaviour — the focus trap, Escape, the backdrop, the pop and
 * the confetti — is ./winner-modal.test.tsx. What is here is only what needs the
 * page to be true: that the modal is wired to `useSpin`. `useSpin` freezes the
 * wheel on the snapshot it spun from spin start until `dismiss()` is called, and
 * a modal closing on its own state would leave the wheel showing a stale option
 * list for the rest of the session — which reads as a broken listener rather
 * than a missed call, so it is worth a test rather than a comment.
 */
describe('the spin', () => {
  /** Spin, and let the settle timer run out. */
  async function spinAndSettle(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await user.click(screen.getByRole('button', { name: /spin the wheel/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
  }

  it('opens the winner modal on the result, naming what it landed on', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'))
      await spinAndSettle(user)

      const modal = screen.getByRole('dialog')
      expect(within(modal).getByText(/tacos|ramen/i)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * AC 5. Announced from a live region the page has been carrying all along,
   * rather than from the card — a region that arrives with its text already in
   * it is not a change, and screen readers that follow the spec do not read it.
   *
   * Its wording is also what the two tests below and the preview suite assert
   * on, since the card itself only ever prints the bare label.
   */
  it('announces the result to assistive tech', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      const { container } = await mount(fakeApi('editor'))

      const live = container.querySelector('[aria-live="polite"]')
      expect(
        live,
        'the live region must exist before the result does',
      ).toBeTruthy()
      expect(live?.textContent).toBe('')

      await spinAndSettle(user)

      expect(live?.textContent).toMatch(/^Landed on (Tacos|Ramen)$/)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The thaw, asserted on the wheel's own label rather than on the modal: what
   * has to be true is that the wheel is tracking live options again, and the
   * modal disappears either way.
   */
  it('thaws the wheel when the modal is closed', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'), [
        { id: 'o1', label: 'Tacos' },
        { id: 'o2', label: 'Ramen' },
      ])
      await spinAndSettle(user)

      await user.click(screen.getByRole('button', { name: /^nice$/i }))
      expect(screen.queryByRole('dialog')).toBeNull()

      // A third option, added after the close. A wheel still frozen on its spun
      // snapshot is drawing two and would never show it.
      deliver([
        { id: 'o1', label: 'Tacos' },
        { id: 'o2', label: 'Ramen' },
        { id: 'o3', label: 'Sushi' },
      ])

      await waitFor(() =>
        expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
          'Sushi',
        ),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * "Spin again" closes and re-spins — and the beat between the two is the
   * page's timer rather than the modal's, because closing unmounts the modal
   * and its own cleanup would clear the timer on the way out. That is the
   * failure this asserts against: a button that closes the card and then does
   * nothing at all.
   */
  it('closes and spins again', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'))
      await spinAndSettle(user)

      await user.click(screen.getByRole('button', { name: /spin again/i }))
      expect(screen.queryByRole('dialog')).toBeNull()

      // The second spin runs the same 4.4 seconds as the first and opens the
      // card again. What this rules out is the modal owning the beat: a
      // `setTimeout` inside the card is cleared by its own unmount, so the
      // button would close the card and then quietly do nothing.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(screen.getByRole('dialog')).toBeTruthy()

      /**
       * The beat itself is not asserted. It is 120ms, which is shorter than a
       * `userEvent` click takes in real time, and this file's fake clock runs
       * with real time — so a case that pinned it would pass or fail on how
       * busy the machine is. The delay is visual; the wiring above is what
       * breaks silently.
       */
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The gap the beat opens, and the one place `togglePreview`'s guard cannot
   * see. For those 120ms `spinning` is false, so nothing refuses a preview and
   * nothing disables the control — and a spin starting behind the participant
   * view has no modal and no live region to announce it, so the result lands
   * four seconds later unseen and is cleared on the way back.
   *
   * The preview is clicked through the DOM rather than through `userEvent`,
   * which is not a shortcut: a `userEvent` click takes longer in real time than
   * the beat it is trying to land inside.
   */
  it('drops a queued re-spin when the editor previews inside the beat', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'))
      await spinAndSettle(user)

      // Two acts, not one: the header is behind a modal that is inert until
      // React has flushed the close, so the control cannot even be found until
      // the first has settled. Both together take far less than the 120ms beat.
      act(() => {
        screen.getByRole('button', { name: /spin again/i }).click()
      })
      act(() => {
        screen.getByRole('button', { name: /preview as viewer/i }).click()
      })

      expect(
        screen.getByText('Viewer'),
        'the preview must have opened',
      ).toBeTruthy()

      // Past the beat, which is when a re-spin that survived would have begun.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      /**
       * Asserted by trying to LEAVE the preview, because a spin running behind
       * it is invisible from the participant view — no modal, no live region,
       * no button that says "Spinning…". What a running spin does do is refuse
       * this toggle, which is the same guard from the other side. So a page
       * that comes back to the editor is a page where nothing started.
       */
      await user.click(screen.getByRole('button', { name: /back to editing/i }))

      expect(
        screen.getByText('Editor'),
        'a re-spin survived the preview and is holding the toggle',
      ).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000)
      })

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByText(/landed on/i)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
