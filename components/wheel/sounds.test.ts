// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forgetSoundPreference, setSoundOn } from '@/lib/sound-preference'

import { SILENT_SINK, createWheelSounds } from './sounds'
import type { TickSchedule } from './tick-schedule'

/**
 * The audio layer, against a fake context.
 *
 * There is no Web Audio API in jsdom and no way to hear the result of one in a
 * test, so what is asserted here is everything about the sound EXCEPT how it
 * sounds: when a context comes into existence, what is scheduled and at what
 * time, and what happens to a spin's four seconds of queued clicks when the page
 * goes away.
 *
 * Those are the parts that fail invisibly. A tick that sounds wrong is obvious
 * on the first spin; a context built at import time is a console warning nobody
 * reads and an audio device held open on every page, and a spin left running is
 * a wheel that ticks over the page that replaced it.
 */

type Started = {
  at: number
  kind: 'buffer' | 'oscillator'
  stopped: boolean
  /** The time a `stop(at)` was scheduled for, if one was. */
  stoppedAt: number | null
}

/**
 * A recording `AudioContext`, thin but not a lie: every node this module
 * touches exists, `currentTime` advances only when a test says so, and `start`
 * and `stop` are what the assertions read.
 */
function fakeContext() {
  const started: Started[] = []
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  })

  const source = (kind: Started['kind']) => {
    const record: Started = {
      at: Number.NaN,
      kind,
      stopped: false,
      stoppedAt: null,
    }
    return {
      buffer: null,
      loop: false,
      type: '',
      frequency: param(),
      connect: vi.fn(),
      onended: null as null | (() => void),
      start: vi.fn((at: number) => {
        record.at = at
        started.push(record)
      }),
      /**
       * Only the bare `stop()` counts as stopped. Every tick also schedules a
       * `stop(at)` for the end of its own envelope, so a fake that recorded
       * both would make "cancel stopped everything" true whether or not cancel
       * ran at all.
       */
      stop: vi.fn((at?: number) => {
        if (at === undefined) record.stopped = true
        else record.stoppedAt = at
      }),
    }
  }

  /**
   * Every envelope built, in order — the first is the master, the rest belong to
   * one click or one note each. Recorded so a test can read the level a sound
   * actually reaches, which is the one property of this module that failed
   * silently in a real browser.
   */
  const envelopes: { peak: number | null }[] = []

  const context = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    // Reported but never consulted — the one test that sets it asserts the
    // schedule ignores it.
    outputLatency: 0,
    sampleRate: 48000,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => {
      const record: { peak: number | null } = { peak: null }
      envelopes.push(record)
      const gain = param()
      // The peak is the value of the attack ramp — the one `linearRamp` each
      // envelope makes on its way up, before the exponential decay.
      gain.linearRampToValueAtTime = vi.fn((value: number) => {
        record.peak = value
      })
      return { gain, connect: vi.fn() }
    }),
    createBiquadFilter: vi.fn(() => ({
      type: '',
      frequency: param(),
      Q: param(),
      connect: vi.fn(),
    })),
    createBufferSource: vi.fn(() => source('buffer')),
    createOscillator: vi.fn(() => source('oscillator')),
    createBuffer: vi.fn((_channels: number, frames: number) => ({
      getChannelData: () => new Float32Array(frames),
    })),
  }

  return { context, started, envelopes }
}

function sinkWithFake() {
  const fake = fakeContext()
  const created = vi.fn(() => fake.context as unknown as AudioContext)
  return { ...fake, created, sink: createWheelSounds(created) }
}

/** Three clicks, a tenth of a second apart, slowing. */
const SCHEDULE: TickSchedule = {
  times: [100, 250, 600],
  gaps: [100, 150, 350],
}

beforeEach(() => {
  globalThis.localStorage.clear()
  forgetSoundPreference()
})

afterEach(() => {
  vi.unstubAllGlobals()
  forgetSoundPreference()
})

