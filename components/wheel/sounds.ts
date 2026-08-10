'use client'

import { isSoundOn, subscribeSound } from '@/lib/sound-preference'

import type { TickSchedule } from './tick-schedule'

/**
 * The wheel, out loud. Two sounds, both synthesised.
 *
 * No audio files anywhere in this: a click and a four-note flourish are a dozen
 * lines of Web Audio each, and shipping them as assets would mean two more
 * network requests on the one interaction that must not stutter, a decode before
 * the first spin can be heard, and a licence to keep track of.
 *
 * **Everything is scheduled against the audio clock, not `setTimeout`.** A spin
 * runs for four and a bit seconds and its clicks are as close as 20ms apart near
 * the start; timers are throttled by a busy main thread and clamped in a
 * background tab, so a timer-driven tick drifts audibly against an animation the
 * compositor is running perfectly. `AudioContext.currentTime` is the same clock
 * the audio thread renders on, so a source told to start at t starts at t.
 *
 * The context is built on the first sound and not before — see `ensure`.
 */

export type SoundSink = {
  /**
   * Open the audio device, before there is anything to play through it.
   *
   * **Call this as soon as a spin looks likely — a hover, a focus, a press —
   * rather than when the button is finally hit.** Starting an output stream
   * from cold takes time the page does not control: tens of milliseconds for
   * built-in speakers, and several hundred for a Bluetooth link, which has to
   * negotiate before it carries anything. Whatever is scheduled during that
   * window is not heard. The clicks are the casualty because they are
   * front-loaded — the first is 26ms after the spin starts and half are gone
   * inside a second — so a slow device eats the part that reads as ticking and
   * leaves the flourish four seconds later untouched. Which is exactly how it
   * was reported: no ticks, and the celebration always plays.
   *
   * **It declines to do anything on a page nobody has touched yet**, which is
   * what makes it safe to wire to a hover. A context built without user
   * activation is born `suspended`, logs the autoplay warning, and does not
   * open a device — so it would buy nothing and cost a console message. Once
   * the page has had any interaction at all, a hover is worth several hundred
   * milliseconds of head start over a press.
   *
   * **Warming is not once per page, it is once per silence.** An output stream
   * that has had nothing to carry is idled — by the browser, by the OS, by a
   * Bluetooth headset dropping back to standby — and the next sound pays the
   * wake-up all over again. Chrome's own tab audio indicator is a readable
   * proxy for the state: while it is lit the clicks arrive, and once it has
   * gone out the next spin loses them again. So this re-primes whenever the
   * output has been quiet for a moment, and is otherwise free.
   */
  warm: () => void
  /**
   * Schedule a spin's clicks, starting now.
   *
   * Takes the whole schedule rather than being called per tick, because the
   * point is to hand the audio thread every start time up front and then leave
   * it alone for four seconds.
   */
  spin: (schedule: TickSchedule) => void
  /** The wheel landed. */
  win: () => void
  /**
   * Drop whatever has not played yet.
   *
   * Called for you when the wheel is muted mid-spin, and on the way out — a
   * spin's clicks are three seconds of sound the audio thread already holds, so
   * there has to be a way to take them back.
   */
  cancel: () => void
  /** Cancel, and let go of the audio hardware. */
  dispose: () => void
}

/** What this module needs from `window.AudioContext`. */
type ContextFactory = () => AudioContext

/**
 * A sink that does nothing, for a browser with no Web Audio API.
 *
 * Every method is present and every one is a no-op, so callers never branch on
 * whether sound exists — a wheel that spins silently in an old browser is the
 * intended outcome, not a degraded one.
 */
export const SILENT_SINK: SoundSink = {
  warm: () => {},
  spin: () => {},
  win: () => {},
  cancel: () => {},
  dispose: () => {},
}

