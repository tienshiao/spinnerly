'use client'

import { sliceColors } from '@/app/wheel-palette'
import type { WheelOption } from '@/lib/wheels/model'

import {
  BACKDROP_RADIUS,
  CENTER,
  HUB_RADIUS,
  HUB_STROKE,
  VIEWBOX,
  WEDGE_STROKE,
  labelPlacement,
  truncateLabel,
  wedgePath,
} from './geometry'

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
      {/*
        The pointer is a CSS triangle sitting OVER the SVG rather than a shape
        inside it, and that is structural rather than stylistic: everything
        inside the svg element rotates with the wheel, so a pointer drawn there
        would spin along with the wedges it is supposed to be indicating.
      */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '17px solid transparent',
          borderRight: '17px solid transparent',
          borderTop: '34px solid var(--color-accent-600)',
          zIndex: 2,
          filter: 'drop-shadow(0 2px 3px rgba(46,43,37,0.3))',
        }}
      />

      <div style={{ width: '100%', aspectRatio: '1 / 1' }}>
        <svg
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          role="img"
          aria-label={
            options.length === 0
              ? `${title}: no options yet`
              : `${title}: ${options.map((option) => option.label).join(', ')}`
          }
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            borderRadius: '999px',
            filter: 'drop-shadow(0 12px 28px rgba(46,43,37,0.22))',
            transform: `rotate(${rotation}deg)`,
            transition,
          }}
        >
          {/* Behind the wedges, so their white stroke has something to sit on
              rather than half-fading into the page. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={BACKDROP_RADIUS}
            fill="var(--color-neutral-100)"
          />

          {/*
            An empty wheel is drawn as a wheel with one blank slice, not as a
            bare backdrop. The backdrop is `neutral-100`, so an options-free
            wheel came out as a white disc under a white rim under a drop
            shadow — read as a component that had failed to load rather than as
            a wheel waiting for its first option, which is precisely the state a
            new wheel opens in.

            `wedgePath(0, 0)` is the same full-disc path a single-option wheel
            gets: `segmentAngle` floors the count at 1, so the empty wheel and
            the one-option wheel are the same geometry, and this fills it with
            the same first palette colour. No label, because there is nothing to
            label — the "no options yet" announcement is on the svg's aria-label,
            where it reaches assistive tech without drawing text on a slice that
            stands for nothing.
          */}
          {options.length === 0 && (
            <path
              d={wedgePath(0, 0)}
              fill={sliceColors(0).fill}
              stroke="#ffffff"
              strokeWidth={WEDGE_STROKE}
            />
          )}

          {options.map((option, index) => {
            const { fill, ink } = sliceColors(index)
            const placement = labelPlacement(index, options.length)

            return (
              <g key={option.id}>
                <path
                  d={wedgePath(index, options.length)}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={WEDGE_STROKE}
                />
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
              </g>
            )
          })}

          {/* Over the wedge points, which would otherwise converge into a
              muddy spike of six overlapping white strokes at the centre. */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={HUB_RADIUS}
            fill="var(--color-neutral-100)"
            stroke="var(--color-accent-500)"
            strokeWidth={HUB_STROKE}
          />
        </svg>
      </div>
    </div>
  )
}
