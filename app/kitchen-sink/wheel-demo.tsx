'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Wheel } from '@/components/wheel/wheel'
import { useSpin } from '@/components/wheel/use-spin'
import type { WheelOption } from '@/lib/wheels/model'
import { OPTIONS_MAX } from '@/lib/wheels/validation'

/**
 * The wheel, drivable by hand.
 *
 * Here rather than on the real page because TASK-17 owns that one, and a
 * component whose whole point is a 4.3-second easing curve should be looked at
 * by a person before it is wired to live data. The slice-count control is the
 * useful part: label flipping, palette wrapping past ten and the pointer
 * landing on the right wedge all change shape with the count, and eyeballing
 * two of them proves very little.
 *
 * Delete this alongside the rest of the kitchen sink whenever it stops earning
 * its keep. Nothing ships it — the page 404s outside development.
 */

const LABELS = [
  'Taqueria Vista',
  'Noodle Bar 88',
  'The Green Bowl',
  'Sunny Deli',
  'Pizzeria Fico',
  'Curry House',
  'Souvlaki Corner',
  'Bánh Mì Brothers',
  'The Long Lunch Company',
  'Ramen Ramen',
  'Falafel Yard',
  'Dosa Diner',
]

function buildOptions(count: number): WheelOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `demo-${index}`,
    label: LABELS[index % LABELS.length],
    addedAt: null,
    fromSuggestion: null,
  }))
}

const COUNTS = [0, 1, 2, 3, 6, 11, OPTIONS_MAX]

export function WheelDemo() {
  const [count, setCount] = useState(6)
  const options = useMemo(() => buildOptions(count), [count])
  const spin = useSpin(options)

  /**
   * The freeze is the least obvious thing on this page and the easiest to read
   * as a bug: pick a new slice count with a result on screen and nothing
   * happens, because the wheel is holding the snapshot it spun until the result
   * is dismissed (ACs 4 and 5). In the real app that window is unmissable — a
   * modal is covering the screen and closing it is what thaws the wheel. Here
   * "Dismiss" is a small button off to one side, so the state has to say so
   * itself or the demo teaches the wrong lesson.
   */
  const stale = spin.options.length !== count

  const status = spin.spinning
    ? stale
      ? `Frozen on ${spin.options.length} slices mid-spin — this is the point: a concurrent edit must not reflow the wheel.`
      : 'Spinning — try changing the slice count now; the wheel should not reflow.'
    : spin.result
      ? stale
        ? `Landed on ${spin.result.option.label}. Still frozen on ${spin.options.length} slices so the pointer keeps agreeing with the result — Dismiss to redraw at ${count}.`
        : `Landed on ${spin.result.option.label}. Change the slice count to see the freeze hold until you Dismiss.`
      : spin.reducedMotion
        ? 'Reduced motion is on: the wheel will jump to its wedge.'
        : // True before the first spin and again after every dismiss, which is
          // why it does not say "until the first spin" — that reads as a lie
          // the moment you dismiss one result and change the count again.
          'No result on screen, so slice changes apply immediately.'

  return (
    <div className="flex flex-col gap-(--space-4)">
      <div className="flex flex-wrap items-center gap-(--space-2)">
        <span className="text-muted-foreground w-28 shrink-0 text-xs">
          slices
        </span>
        {COUNTS.map((value) => (
          <Button
            key={value}
            size="sm"
            variant={value === count ? 'default' : 'secondary'}
            onClick={() => setCount(value)}
          >
            {value}
          </Button>
        ))}
      </div>

      <div className="mx-auto w-full max-w-sm">
        <Wheel
          options={spin.options}
          rotation={spin.rotation}
          transition={spin.transition}
          title="Kitchen sink wheel"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-(--space-3)">
        <Button onClick={spin.spin} disabled={!spin.canSpin}>
          {spin.spinning ? 'Spinning…' : 'Spin the wheel'}
        </Button>
        <Button
          variant="secondary"
          onClick={spin.dismiss}
          disabled={spin.result === null}
        >
          Dismiss
        </Button>
        <span className="text-muted-foreground text-xs">{status}</span>
      </div>
    </div>
  )
}