/**
 * How far ahead of `currentTime` anything is scheduled.
 *
 * **Not a fudge factor.** `currentTime` is where the audio thread has rendered
 * TO, and the frames between there and the speaker have already been handed to
 * the device — `outputLatency` is how many. An event scheduled inside that
 * window is in the past by the time anyone could act on it, and the Web Audio
 * spec's answer is to play it immediately or not at all; either way it is not
 * where it was meant to be. The first click of a spin is 26ms out, which is
 * inside that window on plenty of machines, and the clicks after it are 25ms
 * apart — so what gets lost is the opening flurry, which is the part that
 * sounds like ticking.
 *
 * Added to the device's own reported latency rather than used instead of it,
 * because the two are different things: one is the buffer already committed,
 * the other is room for this thread to finish scheduling the other seventy
 * sources before the first one is due.
 */
const SCHEDULE_LEAD_S = 0.06

/**
 * How long the output may be silent before the device is assumed to have gone
 * back to sleep, and so how stale a warm-up has to be before it is done again.
 *
 * Deliberately shorter than anything that actually idles a stream. Priming is
 * inaudible and costs a single 400ms buffer, so re-doing it when it was not
 * needed costs nothing worth measuring; skipping one that WAS needed costs the
 * whole opening flurry of a spin.
 */
const IDLE_SLEEP_S = 1

/**
 * How long the priming sound lasts.
 *
 * Long enough to still be playing when a slow device finishes waking, which an
 * 80ms blip is not — the point is to hold the stream open across the wake-up,
 * not to poke it and let go. It also covers the usual gap between reaching for
 * a button and pressing it, so a hover leaves the device awake for the click.
 */
const PRIME_S = 0.4

/**
 * How loud, at most. Well under unity — this plays over a room, not into one.
 *
 * **The levels below are measured rather than guessed, and they have to be.**
 * The first version of this file was inaudible: a click reached -32 dBFS at the
 * destination, which is a level you find by turning a laptop up in a silent
 * room. Nothing about the code said so — every node was connected, every source
 * started, and Chrome even lit the tab's audio indicator, because a graph that
 * is running and a graph that can be heard are not the same claim.
 *
 * They were checked by rendering this exact graph through an
 * `OfflineAudioContext` and reading the samples back. A whole spin — every
 * click plus the flourish — now peaks at -9 dBFS with nothing clipped. Anyone
 * retuning these should do the same rather than trusting the arithmetic: the
 * bandpass below is where the last version's twenty missing decibels went, and
 * a filter's insertion loss is not something you can read off its parameters.
 */
const MASTER_GAIN = 0.5

/**
 * One click, and it has to be shorter than the gap to the next one.
 *
 * The wheel leaves the pointer at about eight turns a second, so its first
 * clicks are 25ms apart. At the 45ms this started as, each one was still
 * sounding when the next two began — seventy overlapping bursts of filtered
 * noise, which is not a rattle but a smear, and a smear is the thing you do not
 * notice is playing. Comfortably inside the tightest gap, so even the fastest
 * part of the spin is made of separate clicks.
 */
const TICK_DECAY_S = 0.022

/**
 * The click's loudest, BEFORE the bandpass takes its cut — which is why it is
 * greater than one and must stay that way.
 *
 * A gain node is not a volume control with a ceiling; it is a multiplier, and
 * the thing being multiplied here is a slice of white noise that has already
 * lost most of its energy in the filter. At the destination this lands around
 * -10 dBFS, level with the flourish. Read as "how loud a click is" and trimmed
 * to something that looks more like a volume, the effect goes silent again
 * without any other symptom.
 *
 * It went UP when `TICK_DECAY_S` came down. The two are tied: a shorter
 * envelope means less overlap between neighbouring clicks, and it was that
 * overlap — clicks summing into each other — carrying a good part of the level
 * before. Shortening one without raising the other trades a smear for a
 * whisper.
 */
const TICK_GAIN = 1.9

/**
 * The click's bandwidth, as a Q.
 *
 * Below one, so the band is wider than its own centre frequency. The narrow
 * `Q = 2.5` this started at is what turns noise into a pitched knock — and also
 * what threw away 20 dB, since a bandpass passes only what falls inside it. A
 * wide band keeps the noise reading as a mechanism rather than a tone while
 * letting enough of it through to hear.
 */
const TICK_Q = 0.9