describe('building the context', () => {
  /**
   * AC 4, and the reason the whole module is lazy. A context built before a
   * user gesture starts life suspended under every browser's autoplay policy
   * and says so in the console — and a page whose wheel nobody spins has no
   * business holding an audio device open at all.
   */
  it('builds nothing until something is played, or about to be', () => {
    const { created, sink } = sinkWithFake()

    expect(created).not.toHaveBeenCalled()

    sink.spin(SCHEDULE)
    expect(created).toHaveBeenCalledTimes(1)
  })

  it('reuses the one context across a spin and its win', () => {
    const { created, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.win()

    expect(created).toHaveBeenCalledTimes(1)
  })

  /**
   * A context can be suspended later by the browser — backgrounding a tab does
   * it — and it comes back suspended. Without this the second spin of a session
   * is silent, on a page that gives no sign why.
   */
  it('resumes a context the browser suspended', () => {
    const { context, created, sink } = sinkWithFake()
    context.state = 'suspended'

    sink.spin(SCHEDULE)

    expect(context.resume).toHaveBeenCalled()
    expect(created).toHaveBeenCalledTimes(1)
  })

  it('stays silent, and builds nothing, when a context cannot be made', () => {
    const sink = createWheelSounds(() => {
      throw new DOMException('too many contexts', 'NotSupportedError')
    })

    expect(() => {
      sink.spin(SCHEDULE)
      sink.win()
    }).not.toThrow()
  })

  /**
   * A failure PART of the way through building the graph, which is the shape
   * that latches. `context` is assigned before the nodes that hang off it, so
   * a throw from `createGain` leaves a context with no master behind it — and
   * every later call skips the "build it" branch and falls out at the master
   * check, silent for the life of the page because one call failed once.
   */
  it('tries again after a half-built graph, rather than going silent for good', () => {
    const fake = fakeContext()
    const realCreateGain = fake.context.createGain
    let failures = 1
    fake.context.createGain = vi.fn(() => {
      if (failures-- > 0) throw new DOMException('no', 'InvalidStateError')
      return realCreateGain()
    })
    const sink = createWheelSounds(
      () => fake.context as unknown as AudioContext,
    )

    sink.spin(SCHEDULE)
    expect(fake.started, 'the failed attempt makes no sound').toHaveLength(0)
    expect(
      fake.context.close,
      'the abandoned context must be closed, not leaked — each one holds the ' +
        'audio device, and browsers cap how many may exist at once',
    ).toHaveBeenCalledTimes(1)

    sink.spin(SCHEDULE)

    // One source per click, plus the whoosh that opens the spin.
    expect(fake.started).toHaveLength(SCHEDULE.times.length + 1)
  })

  /** A browser with no Web Audio API at all — which is every test environment. */
  it('is the silent sink where there is no AudioContext', () => {
    expect(createWheelSounds()).toBe(SILENT_SINK)
  })
})

describe('the spin', () => {
  /**
   * The offsets are the schedule's, but the ORIGIN is the clock plus a lead-in
   * — room for the main thread to finish scheduling seventy sources before the
   * first is due. A `start(t)` whose time has passed is clamped to "now" and
   * plays late, which for the opening flurry means bunched behind the
   * animation instead of in step with it. This asserts the lead-in exists
   * rather than its exact value, which is a tuning.
   */
  it('schedules the clicks ahead of the clock, in the order it was given', () => {
    const { context, started, sink } = sinkWithFake()
    context.currentTime = 12

    sink.spin(SCHEDULE)

    // The whoosh launches the spin; the clicks follow it.
    const [whoosh, ...clicks] = started
    expect(whoosh.at).toBeGreaterThan(12)
    expect(started.every((entry) => entry.kind === 'buffer')).toBe(true)

    const ats = clicks.map((entry) => entry.at)
    expect(ats).toHaveLength(SCHEDULE.times.length)
    expect(ats[0]).toBeGreaterThan(12.1)

    // Seconds, from the audio clock — not milliseconds, and not from zero. The
    // gaps between them are the schedule's own, untouched by the lead-in.
    expect(+(ats[1] - ats[0]).toFixed(3)).toBe(0.15)
    expect(+(ats[2] - ats[1]).toFixed(3)).toBe(0.35)
  })

  /**
   * The regression that shipped and was heard: an earlier version added
   * `outputLatency` to the margin, believing events inside the device's
   * committed buffer are dropped. They are clamped to "now" and played — and
   * `outputLatency` delays ALL audio uniformly, so the addend just pushed the
   * whole train that much further behind the animation. On Bluetooth
   * headphones, which report hundreds of milliseconds, the ticks trailed the
   * wheel and kept clicking after it had visibly stopped.
   */
  it('does not push the schedule out by the latency the device reports', () => {
    const { context, started, sink } = sinkWithFake()
    context.currentTime = 0
    context.outputLatency = 0.25

    sink.spin(SCHEDULE)

    const [whoosh] = started
    expect(whoosh.at).toBeGreaterThan(0)
    expect(
      whoosh.at,
      'the device latency must not be added to the lead-in',
    ).toBeLessThan(0.25)
  })

  /**
   * The whoosh is not decoration; it is what makes the clicks audible on the
   * hardware that reported the bug. Monitor speakers run a noise gate that a
   * 22ms click never opens on its own — a cold spin's whole opening flurry
   * plays into a muted output, while a spin straight after another is fine
   * because the last sounds are still holding the gate open. See `WHOOSH_S` in
   * ./sounds.ts. What this asserts is the contract that fix rests on: the spin
   * OPENS with a sound that is sustained and loud enough to be meant, and only
   * then clicks.
   */
  it('opens the spin with a whoosh, before the first click', () => {
    const { envelopes, started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)

    const [whoosh, firstClick] = started
    expect(whoosh.at).toBeLessThan(firstClick.at)

    // Sustained — a blip would not integrate to enough level to open a gate —
    // but over before the wheel has visibly slowed.
    expect(whoosh.stoppedAt).not.toBeNull()
    expect((whoosh.stoppedAt ?? 0) - whoosh.at).toBeGreaterThanOrEqual(0.3)
    expect((whoosh.stoppedAt ?? 0) - whoosh.at).toBeLessThan(1)

    // As hard-driven as the clicks, for the same reason as `TICK_GAIN`: it
    // plays through the same bandpass, and a whoosh trimmed down to a polite
    // volume is one the gate never hears.
    const [, whooshEnvelope] = envelopes
    expect(whooshEnvelope.peak).toBeGreaterThan(0.5)
  })

  /**
   * The noise buffer is filled with a few thousand random samples, so it is
   * made once and played many times. Cheap to get wrong, and the symptom would
   * be a spin that stutters at exactly the moment it must not.
   */
  it('fills the noise buffer once for the whole spin', () => {
    const { context, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.spin(SCHEDULE)

    expect(context.createBuffer).toHaveBeenCalledTimes(1)
  })

  /**
   * The regression this file exists for.
   *
   * The first version of this module was inaudible and looked perfect: every
   * node connected, every source started, Chrome's tab audio indicator lit. Its
   * clicks reached -32 dBFS at the destination, because a bandpass passes only
   * what falls inside it and nothing compensated for what it threw away.
   *
   * The floor here is not a tuning; it is the line between "quiet" and "a bug
   * nobody can see". `TICK_GAIN` sits above unity on purpose — it is measured
   * BEFORE the filter's loss — so a value that has drifted back down to
   * something that reads like a volume control is the failure being caught.
   */
  it('drives the clicks hard enough to be heard through the filter', () => {
    const { envelopes, sink } = sinkWithFake()

    sink.spin(SCHEDULE)

    // The first envelope is the master, the second the whoosh's; one follows
    // per click.
    const clicks = envelopes.slice(2)
    expect(clicks).toHaveLength(SCHEDULE.times.length)

    for (const click of clicks) {
      expect(click.peak).toBeGreaterThan(0.5)
    }
  })

  /**
   * A wheel that is still a blur and one about to stop are the same event
   * mechanically and must not be the same event acoustically — a constant
   * timbre with growing gaps reads as a loop that has been stretched rather
   * than as a machine winding down.
   */
  it('knocks more softly as the wheel slows', () => {
    const { envelopes, sink } = sinkWithFake()

    sink.spin(SCHEDULE)

    const clicks = envelopes.slice(2).map((entry) => entry.peak ?? 0)
    expect(clicks[clicks.length - 1]).toBeLessThan(clicks[0])
  })

  it('schedules nothing at all while muted', () => {
    const { created, started, sink } = sinkWithFake()
    setSoundOn(false)

    sink.spin(SCHEDULE)
    sink.win()

    expect(started).toHaveLength(0)
    expect(
      created,
      'muting must not even build a context',
    ).not.toHaveBeenCalled()
  })
})

describe('the win', () => {
  /**
   * The shape IS the sound: a ta-da is one short pickup and then the chord
   * landing together. Struck apart, the same pitches are the arpeggio this
   * used to be — so what is pinned here is the rhythm, not the tuning.
   */
  it('is a ta-da: one pickup, then the chord together', () => {
    const { started, sink } = sinkWithFake()

    sink.win()

    expect(started.length).toBeGreaterThan(2)
    expect(started.every((entry) => entry.kind === 'oscillator')).toBe(true)

    const [pickup, ...chord] = started
    for (const note of chord) {
      expect(pickup.at, 'the pickup is struck alone, first').toBeLessThan(
        note.at,
      )
      expect(note.at, 'the chord lands as one event, not a roll').toBe(
        chord[0].at,
      )
    }

    // An upbeat, not a note in its own right: gone by the time the chord
    // lands.
    expect(pickup.stoppedAt).not.toBeNull()
    expect(pickup.stoppedAt ?? 0).toBeLessThanOrEqual(chord[0].at)

    expect(
      chord[0].at,
      'still a flourish, not a fanfare — it plays under a modal opening',
    ).toBeLessThan(1)
  })

  /**
   * The chord's per-note level LOOKS like a typo beside the pickup's, and the
   * ratio is load-bearing: its notes land together, so each carries a fifth of
   * the payoff, and a chord gain drifted up toward "a volume" blows past the
   * -9 dBFS the whole file is measured to. See `WIN_CHORD_GAIN`.
   */
  it('drives each chord note softer than the lone pickup', () => {
    const { envelopes, sink } = sinkWithFake()

    sink.win()

    // The first envelope is the master, the second the pickup's; one follows
    // per chord note.
    const [, pickup, ...chord] = envelopes
    expect(chord.length).toBeGreaterThan(2)
    for (const note of chord) {
      expect(note.peak ?? 0).toBeLessThan(pickup.peak ?? 0)
    }
  })
})

describe('muting mid-spin', () => {
  /**
   * The one case where the toggle has to reach backwards.
   *
   * A spin hands every click to the audio thread up front, so three seconds of
   * ticking is already scheduled and no longer passes through any code that
   * could consult a preference. Muting a second in silenced the flourish four
   * seconds later and nothing before it — the button appearing not to work on
   * the very sound it was pressed to stop.
   */
  it('stops the clicks that are already scheduled', () => {
    const { started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    expect(started.some((entry) => entry.stopped)).toBe(false)

    setSoundOn(false)

    expect(started.every((entry) => entry.stopped)).toBe(true)
  })

  it('leaves them alone when the sound is turned back ON', () => {
    const { started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    setSoundOn(true)

    expect(started.some((entry) => entry.stopped)).toBe(false)
  })

  it('stops listening once the audio has been let go of', () => {
    const { started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.dispose()
    const stoppedByDispose = started.filter((entry) => entry.stopped).length

    setSoundOn(false)

    expect(started.filter((entry) => entry.stopped)).toHaveLength(
      stoppedByDispose,
    )
  })
})

describe('giving up on a spin', () => {
  /**
   * AC 6. A spin hands the audio thread every click up front, four seconds
   * ahead, so a page left mid-spin goes on ticking through whatever replaced it
   * — with nothing on screen to explain the noise or to stop it.
   */
  it('stops what has not played yet', () => {
    const { started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.cancel()

    expect(started.every((entry) => entry.stopped)).toBe(true)
  })

  it('lets go of the audio device on dispose', () => {
    const { context, started, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.dispose()

    expect(started.every((entry) => entry.stopped)).toBe(true)
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('survives a source that refuses to stop', () => {
    const { context, sink } = sinkWithFake()
    const create = context.createBufferSource
    context.createBufferSource = vi.fn(() => {
      const node = create()
      const scheduled = node.stop
      // Only the bare `stop()` throws — the one `cancel` makes. Scheduling a
      // stop at a time is what `spin` does on every tick and is always legal;
      // a fake that threw for both would be testing the wrong call.
      node.stop = vi.fn((at?: number) => {
        if (at === undefined) {
          throw new DOMException('not started', 'InvalidStateError')
        }
        scheduled(at)
      })
      return node
    })

    sink.spin(SCHEDULE)

    expect(() => {
      sink.cancel()
    }).not.toThrow()
  })

  /** A dispose that has already run must not close a context twice. */
  it('is idempotent', () => {
    const { context, sink } = sinkWithFake()

    sink.spin(SCHEDULE)
    sink.dispose()
    sink.dispose()

    expect(context.close).toHaveBeenCalledTimes(1)
  })
})
