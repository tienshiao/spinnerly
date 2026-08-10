'use client'

import { useEffect, useState } from 'react'

import { sliceColors } from '@/app/wheel-palette'
import { cn } from '@/lib/utils'

import { useReducedMotion } from './use-spin'

/**
 * The burst, from the prototype. Purely decorative: `aria-hidden`, and
 * `pointer-events-none` so nothing under it — the winner card, the page behind
 * it — stops taking clicks for the four seconds it is falling.
 *
 * Mount it to fire it. There is no `play()`, no imperative handle and no prop
 * that restarts it; a repeat burst is a remount, which the caller gets for free
 * because the winner modal it lives in unmounts when the result is dismissed
 * and `useSpin` always passes through a null result between two spins. That is
 * why there is no `key` at the call site either — one would be insurance
 * against a remount that already cannot be skipped.
 *
 * It then **takes itself out of the DOM** once the last piece has landed,
 * rather than leaving seventy filled spans parked below the fold for as long as
 * the modal stays open. See `CONFETTI_LIFETIME_MS`.
 */

/** Prototype count. */
export const CONFETTI_PIECES = 70

/**
 * One piece, derived from its index alone.
 *
 * Deterministic on purpose. The prototype seeds nothing either, but here there
 * is a second reason: `Math.random()` during render is impure, `react-hooks`
 * lint refuses it, and a server render that disagreed with the client's would
 * make React discard the markup on hydration. Modulo arithmetic over the index
 * gives the scatter without any of that.
 *
 * Times are integers in milliseconds rather than the prototype's fractional
 * seconds, because `2 + 4 * 0.35` is 3.4000000000000004 and that number ends up
 * in an inline style and in a test's expectation.
 */
function piece(index: number): {
  left: string
  size: { width: string; height: string; borderRadius: string }
  background: string
  durationMs: number
  delayMs: number
  driftPx: number
  rotationDeg: number
} {
  // Two pieces in three are 9x14 rectangles with a 2px corner; the third is a
  // 13px disc.
  const round = index % 3 === 0

  return {
    // 1.41 is coprime with nothing in particular — it simply walks the width
    // without landing pieces in visible columns the way a whole number would.
    left: `${(index * 1.41) % 100}%`,
    size: round
      ? { width: '13px', height: '13px', borderRadius: 'var(--radius-pill)' }
      : { width: '9px', height: '14px', borderRadius: '2px' },
    background: sliceColors(index).fill,
    durationMs: 2000 + (index % 5) * 350,
    delayMs: (index % 11) * 90,
    driftPx: ((index % 7) - 3) * 34,
    rotationDeg: index % 2 === 0 ? -720 : 900,
  }
}

const PIECES = Array.from({ length: CONFETTI_PIECES }, (_, index) =>
  piece(index),
)

/**
 * When the last piece has finished falling, and so when the layer removes
 * itself.
 *
 * Derived from the pieces rather than written down, so a change to the stagger
 * cannot leave this behind — and it is a maximum over both terms together
 * rather than the longest duration plus the longest delay, since the two cycle
 * on different periods and no piece need hold both. (One does, as it happens:
 * 5 and 11 are coprime, so index 54 draws the longest of each. That is a fact
 * about 70 pieces, not something to rely on.)
 */
export const CONFETTI_LIFETIME_MS = Math.max(
  ...PIECES.map((entry) => entry.durationMs + entry.delayMs),
)

export function Confetti({ className }: { className?: string }) {
  /**
   * AC 3, and the reason it is a `return null` rather than a shortened
   * animation: reduced motion asks for the movement to be gone, and seventy
   * elements crossing the viewport is the movement. Nothing else about the
   * moment changes — the modal still opens, the result is still announced.
   *
   * Read here rather than taken as a prop so that the guarantee belongs to the
   * component that draws the pieces. A caller can forget a prop.
   */
  const reducedMotion = useReducedMotion()

  /**
   * Self-removal, and the one piece of state here.
   *
   * `useState` + `setTimeout` rather than an `animationend` listener on the
   * last piece: `animationend` does not fire for an element whose animation
   * never started, which is what a backgrounded tab does to it, and the layer
   * would then outlive the modal it came in with.
   */
  const [landed, setLanded] = useState(false)

  useEffect(() => {
    if (reducedMotion) return

    const timer = setTimeout(() => {
      setLanded(true)
    }, CONFETTI_LIFETIME_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [reducedMotion])

  if (reducedMotion || landed) return null

  return (
    <div
      aria-hidden
      data-slot="confetti"
      className={cn(
        'pointer-events-none fixed inset-0 z-45 overflow-hidden',
        className,
      )}
    >
      {PIECES.map((entry, index) => (
        <span
          key={index}
          // `-top-[10vh]`, not `top-0`: a piece waits out its stagger — up to
          // 900ms — before its animation styles anything at all, so this is
          // where it sits until then. See app/motion.css.
          className="animate-confetti-fall absolute -top-[10vh] block"
          style={
            {
              left: entry.left,
              ...entry.size,
              background: entry.background,
              // Longhands, overriding only the timing out of the shorthand the
              // utility class sets. See the note in app/motion.css.
              animationDuration: `${entry.durationMs}ms`,
              animationDelay: `${entry.delayMs}ms`,
              '--confetti-dx': `${entry.driftPx}px`,
              '--confetti-rot': `${entry.rotationDeg}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