/**
 * The gap, in milliseconds, at which a click is at its brightest and quietest.
 *
 * A tick from a wheel that is still a blur and one from a wheel about to stop
 * are the same event mechanically, and sound wrong if they are the same event
 * acoustically: the ear reads a constant timbre slowing down as a machine
 * winding down correctly, and a constant timbre with growing gaps as a loop that
 * has been stretched. Interpolating between these two bounds gives the last few
 * clicks a lower, softer knock.
 */
const FAST_GAP_MS = 25
const SLOW_GAP_MS = 400

const TICK_FAST_HZ = 2400
const TICK_SLOW_HZ = 900

/** The flourish: C5, E5, G5, C6, a major arpeggio with the octave on top. */
const WIN_NOTES_HZ = [523.25, 659.25, 783.99, 1046.5]

/** How far apart the flourish's notes are struck. */
const WIN_NOTE_GAP_S = 0.085

/** How long a flourish note takes to fade. */
const WIN_DECAY_S = 0.55

/**
 * Loud enough to be the payoff. An oscillator loses nothing on the way to the
 * destination, so unlike the click this reads as what it is: the flourish peaks
 * at about -9 dBFS, a shade above the clicks it follows.
 */
const WIN_GAIN = 0.6

function defaultFactory(): AudioContext {
  const Ctor = globalThis.AudioContext
  return new Ctor()
}

/**
 * Whether this document has ever been interacted with — the condition every
 * browser's autoplay policy actually tests before it lets a context start.
 *
 * STICKY activation, not transient: the question is "has this page ever been
 * touched", not "is a gesture running right now". That distinction is the whole
 * reason a hover can usefully open the audio at all — a `pointerenter` grants
 * no activation of its own, but on a page where something has already been
 * clicked, one is not needed.
 *
 * Absent in Safari, where the answer is `true` rather than `false`. Guessing
 * wrong in that direction costs a suspended context and a console warning on a
 * page that was never going to make a sound anyway; guessing the other way
 * would mean no sound at all on a browser that would have played it.
 */
function everActivated(): boolean {
  const activation = globalThis.navigator?.userActivation
  return activation === undefined ? true : activation.hasBeenActive
}

/** Whether this browser can make a sound at all. */
export function audioAvailable(): boolean {
  return typeof globalThis.AudioContext === 'function'
}

/**
 * @param createContext injected by the tests, which hand in a fake that records
 * what was scheduled. Nothing else passes it.
 */
