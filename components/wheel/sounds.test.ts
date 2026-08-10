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
    // A device that has taken nothing yet, so a test's expected times are the
    // lead-in alone rather than the lead-in plus a number it has to know.
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

    sink.spin(SCHEDULE)

    expect(fake.started).toHaveLength(SCHEDULE.times.length)
  })

  /** A browser with no Web Audio API at all — which is every test environment. */
  it('is the silent sink where there is no AudioContext', () => {
    expect(createWheelSounds()).toBe(SILENT_SINK)
  })
})

/**
 * Warming up, which is what stands between the clicks and a device that is
 * still waking while they play.
 *
 * The bug it answers was reported as "no ticks on the first spin, and the
 * celebration always plays" — the shape of an output stream opening from cold
 * and swallowing whatever is scheduled during it. The clicks are front-loaded
 * and lose everything; the flourish is four seconds later and loses nothing.
 */
describe('warming up', () => {
  /**
   * jsdom has no `navigator.userActivation`, and the module reads a missing one
   * as "assume the page has been touched" — the Safari case. These stub it so
   * both answers are exercised rather than only the fallback.
   */
  function stubActivation(hasBeenActive: boolean): void {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      userActivation: { hasBeenActive, isActive: hasBeenActive },
    })
  }

  /**
   * The gate that makes wiring this to a hover safe.
   *
   * A `pointerenter` grants no user activation, so a context built from one on
   * an untouched page is born suspended, logs the autoplay warning, and opens
   * no device — all cost, no head start. Once anything on the page has been
   * clicked, the same hover is worth hundreds of milliseconds.
   */
  it('declines on a page nobody has touched yet', () => {
    stubActivation(false)
    const { created, started, sink } = sinkWithFake()

    sink.warm()

    expect(created).not.toHaveBeenCalled()
    expect(started).toHaveLength(0)
  })

  it('goes ahead once the page has been interacted with', () => {
    stubActivation(true)
    const { created, sink } = sinkWithFake()

    sink.warm()

    expect(created).toHaveBeenCalledTimes(1)
  })

  /** Safari reports no `userActivation` at all; the sound is not withheld. */
  it('assumes the best where the browser will not say', () => {
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      userActivation: undefined,
    })
    const { created, sink } = sinkWithFake()

    sink.warm()

    expect(created).toHaveBeenCalledTimes(1)
  })

  it('opens the device, and plays something through it', () => {
    const { created, started, sink } = sinkWithFake()

    sink.warm()

    expect(created).toHaveBeenCalledTimes(1)
    // A sound, not merely a context: some drivers stay asleep until a stream
    // actually carries signal.
    expect(started).toHaveLength(1)
  })

  /** It is wired to a hover, a focus and a press, so it must be cheap. */
  it('does nothing while the output is still awake', () => {
    const { created, started, sink } = sinkWithFake()

    sink.warm()
    sink.warm()
    sink.warm()

    expect(created).toHaveBeenCalledTimes(1)
    expect(started).toHaveLength(1)
  })

  /**
   * The bug this replaced, reported as precisely as a bug can be: "I only hear
   * the ticks when Chrome's tab shows the speaker icon. If I wait for it to
   * disappear and then spin, I do not hear ticks."
   *
   * That indicator going out is the output stream idling, and an idle stream
   * has to be woken all over again — but warming was latched to once per
   * context, so every spin after the first got no warm-up at all and lost its
   * opening flurry to the wake-up. Warming is once per SILENCE, not once per
   * page.
   */
  it('warms again once the output has been quiet', () => {
    const { context, created, started, sink } = sinkWithFake()

    sink.warm()
    sink.spin(SCHEDULE)
    const afterFirstSpin = started.length

    // Straight after the spin: the device is still awake, nothing to do.
    context.currentTime = 1
    sink.warm()
    expect(started).toHaveLength(afterFirstSpin)

    // A minute later, with the tab gone quiet and its speaker icon long gone.
    context.currentTime = 60
    sink.warm()

    expect(started.length).toBe(afterFirstSpin + 1)
    expect(created, 'the same context, woken again').toHaveBeenCalledTimes(1)
  })

  /** The prime has to outlast a slow wake-up, not merely poke the device. */
  it('holds the stream open rather than blipping it', () => {
    const { started, sink } = sinkWithFake()

    sink.warm()

    const [prime] = started
    expect(prime.stoppedAt).not.toBeNull()
    expect((prime.stoppedAt ?? 0) - prime.at).toBeGreaterThanOrEqual(0.3)
  })

  it('opens nothing for someone who has muted the wheel', () => {
    const { created, started, sink } = sinkWithFake()
    setSoundOn(false)

    sink.warm()

    expect(created).not.toHaveBeenCalled()
    expect(started).toHaveLength(0)
  })

  it('warms again after the audio has been let go of', () => {
    const { created, sink } = sinkWithFake()

    sink.warm()
    sink.dispose()
    sink.warm()

    expect(created).toHaveBeenCalledTimes(2)
  })
})

describe('the spin', () => {
  /**
   * The offsets are the schedule's, but the ORIGIN is the clock plus a lead-in.
   *
   * `currentTime` is where the audio thread has rendered to; the frames between
   * there and the speaker are already committed. The first click of a real spin
   * is 26ms out, which is inside that window on plenty of machines — and a
   * click scheduled into the past is not a click that plays late, it is one
   * nobody hears. This asserts the lead-in exists rather than its exact value,
   * because the value is part device-reported and part margin.
   */
  it('schedules the clicks ahead of the clock, in the order it was given', () => {
    const { context, started, sink } = sinkWithFake()
    context.currentTime = 12

    sink.spin(SCHEDULE)

    const ats = started.map((entry) => entry.at)
    expect(ats[0]).toBeGreaterThan(12.1)
    expect(started.every((entry) => entry.kind === 'buffer')).toBe(true)

    // Seconds, from the audio clock — not milliseconds, and not from zero. The
    // gaps between them are the schedule's own, untouched by the lead-in.
    expect(+(ats[1] - ats[0]).toFixed(3)).toBe(0.15)
    expect(+(ats[2] - ats[1]).toFixed(3)).toBe(0.35)
  })

  /** Whatever the device has already taken is added to the margin. */
  it('clears the latency the device reports', () => {
    const { context, started, sink } = sinkWithFake()
    context.currentTime = 0
    context.outputLatency = 0.25

    sink.spin(SCHEDULE)

    expect(started[0].at).toBeGreaterThan(0.25 + 0.1)
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

    // The first envelope is the master; one follows per click.
    const clicks = envelopes.slice(1)
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

    const clicks = envelopes.slice(1).map((entry) => entry.peak ?? 0)
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
  it('plays a flourish of oscillators, spread over time', () => {
    const { started, sink } = sinkWithFake()

    sink.win()

    expect(started.length).toBeGreaterThan(1)
    expect(started.every((entry) => entry.kind === 'oscillator')).toBe(true)

    const ats = started.map((entry) => entry.at)
    expect(ats, 'the notes must be struck in order').toEqual(
      [...ats].sort((a, b) => a - b),
    )
    expect(ats[ats.length - 1]).toBeGreaterThan(ats[0])
    expect(
      ats[ats.length - 1],
      'a flourish, not a fanfare — it plays under a modal opening',
    ).toBeLessThan(1)
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
