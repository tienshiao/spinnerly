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
   * Schedule a spin's sounds, starting now: the launch whoosh, then the clicks.
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
  spin: () => {},
  win: () => {},
  cancel: () => {},
  dispose: () => {},
}

/**
 * How far ahead of `currentTime` anything is scheduled: room for this thread
 * to finish building and scheduling the other seventy sources before the first
 * one is due. A `start(t)` whose `t` has already passed is clamped to "now"
 * and plays immediately — late rather than lost, per the spec — so what the
 * margin protects is the first few clicks landing IN STEP with the animation
 * instead of bunched up behind a busy main thread.
 *
 * **`outputLatency` is deliberately NOT added to this.** An earlier version
 * did, on the theory that events scheduled inside the device's committed
 * buffer are dropped. They are not — anything at or after `currentTime` is
 * honoured, and `outputLatency` is a uniform delay on ALL audio, animation
 * included in effect, so adding it compensated for nothing and pushed the
 * whole sound train that much further behind the wheel. On Bluetooth
 * headphones, which report 150–400ms, that was ticks audibly trailing the
 * animation and still clicking after the wheel had visibly stopped. The
 * cold-start losses that motivated it were the monitor's own noise gate —
 * see `WHOOSH_S` — not the schedule (measured live, TASK-35).
 */
const SCHEDULE_LEAD_S = 0.06

/**
 * The spin-up whoosh: a rising sweep of noise that launches the spin — and the
 * reason the clicks after it can be heard at all on some hardware.
 *
 * Monitor and TV speakers run their input through a noise gate: a level
 * detector that keeps the output muted until something worth passing arrives,
 * and mutes it again a few seconds after the last such thing. A tick is 22ms
 * of noise — its PEAK is respectable, but integrated over the window a gate
 * measures it never crosses the threshold, so a cold spin's whole opening
 * flurry is consumed on schedule and never leaves the speaker. The flourish
 * always survived, being half a second of sustained tone per note; and a spin
 * straight after another worked because the previous sounds were still holding
 * the gate open. The Web Audio API reports none of this: on the machine that
 * reported the bug, the clock advanced at 1x from 22ms after construction and
 * `outputLatency` never moved, through silence and through swallowed ticks
 * alike (measured live, TASK-35).
 *
 * **No inaudible priming can fix that** — quiet enough not to hear IS below
 * the gate's threshold, by construction. An earlier version of this file
 * warmed the device with 400ms of noise at -52 dBFS on the button's hover and
 * press; it opened Chrome's output stream, which was never the bottleneck, and
 * the gate never noticed it. The whoosh works WITH the gate instead: loud
 * enough to be meant, it opens the gate at the moment the wheel launches, and
 * the ticks follow inside the gate's release window — a window the "spin again
 * while the tab's speaker icon is still lit" observation proved is seconds
 * long, longer than the tick train it needs to cover.
 *
 * A gate needs a moment of over-threshold signal before it opens, so the first
 * tick or two may still land under it on the strictest hardware. They are 25ms
 * apart at that point — a texture, not countable clicks — and the whoosh is
 * covering exactly that stretch with a louder sound.
 */
const WHOOSH_S = 0.5

/**
 * Like `TICK_GAIN`, greater than one because it is measured before the
 * bandpass takes its cut — and like every level in this file, checked through
 * an `OfflineAudioContext` rather than trusted: the sweep peaks at about
 * -9 dBFS at the destination, level with the flourish, which is the one sound
 * the gate demonstrably passes.
 */
const WHOOSH_GAIN = 2.0

/** Where the sweep starts and ends: low and throaty to bright, rising. */
const WHOOSH_FROM_HZ = 300
const WHOOSH_TO_HZ = 1500

/**
 * Narrower than a tick's `TICK_Q`, so the sweep reads as a pitch rising — a
 * wheel being launched — rather than as a burst of static that happens to
 * brighten.
 */
const WHOOSH_Q = 1.4

/** The swell. Fast enough that the gate is open by the earliest clicks. */
const WHOOSH_ATTACK_S = 0.04

/**
 * How long the envelope HOLDS at peak before releasing, and it is the part a
 * first draft cuts. An attack straight into an exponential decay leaves the
 * sweep's sustained level 15 dB down (measured; the shape of the previous
 * paragraph's warning) — a transient, which is exactly the kind of signal a
 * gate's detector is built to ignore. The hold is what a gate integrates; the
 * flat envelope does not sound flat because the rising sweep widens the band
 * it passes, a crescendo the filter provides for free.
 */
const WHOOSH_HOLD_S = 0.25

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

/**
 * The win is a TA-DA: one short pickup note, then the whole chord landing
 * together and ringing out. An earlier version was an arpeggio — the same
 * pitches struck 85ms apart — and it read as a sparkle rather than an
 * announcement. The rhythm is what says "ta-da", not the pitches: an upbeat,
 * then the landing.
 *
 * The pickup is G5 — the dominant, so the chord it leads to is a resolution
 * rather than just a louder thing that happens next.
 */
const WIN_PICKUP_HZ = 783.99

/** Short enough to be an upbeat rather than a note in its own right. */
const WIN_PICKUP_S = 0.15

/**
 * The "da": C major with the octave on top, plus a root an octave below
 * anything the old arpeggio had — the low C is the chest the landing lands on.
 */
const WIN_CHORD_HZ = [261.63, 523.25, 659.25, 783.99, 1046.5]

/** The chord lands straight off the pickup's decay. */
const WIN_CHORD_AT_S = 0.15

