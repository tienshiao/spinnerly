import { DECORATIVE_SLICES, sliceColors } from '@/app/wheel-palette'
import { WheelMark } from '@/components/wheel/disc'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'
import type { WheelPreview } from '@/lib/wheels/model'

import {
  INVITATION,
  decorativeSlices,
  displayTitle,
  optionCountLine,
  optionPills,
  titleFontSize,
} from './preview'
import { OG, OG_FONT, OG_SIZE } from './theme'
import { OgWheel } from './wheel'

/**
 * The two Open Graph cards, as Satori can render them.
 *
 * Both are rebuilds of the prototypes in docs/spin-the-wheel-editor/project/
 * (`OG Image.dc.html` and `OG Image - Shared Wheel.dc.html`) under three
 * constraints that design does not survive unaltered:
 *
 *  - **Flexbox only.** Both prototypes lay their two columns out with CSS grid,
 *    which Satori does not implement. They are nested flex rows here.
 *  - **No `conic-gradient`.** Both draw their wheel and their brand dot with
 *    one. Those are SVG arcs now — see ./wheel.tsx.
 *  - **No stylesheet.** Every colour is a literal from ./theme.ts rather than a
 *    `var(--color-*)`, because there is no cascade to resolve one against.
 *
 * One thing is missing rather than translated. `OG Image - Shared Wheel` shows
 * four option pills and a `+2 more`; this card shows a count instead. That is
 * design doc section 11 question 1 winning over the prototype, per CLAUDE.md —
 * the reasoning is in ./preview.ts, and it is the whole of AC 5.
 *
 * Neither of these is a React component in the app's sense. They are never
 * mounted, hydrated or re-rendered; `ImageResponse` walks the element tree once
 * and produces a PNG. Nothing here may reach for a hook, a client component or
 * the DOM.
 */

/**
 * How wide the wheel card's text may run.
 *
 * Narrower than the column it sits in, which is 592px once its padding is taken
 * off. The title and the pills share it so a long title's wrapped lines and the
 * row of pills below them line up on the right as well as the left — and, for
 * the title, so that "as wide as it likes" is not the answer to a word that has
 * no break in it.
 */
const PANEL_WIDTH = 560

/** The soft out-of-frame circles both prototypes float behind their content. */
type BlobProps = {
  size: number
  color: string
  opacity: number
  top?: number
  left?: number
  right?: number
  bottom?: number
}

function Blob({ size, color, opacity, ...at }: BlobProps) {
  return (
    <div
      style={{
        position: 'absolute',
        ...at,
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        opacity,
      }}
    />
  )
}

/** The `Spinnerly` lockup: the four-quarter mark and the wordmark beside it. */
function Lockup({ size, fontSize }: { size: number; fontSize: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <WheelMark size={size} surface={OG.surface} />
      <span
        style={{
          fontFamily: OG_FONT.heading,
          fontSize,
          color: OG.neutral700,
        }}
      >
        {SITE_NAME}
      </span>
    </div>
  )
}

/** One named option: a dot in its slice's colour and the label beside it. */
function OptionPill({ label, palette }: { label: string; palette: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 20px 9px 13px',
        borderRadius: 999,
        background: OG.surface,
        border: `1px solid ${OG.divider}`,
        fontSize: 21,
      }}
    >
      <div
        style={{
          width: 15,
          height: 15,
          borderRadius: 15,
          background: sliceColors(palette).fill,
        }}
      />
      {label}
    </div>
  )
}

/**
 * The per-wheel card: disc on the left, title, options and count on the right.
 *
 * `null` is a wheel that could not be read — reaped, never existed, or a
 * Firestore call that did not answer. It renders the same frame with the
 * generic title and no pills, so a crawler that catches us mid-outage caches a
 * plain Spinnerly card rather than a broken image. See `wheelMetadata` for why
 * the three cases are not distinguished.
 */
