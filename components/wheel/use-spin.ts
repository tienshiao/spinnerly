'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { WheelOption } from '@/lib/wheels/model'

import { targetRotation } from './geometry'
import { createWheelSounds, type SoundSink } from './sounds'
import { tickSchedule } from './tick-schedule'

/**
 * The spin, as a state machine. Everything time-dependent about the wheel lives
 * here; ./wheel.tsx draws whatever this says and holds no state of its own.
 *
 * There is no server round trip in any of this. Design doc section 10 decision
 * 2: the spin happens in one browser, so there is no shared state to protect
 * and no lock to take. Phase 2 moves the draw to a server-side RNG and records
 * it in a `spins` subcollection; v1 does not, and `pick` being injectable is
 * where that will attach.
 */

/** The CSS transition, matching the prototype. */
export const SPIN_DURATION_MS = 4300

/** The easing. A long, slowing coast that settles rather than stops. */
export const SPIN_EASING = 'cubic-bezier(0.16, 0.85, 0.16, 1)'

/**
 * When the result is announced — 100ms after the transition ends.
 *
 * The gap is deliberate and it is not a fudge for timer drift. A CSS transition
 * reaching its final value and the browser having PAINTED that value are not
 * the same instant, and announcing on the nose puts the winner modal over a
 * wheel that is still visibly a frame short of its wedge.
 */
export const SPIN_SETTLE_MS = 4400

/**
 * The reduced-motion settle, in place of `SPIN_SETTLE_MS`.
 *
 * Not zero. `prefers-reduced-motion` asks for less movement, not for the wheel
 * to be bypassed — and announcing in the same tick as the click would mean the
 * landed wheel never appears at all, so the pointer and the modal would be the
 * first two things the user sees at once. Long enough to read as a beat,
 * short enough that nobody is waiting.
 */
export const REDUCED_MOTION_SETTLE_MS = 400

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * `prefers-reduced-motion`, as an external store.
 *
 * `useSyncExternalStore` rather than `useState` in an effect, because the
 * setting can change while the page is open — a user toggling it in system
 * preferences mid-session — and because the effect version renders one frame
 * with the wrong answer, which for the very first spin is the whole thing this
 * is meant to prevent.
 *
 * `matchMedia` is optional-chained rather than assumed. It is absent in a
 * non-browser environment, and a hook that threw in one would take the page
 * down at import time rather than degrade.
 */
function subscribeReducedMotion(onChange: () => void): () => void {
  const list = globalThis.matchMedia?.(REDUCED_MOTION_QUERY)
  if (list === undefined) return () => {}

  // `addEventListener` on a MediaQueryList is the modern spelling; Safari only
  // grew it in 14. The optional chain covers the older one without a shim,
  // where the consequence of missing it is a setting change mid-session going
  // unnoticed rather than anything breaking.
  list.addEventListener?.('change', onChange)
  return () => list.removeEventListener?.('change', onChange)
}

function getReducedMotion(): boolean {
  return globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false
}

/**
 * The server renders the motion-ful wheel.
 *
 * It cannot know the preference — the media query is a client fact — and the
 * static wheel is identical either way, since nothing is spinning until
 * somebody clicks. Answering `false` here keeps hydration quiet; the real value
 * arrives before any spin can start.
 */
function getServerReducedMotion(): boolean {
  return false
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion,
  )
}

/** What a finished spin landed on. */
export type SpinResult = {
  /** Index into the SNAPSHOT the spin ran against, not into live options. */
  index: number
  option: WheelOption
}

