'use client'

import { sliceColors } from '@/app/wheel-palette'
import type { WheelOption } from '@/lib/wheels/model'

import { DISC_SHADOW, WheelDisc, WheelPointer, type DiscSlice } from './disc'
import { labelPlacement, truncateLabel } from './geometry'

/**
 * The wheel, drawn. Presentational and stateless.
 *
 * It takes the options to draw rather than reaching for them, which is what
 * lets ./use-spin.ts hand it a frozen snapshot mid-spin without this component
 * knowing that snapshots exist. Rotation and transition arrive the same way.
 * The consequence worth stating: **the caller decides what is on the wheel, so
 * a caller that passes live options during a spin gets a wheel that reflows
 * mid-rotation.** Use `useSpin`'s `options`, not the session's.
 *
 * The picture itself — backdrop, wedges, hub, pointer — is ./disc.tsx, shared
 * with the landing hero and the Open Graph card so the three cannot drift.
 * What stays here is what only this wheel does: it turns, and its wedges carry
 * labels.
 *
 * The spin button is not here. It belongs to the page (TASK-17), which is also
 * where the role check lives — this draws for editors and participants alike.
 */

export type WheelProps = {
  options: WheelOption[]
  /** Degrees. Only ever increases; see `targetRotation`. */
  rotation: number
  /** Ready for the CSS property, from `useSpin`. */
  transition: string
  /** Announced to assistive tech, since the wheel itself is one image. */
  title: string
  className?: string
}

export function Wheel({
  options,
  rotation,
  transition,
  title,
  className,
}: WheelProps) {
  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      <WheelPointer />

      <div style={{ width: '100%', aspectRatio: '1 / 1' }}>
        <WheelDisc
          slices={slicesFor(options)}
          label={
            options.length === 0
              ? `${title}: no options yet`
              : `${title}: ${options.map((option) => option.label).join(', ')}`
          }
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            borderRadius: '999px',
            filter: `drop-shadow(${DISC_SHADOW})`,
            transform: `rotate(${rotation}deg)`,
            transition,
          }}
        />
      </div>
    </div>
  )
}

/**
 * The options, as wedges with labels on them.
 *
 * **An empty wheel is drawn as a wheel with one blank slice, not as a bare
 * backdrop.** The backdrop is `neutral-100`, so an options-free wheel came out
 * as a white disc under a white rim under a drop shadow — read as a component
 * that had failed to load rather than as a wheel waiting for its first option,
 * which is precisely the state a new wheel opens in.
 *
 * `wedgePath` gives that single slice the full disc: `segmentAngle` floors the
 * count at 1, so the empty wheel and the one-option wheel are the same geometry.
 * No label, because there is nothing to label — the "no options yet"
 * announcement is on the svg's `aria-label`, where it reaches assistive tech
 * without drawing text on a slice that stands for nothing.
 */
function slicesFor(options: WheelOption[]): DiscSlice[] {
  if (options.length === 0) return [{ palette: 0 }]

  return options.map((option, index) => {
    const { ink } = sliceColors(index)
    const placement = labelPlacement(index, options.length)

    return {
      palette: index,
      key: option.id,
      content: (
        <text
          x={placement.x}
          y={placement.y}
          transform={placement.transform}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={ink}
          style={{
            font: '600 15px var(--font-body)',
            letterSpacing: '0.01em',
          }}
        >
          {truncateLabel(option.label)}
        </text>
      ),
    }
  })
}