/**
 * How long the chord rings. Longer than the old arpeggio's fade on purpose —
 * the "daa" is the sustain — but still gone inside a breath of the modal
 * opening it plays under.
 */
const WIN_CHORD_S = 0.9

/**
 * Measured, like every level in this file (`OfflineAudioContext`, see
 * `MASTER_GAIN`) — and the chord's per-note gain LOOKS like a typo next to the
 * pickup's until the summing is remembered: five triangles land together, so
 * each note carries a fifth of the payoff. As set, the sound peaks at
 * -9.4 dBFS at the destination, on the chord's onset, level with the whoosh
 * and the clicks; the pickup alone sits about a decibel and a half under.
 * Both numbers move together or the shape inverts — by 0.16 on the chord the
 * pickup is the loudest thing in the sound, which is "ta-DA" backwards.
 */
const WIN_PICKUP_GAIN = 0.6
const WIN_CHORD_GAIN = 0.2

function defaultFactory(): AudioContext {
  const Ctor = globalThis.AudioContext
  return new Ctor()
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

      // With a rejection handler even though the resolution is not waited on:
      // iOS Safari rejects `resume()` on a context the OS has interrupted, and
      // `win()` runs four seconds after the gesture that could have satisfied
      // it. The next call retries; the rejection itself is only console noise.
      if (context.state === 'suspended') void context.resume().catch(() => {})
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
       *
       * And CLOSED, not merely dropped, when the context itself was the part
       * that succeeded: a context abandoned open keeps its claim on the audio
       * device, and browsers cap how many may exist at once — so every retry
       * that failed the same way would mint another, until the cap makes even
       * the retry path fail for good. Closing is exactly the recovery the cap
       * error asks for.
       */
      void context?.close().catch(() => {})
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

  /** The launch — and the gate opener. See `WHOOSH_S` for why it must exist. */
  function scheduleWhoosh(ctx: AudioContext, out: GainNode, at: number): void {
    const source = ctx.createBufferSource()
    source.buffer = noiseBuffer(ctx)
    // The buffer is a tenth of a second and the whoosh is longer; an unlooped
    // source would go silent mid-swell.
    source.loop = true

    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(WHOOSH_FROM_HZ, at)
    // Exponential rather than linear, because pitch is heard in ratios: a
    // linear sweep spends most of its time sounding nearly-arrived.
    filter.frequency.exponentialRampToValueAtTime(WHOOSH_TO_HZ, at + WHOOSH_S)
    filter.Q.value = WHOOSH_Q

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(WHOOSH_GAIN, at + WHOOSH_ATTACK_S)
    // The hold needs its own event: an exponential ramp interpolates from the
    // PREVIOUS event, so without this the release would begin at the top of
    // the attack and hollow out the sustain the gate is listening for.
    envelope.gain.setValueAtTime(
      WHOOSH_GAIN,
      at + WHOOSH_ATTACK_S + WHOOSH_HOLD_S,
    )
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + WHOOSH_S)

    source.connect(filter)
    filter.connect(envelope)
    envelope.connect(out)

    source.start(at)
    source.stop(at + WHOOSH_S)
    track(source)
  }

  /** One note of the ta-da: a triangle through its own envelope. */
  function scheduleNote(
    ctx: AudioContext,
    out: GainNode,
    hz: number,
    at: number,
    peak: number,
    decayS: number,
  ): void {
    const oscillator = ctx.createOscillator()
    // Triangle rather than sine: a sine is so pure it reads as a test tone,
    // and a square or saw is bright enough to be shrill an octave up.
    oscillator.type = 'triangle'
    oscillator.frequency.value = hz

    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(peak, at + 0.012)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + decayS)

    oscillator.connect(envelope)
    envelope.connect(out)

    oscillator.start(at)
    oscillator.stop(at + decayS)
    track(oscillator)
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
    spin(schedule) {
      const audio = ensure()
      if (audio === null) return

      // Not `currentTime` itself: the first click is 26ms out, and the margin
      // is what keeps it from being clamped to "now" while this thread is
      // still scheduling the other seventy. See `SCHEDULE_LEAD_S`.
      const start = audio.context.currentTime + SCHEDULE_LEAD_S

      scheduleWhoosh(audio.context, audio.master, start)

      schedule.times.forEach((offsetMs, index) => {
        scheduleTick(
          audio.context,
          audio.master,
          start + offsetMs / 1000,
          schedule.gaps[index],
        )
      })
    },

    win() {
      const audio = ensure()
      if (audio === null) return

      // The same margin as the clicks, and for the same reason: six sources
      // to build before the first is due.
      const start = audio.context.currentTime + SCHEDULE_LEAD_S

      // The "ta" — the upbeat, alone.
      scheduleNote(
        audio.context,
        audio.master,
        WIN_PICKUP_HZ,
        start,
        WIN_PICKUP_GAIN,
        WIN_PICKUP_S,
      )

      // The "da" — the whole chord at once. Together on purpose: staggering
      // these is the arpeggio this sound used to be.
      for (const hz of WIN_CHORD_HZ) {
        scheduleNote(
          audio.context,
          audio.master,
          hz,
          start + WIN_CHORD_AT_S,
          WIN_CHORD_GAIN,
          WIN_CHORD_S,
        )
      }
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

      // Closing frees the audio hardware; a page that unmounts with a context
      // open keeps a thread alive for a wheel nobody is looking at any more.
      void open?.close().catch(() => {})
    },
  }
}