export function createWheelSounds(createContext?: ContextFactory): SoundSink {
  // Only the real factory is subject to this: a test that hands in a fake is
  // entitled to a working sink in an environment with no Web Audio API at all,
  // which is every environment the test suite runs in.
  if (createContext === undefined && !audioAvailable()) return SILENT_SINK

  const factory = createContext ?? defaultFactory

  let context: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null

  /**
   * When the last sound this sink scheduled finishes, on the audio clock — and
   * so when the output starts being silent.
   *
   * `-Infinity` rather than 0 so that a context which has never played anything
   * counts as having been quiet forever, and the first warm-up goes ahead. With
   * 0 it would read as "sound ended at the very moment we are asking", which on
   * a fresh context is exactly now.
   */
  let quietFrom = Number.NEGATIVE_INFINITY

  /** Detaches the mute listener. Null until there is a context to listen for. */
  let stopListening: (() => void) | null = null

  /** Everything scheduled and not yet finished, so `cancel` can reach it. */
  const playing = new Set<AudioScheduledSourceNode>()

  /**
   * The context, built on demand.
   *
   * **Not in a module initialiser and not on mount**, for two reasons that point
   * the same way. A context created before a user gesture starts life
   * `suspended` under every browser's autoplay policy and logs a warning saying
   * so; and a page whose wheel nobody spins has no business holding an audio
   * device open. Both callers below run inside — or four seconds after — the
   * click on Spin the wheel, so by the time this runs there is a gesture to
   * build on.
   *
   * `resume()` is still called: a context can be suspended later by the browser
   * when a tab is backgrounded, and it comes back suspended.
   */
  function ensure(): { context: AudioContext; master: GainNode } | null {
    if (!isSoundOn()) return null

    try {
      if (context === null) {
        context = factory()
        master = context.createGain()
        master.gain.value = MASTER_GAIN
        master.connect(context.destination)

        /**
         * **Muting has to reach the sounds already in flight, not only the next
         * ones.** A spin hands every click to the audio thread up front, so by
         * the time anyone reaches for the speaker button the next three seconds
         * of ticking is already scheduled and no longer passes through any code
         * that could check a preference. Without this, muting mid-spin silences
         * the flourish four seconds later and nothing before it — the button
         * appears not to work on the one sound it was pressed to stop.
         *
         * Here rather than at construction because this runs in an event
         * handler: `createWheelSounds` is called from a `useState` initialiser,
         * where a subscription is a side effect during render and React is
         * entitled to throw the instance away.
         */
        stopListening = subscribeSound(() => {
          if (!isSoundOn()) cancel()
        })
      }

      if (context.state === 'suspended') void context.resume()
    } catch {
      /**
       * A browser that refuses to build a context — too many open, or the API
       * present but disabled. Silence is the right failure for a sound effect.
       *
       * `context` is cleared rather than left as it lies: it is assigned before
       * the nodes that hang off it, so a throw from `createGain` or `connect`
       * would otherwise leave a context with no master behind it, and every
       * later call would skip the branch above and fall out at the `master ===
       * null` check. That is a sink which is silent for the life of the page
       * because one call failed once.
       */
      context = null
      master = null
      return null
    }

    return master === null ? null : { context, master }
  }

  /**
   * A tenth of a second of white noise, made once and played many times.
   *
   * A click is a burst of broadband energy shaped by a filter, not a tone: an
   * oscillator at any single frequency reads as a beep, and seventy beeps in
   * four seconds read as an alarm. Filling the buffer costs a few thousand
   * `Math.random()` calls, which is why it is cached rather than made per tick.
   */
  function noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (noise !== null) return noise

    const frames = Math.floor(ctx.sampleRate * 0.1)
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const channel = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1

    noise = buffer
    return buffer
  }

  /**
   * How far ahead of the audio clock to schedule, on this context, right now.
   *
   * `outputLatency` is what the device has already taken and cannot be told to
   * change; it is 0 on a context whose stream has not started, and a real
   * number afterwards, which is another reason to warm up before scheduling
   * anything that matters.
   */
  function leadIn(ctx: AudioContext): number {
    const output = Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0
    return SCHEDULE_LEAD_S + output
  }

  /** Forgets a source once it has finished, so `playing` cannot grow forever. */
  function track(source: AudioScheduledSourceNode): void {
    playing.add(source)
    source.onended = () => {
      playing.delete(source)
    }
  }

  function scheduleTick(
    ctx: AudioContext,
    out: GainNode,
    at: number,
    gapMs: number,
  ): void {
    // Where this click sits between "a blur" and "about to stop", clamped so a
    // first tick measured from the spin's start cannot push it out of range.
    const slowness = Math.min(
      Math.max((gapMs - FAST_GAP_MS) / (SLOW_GAP_MS - FAST_GAP_MS), 0),
      1,
    )

    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value =
      TICK_FAST_HZ + (TICK_SLOW_HZ - TICK_FAST_HZ) * slowness
    filter.Q.value = TICK_Q

    const envelope = ctx.createGain()
    const peak = TICK_GAIN * (1 - 0.35 * slowness)

    /**
     * `setValueAtTime` before the ramp, and it is not redundant.
     *
     * An `AudioParam` ramp interpolates from whatever the last scheduled event
     * left, and with several dozen clicks queued on separate nodes that is
     * usually nothing at all — so without an explicit start the ramp has no
     * beginning and the browser is free to hold the value flat. The 1ms attack
     * is there to keep the click from starting on a discontinuity, which is
     * itself an audible pop.
     */
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(peak, at + 0.001)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + TICK_DECAY_S)

    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(out)

    source.start(at)
    source.stop(at + TICK_DECAY_S)
    track(source)
  }

  /**
   * A plain function rather than a method on the returned object, so that
   * `dispose` can call it without a `this` that a destructured
   * `const { dispose } = sink` would take away.
   */
  function cancel(): void {
    for (const source of playing) {
      try {
        source.stop()
      } catch {
        // `stop` throws on a source that was never started, and on some engines
        // on one that ended between its `onended` and this loop. Neither is a
        // reason to abandon the rest of the set.
      }
    }
    playing.clear()
  }

  return {
    warm() {
      // Before `ensure`, so that a hover on an untouched page does not build
      // the very thing the autoplay policy would refuse to start.
      if (!everActivated()) return

      const audio = ensure()
      if (audio === null) return

      // Still carrying sound, or only just stopped: the device is awake and
      // there is nothing to do. This is what makes the call cheap enough to
      // wire to a hover, a focus and a press all at once.
      if (audio.context.currentTime - quietFrom < IDLE_SLEEP_S) return

      /**
       * A sound, rather than merely a context.
       *
       * Constructing an `AudioContext` asks the browser for an output stream;
       * it does not guarantee the device is producing anything yet, and some
       * drivers — Bluetooth above all — stay asleep until a stream is actually
       * carrying signal. So this plays one: the same noise the clicks are made
       * of, at a gain four hundred times below them, which lands near -50 dBFS
       * — under the noise floor of any room this runs in, and under the
       * threshold at which a browser calls a tab audible, but not silence.
       */
      const at = audio.context.currentTime + SCHEDULE_LEAD_S
      const source = audio.context.createBufferSource()
      source.buffer = noiseBuffer(audio.context)
      // The buffer is a tenth of a second and the prime is longer, so it has to
      // repeat rather than stop and leave the stream empty again.
      source.loop = true

      const envelope = audio.context.createGain()
      envelope.gain.setValueAtTime(TICK_GAIN / 400, at)

      source.connect(envelope)
      envelope.connect(audio.master)
      source.start(at)
      source.stop(at + PRIME_S)
      track(source)
      quietFrom = at + PRIME_S
    },

    spin(schedule) {
      const audio = ensure()
      if (audio === null) return

      // Not `currentTime` itself: the first click is 26ms out, which is inside
      // the buffer the device has already been given on plenty of machines.
      // See `SCHEDULE_LEAD_S`.
      const start = audio.context.currentTime + leadIn(audio.context)

      schedule.times.forEach((offsetMs, index) => {
        scheduleTick(
          audio.context,
          audio.master,
          start + offsetMs / 1000,
          schedule.gaps[index],
        )
      })

      // A spin is nearly three seconds of clicks, so nothing needs waking again
      // until well after it — including by the press of "Spin again".
      const last = schedule.times[schedule.times.length - 1] ?? 0
      quietFrom = Math.max(quietFrom, start + last / 1000 + TICK_DECAY_S)
    },

    win() {
      const audio = ensure()
      if (audio === null) return

      // The same lead-in as the clicks. This one has always been heard — it
      // lands four seconds into a running context — but there is no version of
      // "schedule inside what the device already has" that is correct.
      const start = audio.context.currentTime + leadIn(audio.context)

      WIN_NOTES_HZ.forEach((hz, index) => {
        const at = start + index * WIN_NOTE_GAP_S
        const oscillator = audio.context.createOscillator()
        // Triangle rather than sine: a sine is so pure it reads as a test tone,
        // and a square or saw is bright enough to be shrill four notes up.
        oscillator.type = 'triangle'
        oscillator.frequency.value = hz

        const envelope = audio.context.createGain()
        envelope.gain.setValueAtTime(0, at)
        envelope.gain.linearRampToValueAtTime(WIN_GAIN, at + 0.012)
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + WIN_DECAY_S)

        oscillator.connect(envelope)
        envelope.connect(audio.master)

        oscillator.start(at)
        oscillator.stop(at + WIN_DECAY_S)
        track(oscillator)
      })

      quietFrom = Math.max(
        quietFrom,
        start + (WIN_NOTES_HZ.length - 1) * WIN_NOTE_GAP_S + WIN_DECAY_S,
      )
    },

    cancel,

    dispose() {
      cancel()

      stopListening?.()
      stopListening = null

      const open = context
      context = null
      master = null
      noise = null
      quietFrom = Number.NEGATIVE_INFINITY

      // Closing frees the audio hardware; a page that unmounts with a context
      // open keeps a thread alive for a wheel nobody is looking at any more.
      void open?.close().catch(() => {})
    },
  }
}