export function WheelCard({ preview }: { preview: WheelPreview | null }) {
  const title = displayTitle(preview?.title)
  const count = preview?.optionCount ?? 0
  const { pills, overflow } = optionPills(preview?.options ?? [])

  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        background: OG.bg,
        color: OG.text,
        fontFamily: OG_FONT.body,
      }}
    >
      <Blob
        size={400}
        color={OG.accent2_200}
        opacity={0.7}
        top={-160}
        right={-120}
      />
      <Blob
        size={420}
        color={OG.accent200}
        opacity={0.6}
        bottom={-200}
        left={300}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: 520,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <OgWheel size={400} slices={decorativeSlices(count)} />
      </div>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 22,
          padding: '0 76px 0 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Lockup size={34} fontSize={22} />
          <span
            style={{
              display: 'flex',
              padding: '6px 15px',
              borderRadius: 999,
              background: OG.accent2_200,
              color: OG.accent2_800,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {INVITATION}
          </span>
        </div>

        {/*
          `maxWidth` and `wordBreak` are both load-bearing, and the failure is
          silent: the column is `align-items: flex-start`, so a title with no
          break opportunity in it just grows past the card and is cropped by the
          root's `overflow: hidden`. `titleFontSize` shrinks the text but cannot
          save a single 40-character word, and a title is 80 code points of
          arbitrary user input — a URL, a hashtag, a run of CJK. Breaking
          mid-word is ugly; a title sheared off at the card edge and cached that
          way is worse.
        */}
        <div
          style={{
            display: 'flex',
            maxWidth: PANEL_WIDTH,
            fontFamily: OG_FONT.heading,
            fontSize: titleFontSize(title),
            lineHeight: 0.96,
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>

        {/*
          The options, when there are any. Wrapping, and capped at `PILLS_MAX`
          with the remainder counted.

          `maxWidth` rather than the column's own width: the pills sit against
          the title above them, and letting them run the full 592px puts a
          fourth pill out past the longest line of a wrapped title, which reads
          as a stray rather than as a row.
        */}
        {pills.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 9,
              maxWidth: PANEL_WIDTH,
            }}
          >
            {pills.map((pill) => (
              <OptionPill key={pill.palette} {...pill} />
            ))}
            {overflow > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '9px 20px',
                  borderRadius: 999,
                  background: OG.neutral200,
                  color: OG.neutral600,
                  fontSize: 21,
                }}
              >
                +{overflow} more
              </div>
            )}
          </div>
        )}

        {/* The tagline stands in for the count when there is no wheel to count,
            so the card and `wheelMetadata` say the same thing in both branches.
            A count line under an unknown title would be describing a wheel this
            card could not read. */}
        <div style={{ display: 'flex', fontSize: 24, color: OG.neutral700 }}>
          {preview ? optionCountLine(count) : SITE_TAGLINE}
        </div>
      </div>
    </div>
  )
}

/** One of the two sample-wheel pills along the bottom of the marketing card. */
function SamplePill({
  children,
  background,
  color,
  heading,
}: {
  children: string
  background: string
  color: string
  heading?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        padding: '12px 26px',
        borderRadius: 999,
        background,
        color,
        fontSize: 22,
        fontFamily: heading ? OG_FONT.heading : OG_FONT.body,
      }}
    >
      {children}
    </div>
  )
}

/**
 * The site card: the pitch on the left, a tilted decorative disc on the right.
 *
 * Fixed copy and a fixed wheel, so unlike `WheelCard` it has nothing that can go
 * stale and no data to read. That is what lets app/opengraph-image.tsx be
 * prerendered at build time.
 *
 * The headline is two elements rather than one string with a `<br />`, because
 * the break is a design decision — the prototype sets it deliberately — and
 * leaving it to Satori's wrapping would put it wherever the measured width fell.
 */
export function MarketingCard() {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        overflow: 'hidden',
        width: OG_SIZE.width,
        height: OG_SIZE.height,
        background: OG.bg,
        color: OG.text,
        fontFamily: OG_FONT.body,
      }}
    >
      <Blob
        size={420}
        color={OG.accent200}
        opacity={0.7}
        top={-170}
        left={-130}
      />
      <Blob
        size={380}
        color={OG.accent2_200}
        opacity={0.7}
        bottom={-190}
        left={140}
      />
      <Blob
        size={62}
        color={sliceColors(1).fill}
        opacity={1}
        top={74}
        right={470}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 26,
          padding: '0 0 0 76px',
        }}
      >
        <Lockup size={46} fontSize={30} />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontFamily: OG_FONT.heading,
            // 92 in the prototype, which was measured against a browser's
            // Caprasimo. Satori sets it a shade wider, and at 92 "Stop
            // debating." is one pixel-run too long for the column and breaks
            // after "Stop" — three lines where the design has two.
            fontSize: 84,
            lineHeight: 0.94,
            letterSpacing: '-0.01em',
          }}
        >
          <span>Stop debating.</span>
          <span>Spin for it.</span>
        </div>

        <div
          style={{
            display: 'flex',
            maxWidth: 500,
            fontSize: 27,
            lineHeight: 1.4,
            color: OG.neutral700,
          }}
        >
          {SITE_TAGLINE}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <SamplePill background={OG.accent} color={OG.surface} heading>
            Team lunch
          </SamplePill>
          <SamplePill background={OG.accent2_200} color={OG.accent2_800}>
            Who runs standup
          </SamplePill>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: 520,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* The pale halo behind the disc. Wider than its column on purpose —
            the root's `overflow: hidden` crops it, as it does in the prototype. */}
        <Blob
          size={560}
          color={OG.surface}
          opacity={0.55}
          left={-20}
          top={(OG_SIZE.height - 560) / 2}
        />
        <OgWheel size={430} slices={DECORATIVE_SLICES} tilt={-12} />
      </div>
    </div>
  )
}
