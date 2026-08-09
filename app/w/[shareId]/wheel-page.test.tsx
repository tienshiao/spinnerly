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

      // The whole point of refusing: this strip is editor-only, so it would
      // have been rendered behind the preview and dismissed without being read.
      expect(screen.getByText(/landed on/i)).toBeTruthy()

      // And the refusal lasts exactly as long as the spin.
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
describe('the notice strip', () => {
  /** The failure any page can produce without an editor token: no clipboard. */
  async function failToCopy(user: ReturnType<typeof userEvent.setup>) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })
    await user.click(screen.getByRole('button', { name: /copy share link/i }))
    await screen.findByText(/could not reach the clipboard/i)
  }

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
 * The spin button ships here with the result strip TASK-20 replaces, and it
 * ships with it for a reason worth keeping a test on: `useSpin` freezes the
 * wheel on the snapshot it spun from spin start until `dismiss()` is called. A
 * button without one leaves the wheel showing a stale option list for the rest
 * of the session, which reads as a broken listener rather than a missed call.
 */
describe('the spin', () => {
  it('announces a result and thaws the wheel when it is dismissed', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'))
      await user.click(screen.getByRole('button', { name: /spin the wheel/i }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })

      const result = screen.getByText(/landed on/i)
      expect(result).toBeTruthy()

      await user.click(screen.getByRole('button', { name: /^dismiss$/i }))

      expect(screen.queryByText(/landed on/i)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * Found by running the page: spin, then press "Preview as viewer". The result
   * strip is editor-only, so previewing takes away the only control that calls
   * `dismiss()` — and the wheel stays frozen on its spun snapshot for the rest
   * of the session, with added options silently never appearing.
   *
   * Asserted on the wheel's own label rather than on the strip, because the
   * strip disappears either way. What has to be true is that the wheel is
   * tracking live options again.
   */
  it('thaws the wheel when an editor previews with a result on screen', async () => {
    setHash(`#e=${TOKEN}`)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    try {
      await mount(fakeApi('editor'), [
        { id: 'o1', label: 'Tacos' },
        { id: 'o2', label: 'Ramen' },
      ])
      await user.click(screen.getByRole('button', { name: /spin the wheel/i }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(screen.getByText(/landed on/i)).toBeTruthy()

      await user.click(
        screen.getByRole('button', { name: /preview as viewer/i }),
      )

      // A third option, added while the preview is open. A frozen wheel is
      // still drawing the two-option snapshot and would never show it.
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
})