export type SpinState = {
  /**
   * What to draw. The frozen snapshot while a spin is running or its result is
   * on screen, and live options otherwise.
   */
  options: WheelOption[]
  rotation: number
  spinning: boolean
  result: SpinResult | null
  /**
   * Every option this browser has landed on, by id — the Options panel's
   * "Picked" badge.
   *
   * Design doc decision 15 makes it local-only: no field, no endpoint, gone on
   * refresh. It lives here rather than in the page because this is the only
   * code that knows a spin landed. Deriving it from `result` in an effect would
   * be state copied from state, a render behind, and refused by
   * `react-hooks/set-state-in-effect`.
   *
   * Keyed by id, which costs one case: landing on an option whose optimistic
   * row has not reconciled yet records a `local:` id, so the badge is lost when
   * the real id arrives. Keying by label instead would badge both rows of a
   * wheel holding a duplicate label — a permanent wrong answer in place of a
   * transient missing one.
   *
   * It accumulates for the life of the hook and is never cleared: a second
   * wheel is a different page, and `app/w/[shareId]/page.tsx` keys the whole
   * tree on `shareId` so that a fork — which **preserves option ids** — cannot
   * arrive with its options already badged.
   */
  picked: ReadonlySet<string>
  /** Ready for the `transition` CSS property. */
  transition: string
  /** False while spinning and below two options. AC 6. */
  canSpin: boolean
  reducedMotion: boolean
  /**
   * Open the audio device, ahead of a spin that has not happened yet.
   *
   * **Wire this to `pointerdown` and `keydown` on the spin button, not to the
   * click.** By the time a click fires, the first tick is 26ms away and a
   * device starting from cold — a Bluetooth link especially — is still waking
   * up; what plays during that is not heard. A press gives it the time between
   * pressing and releasing, which is the difference between a spin that ticks
   * and one that only ever plays its flourish.
   *
   * Cheap, idempotent, and silent. It respects the mute preference, so it opens
   * nothing for someone who has turned the sound off.
   */
  warm: () => void
  spin: () => void
  /**
   * Announce the result is done with: thaw, and go back to live options.
   *
   * **Whatever presents `result` MUST call this when it closes.** The wheel is
   * frozen from spin start until it runs, so a winner modal (TASK-20) that
   * closes on its own state without calling it leaves the wheel showing the
   * snapshot it spun for the rest of the session — options an editor adds stop
   * appearing, accepted suggestions never show up, and every subsequent spin
   * draws from a list the page stopped displaying.
   *
   * There is no error and nothing in the console; the wheel simply stops
   * tracking. Worth knowing before the modal is built rather than after,
   * because the symptom reads as a broken listener rather than a missed call —
   * the listeners are fine and the projection is fine, and the only thing wrong
   * is a boolean nobody cleared.
   *
   * Every path out of the result closes it: the Nice button, Spin again, the
   * backdrop, Escape. `spin()` also re-freezes from live, so "Spin again" is
   * safe whether or not it dismisses first.
   */
  dismiss: () => void
}

/** Chooses the winning index, given how many options there are. */
export type PickIndex = (count: number) => number

/** A wheel needs two options before spinning it means anything. */
const MIN_OPTIONS = 2

/**
 * The initial `picked` set, shared and never mutated — every addition below
 * copies. A fresh `new Set()` per hook call would be a new identity on every
 * render of a wheel nobody has spun.
 */
const NOTHING_PICKED: ReadonlySet<string> = new Set()

function randomIndex(count: number): number {
  return Math.floor(Math.random() * count)
}

/**
 * Positional rather than an input object, matching `useWheel(shareId)`.
 *
 * Not only style: an exported type with a function-typed member, in a module
 * carrying `'use client'`, trips Next's TypeScript plugin into reporting it as
 * a client component receiving a non-serializable prop. The advice it gives —
 * rename it to `pickAction` — is wrong here, because this is a hook argument
 * and not a prop at all. A second parameter says the same thing with no
 * standing editor warning for the next person to learn to ignore.
 *
 * @param live   Live options, straight from the session projection.
 * @param pick   Injected by tests; the seam phase 2's server draw replaces.
 * @param sink   Where the sound goes. Injected by tests; a browser gets the
 *               real one, built once per hook and holding no audio device until
 *               something is actually played.
 */
