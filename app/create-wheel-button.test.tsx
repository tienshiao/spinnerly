// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WheelApi } from '@/lib/wheels/api-client'
import {
  consumeWheelCreated,
  forgetCreatedWheels,
} from '@/lib/wheels/new-wheel'

/**
 * The create flow: one click, no account, and a token that exists exactly once.
 *
 * AC 2 is the reason most of this file is here. The edit token is minted by the
 * create response and can never be reissued — there are no accounts and no
 * recovery path — so it has to reach the address bar, and it has to reach
 * nothing else. A query string is sent to the server and lands in access logs,
 * in `Referer` on every outbound link, and in whatever analytics arrives later;
 * a path segment is the same with fewer steps; and a stray `console.log` on a
 * client component prints it into the console of every user rather than into a
 * file someone has to go looking for. None of those three fail loudly, which is
 * why they are asserted rather than reviewed.
 */

const NEW_ID = 'aBcDeFgHiJkLmNoPqRsT'
const TOKEN = 'K3n8x_Qw-2bT4vZ1'

const nav = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
}))

const { CreateWheelButton, CreateWheelProvider } =
  await import('./create-wheel-button')

type Created = { shareId: string; editToken: string }

/**
 * A create endpoint whose answer the case controls.
 *
 * The answer is a THUNK rather than a promise, so a rejecting one is not
 * constructed until the click asks for it. Built eagerly, a rejected promise
 * spends a turn with no handler attached and Vitest reports it as an unhandled
 * rejection — which fails the run for a case that is deliberately testing a
 * failure.
 */
function fakeApi(
  answer: () => Promise<Created> = () =>
    Promise.resolve({ shareId: NEW_ID, editToken: TOKEN }),
) {
  const api = {
    createWheel: vi.fn(answer),
  } as unknown as WheelApi

  return api as WheelApi & { createWheel: ReturnType<typeof vi.fn> }
}

/** A promise the case resolves by hand, for the states while a request is out. */
function deferred<T>() {
  let settle!: (value: T) => void
  let fail!: (error: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle, fail }
}

function mount(api: WheelApi) {
  render(<CreateWheelButton api={api}>Make a wheel</CreateWheelButton>)
  return screen.getByRole('button', { name: /make a wheel/i })
}

beforeEach(() => {
  nav.push.mockReset()
  globalThis.sessionStorage.clear()
  forgetCreatedWheels()
})

afterEach(cleanup)

describe('creating a wheel', () => {
  /** AC 1. */
  it('posts, then lands on the edit URL with the token in the fragment', async () => {
    const user = userEvent.setup()
    const api = fakeApi()

    await user.click(mount(api))

    expect(api.createWheel).toHaveBeenCalledTimes(1)
    expect(nav.push).toHaveBeenCalledWith(`/w/${NEW_ID}#e=${TOKEN}`)
  })

  /**
   * AC 2, on the URL itself. Parsed rather than pattern-matched: a `toContain`
   * on the fragment would pass just as well for `/w/x?e=t#e=t`, which is the
   * exact mistake being guarded against.
   */
  it('puts the token in the fragment and in no other part of the URL', async () => {
    const user = userEvent.setup()

    await user.click(mount(fakeApi()))

    const pushed = new URL(
      String(nav.push.mock.calls[0][0]),
      'https://example.app',
    )

    expect(pushed.hash, 'the fragment is the token’s only home').toBe(
      `#e=${TOKEN}`,
    )
    expect(pushed.search, 'a query string is sent to the server').toBe('')
    expect(
      pushed.pathname,
      'a path segment is sent to the server too',
    ).not.toContain(TOKEN)
  })

  /**
   * AC 2, on the console. Every method, because the one that gets left behind in
   * a debugging session is rarely `log` — and `console.error` in a `catch` is
   * the likeliest of the lot to be reached by a token-carrying value.
   */
  it('never prints the token', async () => {
    const spies = (
      ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    ).map((method) => vi.spyOn(console, method).mockImplementation(() => {}))

    try {
      const user = userEvent.setup()
      await user.click(mount(fakeApi()))

      const printed = spies.flatMap((spy) =>
        spy.mock.calls.flat().map((argument) => String(argument)),
      )

      expect(printed.join(' ')).not.toContain(TOKEN)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })

  /** And nowhere in the page either — no hidden field, no data attribute. */
  it('never renders the token', async () => {
    const user = userEvent.setup()

    await user.click(mount(fakeApi()))

    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  /**
   * The signal behind TASK-21 AC 5's warning, and its ordering. Read at the moment
   * `push` is called rather than afterwards: setting it after the navigation
   * would be a race the page usually wins, so a test that only checked the end
   * state would pass while the notice appeared for some users and not others.
   */
  it('marks the wheel as this tab’s before navigating to it', async () => {
    const user = userEvent.setup()
    let markedAtPush: boolean | undefined
    nav.push.mockImplementation(() => {
      markedAtPush = consumeWheelCreated(NEW_ID)
    })

    await user.click(mount(fakeApi()))

    expect(markedAtPush).toBe(true)
  })
})

describe('while the request is in flight', () => {
  it('says so, and refuses a second click', async () => {
    const user = userEvent.setup()
    const answer = deferred<Created>()
    const api = fakeApi(() => answer.promise)

    const button = mount(api)
    await user.click(button)

    expect(screen.getByRole('button', { name: /making it/i })).toBe(button)
    expect(button).toHaveProperty('disabled', true)

    await user.click(button)
    expect(
      api.createWheel,
      'a second wheel would be created and immediately orphaned — its token is thrown away by the navigation to the first',
    ).toHaveBeenCalledTimes(1)

    answer.settle({ shareId: NEW_ID, editToken: TOKEN })
  })

  /**
   * And refuses the OTHER button too, which a per-component guard cannot do.
   *
   * The landing page renders two of these — hero and closing band — and the cost
   * of both posting is not a duplicate request but an orphaned wheel: whichever
   * navigation runs second throws the first wheel's token away, and there is no
   * way to reissue it. The window is not theoretical either. The old page stays
   * mounted and interactive throughout an App Router transition, and api-client
   * budgets 1–2s for a cold start on the first write — long enough to scroll
   * from one button to the other and press it.
   */
  it('refuses a click on a second button under the same provider', async () => {
    const user = userEvent.setup()
    const answer = deferred<Created>()
    const api = fakeApi(() => answer.promise)

    render(
      <CreateWheelProvider>
        <CreateWheelButton api={api}>Make a wheel</CreateWheelButton>
        <CreateWheelButton api={api} pendingLabel="Making it…">
          Make one now
        </CreateWheelButton>
      </CreateWheelProvider>,
    )

    await user.click(screen.getByRole('button', { name: /make a wheel/i }))

    // Both say so, because the page really is making a wheel — a live-looking
    // button that silently refuses would be the more confusing half-measure.
    const buttons = screen.getAllByRole('button', { name: /making it/i })
    expect(buttons).toHaveLength(2)

    await user.click(buttons[1])
    expect(
      api.createWheel,
      'the second button created a wheel whose token the first navigation discards',
    ).toHaveBeenCalledTimes(1)

    answer.settle({ shareId: NEW_ID, editToken: TOKEN })
  })

  /** A failure on one frees the claim for both. */
  it('re-enables every button under the provider after a failure', async () => {
    const user = userEvent.setup()
    const api = fakeApi(() => Promise.reject(new Error('Spinnerly is down.')))

    render(
      <CreateWheelProvider>
        <CreateWheelButton api={api}>Make a wheel</CreateWheelButton>
        <CreateWheelButton api={api}>Make one now</CreateWheelButton>
      </CreateWheelProvider>,
    )

    await user.click(screen.getByRole('button', { name: /make a wheel/i }))
    await screen.findByRole('alert')

    const second = screen.getByRole('button', { name: /make one now/i })
    expect(
      second,
      'a failure that disables the page is a dead end',
    ).toHaveProperty('disabled', false)
    expect(
      screen.getAllByRole('alert'),
      'the failure belongs beside the button that was pressed, not on both',
    ).toHaveLength(1)

    await user.click(second)
    expect(api.createWheel).toHaveBeenCalledTimes(2)
  })

  /**
   * The request finishing is not the click finishing. A button that springs back
   * to "Make a wheel" for the frames between the response and the navigation
   * invites exactly the second click the case above refuses.
   */
  it('stays disabled through the navigation', async () => {
    const user = userEvent.setup()
    const button = mount(fakeApi())

    await user.click(button)

    expect(nav.push).toHaveBeenCalledTimes(1)
    expect(button).toHaveProperty('disabled', true)
  })
})

describe('when the wheel cannot be made', () => {
  it('says what went wrong and stays where it is', async () => {
    const user = userEvent.setup()
    const api = fakeApi(() =>
      Promise.reject(new Error('Spinnerly is unreachable.')),
    )

    await user.click(mount(api))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Spinnerly is unreachable.')
    expect(
      nav.push,
      'nothing was created, so there is nowhere to go',
    ).not.toHaveBeenCalled()
  })

  it('can be tried again', async () => {
    const user = userEvent.setup()
    const api = fakeApi(() =>
      Promise.reject(new Error('Spinnerly is unreachable.')),
    )

    const button = mount(api)
    await user.click(button)
    await screen.findByRole('alert')

    expect(
      button,
      'a failure that disables the button is a dead end',
    ).toHaveProperty('disabled', false)

    api.createWheel.mockImplementation(() =>
      Promise.resolve({ shareId: NEW_ID, editToken: TOKEN }),
    )
    await user.click(button)

    expect(nav.push).toHaveBeenCalledWith(`/w/${NEW_ID}#e=${TOKEN}`)
    expect(
      screen.queryByRole('alert'),
      'the old failure outlived the retry that fixed it',
    ).toBeNull()
  })

  /** A rejection with no message still has to say something. */
  it('falls back to its own words when the failure has none', async () => {
    const user = userEvent.setup()
    const api = fakeApi(() => Promise.reject('nope'))

    await user.click(mount(api))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not be made/i)
  })
})