export function useSpin(
  live: WheelOption[],
  pick: PickIndex = randomIndex,
  sink?: SoundSink,
): SpinState {
  const [frozen, setFrozen] = useState<WheelOption[] | null>(null)
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [result, setResult] = useState<SpinResult | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(NOTHING_PICKED)
  /** Whether the spin in flight is animating. Fixed at spin start. */
  const [animated, setAnimated] = useState(false)
  const reducedMotion = useReducedMotion()

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** The current rotation, for `spin` to read. See the note where it is used. */
  const rotationRef = useRef(0)

  /**
   * The sound, built once per hook.
   *
   * A `useState` initialiser rather than a module singleton, so two wheels on
   * one page — the kitchen sink has several — cannot cancel each other's
   * clicks. Building it allocates an object and nothing else: no `AudioContext`
   * exists until something is played, which is what keeps a page nobody spins
   * free of an audio device and free of the autoplay warning a context built
   * outside a gesture logs.
   */
  const [ownSink] = useState<SoundSink>(() => sink ?? createWheelSounds())
  const sounds = sink ?? ownSink

  /**
   * Clearing the settle timer on unmount is not tidiness.
   *
   * It fires four and a half seconds after a click, which is comfortably longer
   * than it takes to close a wheel — and a callback that lands after the tree
   * has gone would set state on nothing and, in a test, leak into whichever
   * file the fake clock runs next.
   *
   * The sound is torn down beside it for a louder version of the same reason: a
   * spin's clicks are handed to the audio thread all at once, four seconds
   * ahead, so a page left mid-spin goes on ticking through the wheel that
   * replaced it — or through no wheel at all — with nothing on screen to
   * explain the noise or to stop it.
   */
  useEffect(() => {
    return () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current)
      sounds.dispose()
    }
  }, [sounds])

  const canSpin = !spinning && live.length >= MIN_OPTIONS

  const warm = useCallback(() => {
    sounds.warm()
  }, [sounds])

  const spin = useCallback(() => {
    if (spinning || live.length < MIN_OPTIONS) return

    /**
     * The snapshot, taken once and captured in this closure.
     *
     * Design doc decision 2: freeze the VIEW, do not lock the data. Concurrent
     * editors keep editing throughout — their writes land normally and neither
     * of them is blocked — and what this protects is only the picture, which
     * would otherwise reflow mid-rotation as slices appeared and disappeared
     * under a pointer that is meanwhile aiming at an index that no longer means
     * what it did.
     */
    const snapshot = live

    /**
     * Clamped rather than trusted: an out-of-range `pick` would otherwise index
     * past the snapshot and announce `undefined` as the winner, four seconds
     * after the click and with nothing in between to suggest why.
     *
     * `NaN` needs its own answer, and ONLY `NaN` does. Clamping is comparison,
     * and every comparison against `NaN` is false — so it passes through
     * `Math.trunc`, `Math.max` and `Math.min` unchanged, `snapshot[NaN]` is
     * `undefined`, and `SpinResult.option` ends up holding a value its own type
     * forbids. The infinities are unordered in no such way: `Infinity` clamps
     * to the last index and `-Infinity` to the first, which is what clamping is
     * for, so guarding on `Number.isFinite` here would throw away a correct
     * answer to fix a different value's problem.
     *
     * Not hypothetical, for the reason the parameter exists at all: phase 2's
     * server draw parses an index out of a response, and `Number(...)` of
     * anything malformed is `NaN`.
     */
    const drawn = pick(snapshot.length)
    const index = Number.isNaN(drawn)
      ? 0
      : Math.min(Math.max(Math.trunc(drawn), 0), snapshot.length - 1)

    /**
     * Where the wheel is, from a REF rather than from the `rotation` state.
     *
     * This callback is not rebuilt when the rotation changes — it has no reason
     * to be, since nothing else here reads it — so its closure holds whatever
     * the rotation was when it was last built, and the second spin of a session
     * would compute its target from the first spin's starting angle. The
     * functional `setRotation(current => …)` this replaces solved that for the
     * state and only for the state; the sound needs the same two numbers in a
     * place where a side effect is allowed, which a state updater is not.
     *
     * Safe as a ref for the reason `live` is not: the rotation is this hook's
     * own, monotonic, and written in exactly one place — right here.
     */
    const from = rotationRef.current
    const to = targetRotation(from, index, snapshot.length)
    rotationRef.current = to

    setFrozen(snapshot)
    setResult(null)
    setSpinning(true)
    setAnimated(!reducedMotion)
    setRotation(to)

    /**
     * The clicks, handed over in one go — see ./sounds.ts on why they are given
     * to the audio clock rather than to a timer.
     *
     * Silent under reduced motion, and that is AC 5 rather than caution: the
     * wheel does not travel there, it jumps, so there is no boundary passing
     * the pointer for a click to mark. Four seconds of ticking over a wheel
     * that is already stopped would be a sound effect for an animation the user
     * asked not to see. The win flourish is not motion and still plays.
     */
    if (!reducedMotion) {
      sounds.spin(
        tickSchedule({
          from,
          to,
          count: snapshot.length,
          durationMs: SPIN_DURATION_MS,
        }),
      )
    }

    if (settleTimer.current !== null) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(
      () => {
        settleTimer.current = null
        setSpinning(false)
        /**
         * **The winner comes from the array the rotation was computed against.**
         *
         * The prototype reads `this.state.options[i]` here, which after a
         * mid-spin edit either names a different option than the one the
         * pointer is aimed at or, on a delete, names nothing at all. `index`
         * only means what it meant at spin start in the array it was drawn
         * from.
         *
         * What enforces that is the CLOSURE, not the `snapshot` name: this
         * callback captures the binding once and later renders cannot reach in.
         * Writing `live[index]` here is therefore the identical program — a
         * mutation test confirmed it passes the whole suite — so `snapshot`
         * earns its line as documentation rather than as mechanism.
         *
         * The way it actually comes back is a REF. Anyone who answers a
         * stale-closure warning with `liveRef.current` reintroduces the
         * prototype's bug exactly, and that mutation the suite does catch.
         *
         * Decision 2 accepts the residual explicitly: a result may name an
         * option deleted moments earlier, which for a lunch app is arguably
         * correct — show it, and let the group spin again.
         */
        setResult({ index, option: snapshot[index] })

        /**
         * The badge, recorded from the same snapshot and the same index as the
         * result — so an option removed mid-spin is badged exactly as it is
         * announced, rather than the two disagreeing about what was landed on.
         *
         * Returns the identical set when the id is already in it, so spinning
         * onto the same option twice re-renders nothing.
         */
        setPicked((current) => {
          const id = snapshot[index].id
          if (current.has(id)) return current
          return new Set(current).add(id)
        })

        // With the result rather than with the last click, which is a beat
        // earlier: the flourish belongs to the modal opening, not to the wheel
        // stopping. Played whatever the motion preference, since a chord is not
        // movement.
        sounds.win()
      },
      reducedMotion ? REDUCED_MOTION_SETTLE_MS : SPIN_SETTLE_MS,
    )
  }, [live, pick, reducedMotion, sounds, spinning])

  /**
   * Thaw. Guarded against running mid-spin, where it would undo the freeze that
   * AC 4 is about — the caller for that is a modal that cannot be open yet, so
   * reaching it is a bug rather than a race, and a no-op is the quiet failure.
   */
  const dismiss = useCallback(() => {
    if (spinning) return
    setResult(null)
    setFrozen(null)
  }, [spinning])

  return {
    options: frozen ?? live,
    rotation,
    spinning,
    result,
    picked,
    /**
     * No transition when not spinning, so the wheel holds where it landed, and
     * none under reduced motion, so the rotation applies as a jump to the
     * correct wedge. Jumping rather than skipping is deliberate: the pointer
     * has to agree with the name in the modal, and a wheel left at its old
     * angle would contradict it.
     *
     * Read from `animated`, decided at spin start, rather than from the LIVE
     * `reducedMotion`. The settle delay is chosen at spin start too, and the
     * two have to agree: a preference toggled mid-rotation would otherwise snap
     * the wheel to its wedge immediately while the timer still ran the full
     * 4.4 seconds, leaving several seconds of landed wheel and no result —
     * which is exactly the dead air `REDUCED_MOTION_SETTLE_MS` exists to
     * prevent. One in-flight spin finishes the way it started; the next honours
     * the new setting.
     */
    transition:
      spinning && animated
        ? `transform ${SPIN_DURATION_MS}ms ${SPIN_EASING}`
        : 'none',
    canSpin,
    reducedMotion,
    warm,
    spin,
    dismiss,
  }
}
