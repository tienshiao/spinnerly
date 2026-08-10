import { Badge } from '@/components/ui/badge'
import {
  DISC_SHADOW,
  WheelDisc,
  WheelMark,
  WheelPointer,
} from '@/components/wheel/disc'
import { DECORATIVE_SLICES, sliceColors } from './wheel-palette'
import { CreateWheelButton, CreateWheelProvider } from './create-wheel-button'
import './landing.css'

/**
 * The landing page, ported from docs/spin-the-wheel-editor/project/Home.dc.html.
 *
 * A server component still, with one client boundary in it. Every call to
 * action on the page is now a `CreateWheelButton` — header, hero and closing
 * band — and each posts to the create endpoint and navigates into the new
 * wheel's edit URL, which is the whole of the create flow (TASK-21).
 *
 * All three sit under one `CreateWheelProvider`, which is what makes "only one
 * wheel is being made" a fact about the page rather than about whichever button
 * was pressed. That is why the provider wraps the header as well as the main
 * content: a header button outside it would hold its own claim and could post
 * while the hero's request was still out, which is precisely the double-create
 * the shared claim exists to refuse. Adding a fourth button elsewhere on the
 * page means putting it inside this provider, not beside it.
 *
 * The page offers no way to open an EXISTING wheel, and that is not an
 * oversight. A wheel is reachable only by its link (design doc section 2) —
 * there are no accounts, so there is no list to show and nothing to look a
 * wheel up by. The header slot that read "Open a wheel" promised exactly that
 * and could not deliver it, so it makes a wheel instead. "See a live one" is
 * gone for the neighbouring reason: a public demo wheel is real scope — an
 * owner, a mutation policy, something to reset it — and a landing page is not
 * the place to acquire it. See TASK-22.
 *
 * The prototype is a fixed-width desktop mockup with no media queries; its hero
 * grid alone has a 680px floor. The responsive behaviour here is therefore new
 * work rather than a port, and is the one place this file departs from the
 * prototype by design.
 */

/* Colours drawn from the wheel palette rather than repeated as literals, so a
 * retune of the slice colours carries through to the page that advertises them.
 *
 * The hero wheel's sequence and the brand mark's now live in wheel-palette.ts as
 * DECORATIVE_SLICES and BRAND_MARK_SLICES, because the Open Graph cards draw the
 * same two things and had drifted to different colours. The row of avatars is
 * this page's alone. */
const AVATAR_SLICES = [0, 2, 1, 4] as const

/* The three use-case pills with no counterpart in the theme ramps. The accent
 * and accent-2 pills use tokens; these three are one-off decorative pairs, each
 * a soft ground with an ink dark enough to clear AA on it. Adding ramps to
 * theme.css for three chips on one page would be inventing palette roles the
 * design system does not have. */
const AMBER_PILL = { background: '#ffe6ab', color: '#6b4a00' }
const TEAL_PILL = { background: '#d6f5ea', color: '#0d4c3f' }
const VIOLET_PILL = { background: '#e8e2fb', color: '#3a2a63' }

/* Horizontal gutter, shared by every section so their left edges line up. The
 * prototype's flat 48px leaves no room on a 360px phone. The margin variant is
 * for the call-to-action band, which is an inset filled panel rather than a
 * padded section and so needs the same inset expressed as margin. */
const GUTTER = 'px-5 md:px-12'
const GUTTER_AS_MARGIN = 'mx-5 md:mx-12'

/* The prototype is unbounded, which on a 1920px display strands a 470px copy
 * column in the middle of nothing. Capped here, with the decorative circles
 * left outside the cap so they still bleed off the true page edges. */
const CONTENT = 'mx-auto w-full max-w-[1280px]'

function StepCard({
  step,
  chipStyle,
  chipClassName,
  title,
  children,
}: {
  step: string
  chipStyle?: React.CSSProperties
  chipClassName?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border-divider rounded-lg border bg-neutral-100 p-7 shadow-sm">
      <div
        className={`font-heading rounded-pill mb-4 grid size-11 place-items-center text-xl ${chipClassName ?? ''}`}
        style={chipStyle}
        aria-hidden="true"
      >
        {step}
      </div>
      <h3 className="m-0 mb-2 text-[22px]">{title}</h3>
      <p className="m-0 text-[15px] leading-[1.55] text-neutral-700">
        {children}
      </p>
    </div>
  )
}

function UsePill({
  className,
  style,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <span
      className={`rounded-pill px-6 py-3 text-[17px] ${className ?? ''}`}
      style={style}
    >
      {children}
    </span>
  )
}

export default function Home() {
  return (
    /* overflow-x-clip, not -hidden: the negatively positioned circles need
       clipping, but `hidden` would turn this into a scroll container, which
       breaks any future position:sticky descendant and leaves the page
       programmatically scrollable sideways. `clip` clips without either. */
    <div className="relative min-h-screen overflow-x-clip">
      {/* Decorative only — no information, no interaction, and nothing an
          assistive technology should announce. */}
      <div aria-hidden="true" className="pointer-events-none">
        <div className="rounded-pill bg-accent-200 absolute -top-40 -left-30 size-[420px] opacity-60" />
        <div
          className="landing-drift rounded-pill bg-accent-2-200 absolute top-80 -right-35 size-[360px] opacity-60"
          style={{ '--landing-drift-duration': '9s' } as React.CSSProperties}
        />
        <div
          className="landing-drift rounded-pill absolute top-30 right-[22%] size-[74px] opacity-80"
          style={
            {
              background: sliceColors(1).fill,
              '--landing-drift-duration': '6s',
            } as React.CSSProperties
          }
        />
      </div>

      <div className={CONTENT}>
        {/* Every "Make a wheel" button under one provider, so no second one can
            post while the first's request is out — see create-wheel-button.tsx.
            Everything inside stays a server component: `children` is passed
            through, not rendered by the client boundary. */}
        <CreateWheelProvider>
          <header
            className={`relative flex flex-wrap items-center justify-between gap-5 py-[22px] ${GUTTER}`}
          >
            <div className="flex items-center gap-3">
              <WheelMark className="size-[38px]" />
              <span className="font-heading text-[22px]">Spinnerly</span>
            </div>
            <nav className="flex items-center gap-6.5 text-[15px]">
              <a href="#how">How it works</a>
              <a href="#uses">Ideas</a>
              <CreateWheelButton>Make a wheel</CreateWheelButton>
            </nav>
          </header>

          <main className="relative">
            <section
              className={`grid items-center gap-14 pt-15 pb-[90px] lg:grid-cols-[minmax(360px,1.05fr)_minmax(320px,0.95fr)] ${GUTTER}`}
            >
              <div className="flex flex-col items-start gap-6">
                <Badge variant="secondary">
                  Decide together, in ten seconds
                </Badge>
                {/* The prototype's own scale, not --text-h1: the hero is
                  deliberately larger than the document h1 step. */}
                <h1 className="m-0 text-[clamp(48px,6vw,78px)] leading-[0.98] text-balance">
                  Stop debating. Spin for it.
                </h1>
                <p className="m-0 max-w-[470px] text-[19px] leading-[1.55] text-neutral-700">
                  Build a wheel of options, share a link, and let the whole room
                  watch it land. Everyone can suggest — you decide what makes
                  the cut.
                </p>
                {/* One button, but still a wrapping row: it carries the pt-1
                    that separates the calls to action from the copy above, and
                    keeps the gap ready for a second one. */}
                <div className="flex flex-wrap gap-3 pt-1">
                  <CreateWheelButton className="px-9 py-[15px] text-lg shadow-md">
                    Make a wheel
                  </CreateWheelButton>
                </div>
                <div className="flex items-center gap-2.5 text-sm text-neutral-700">
                  <span className="inline-flex" aria-hidden="true">
                    {AVATAR_SLICES.map((paletteIndex, i) => (
                      <span
                        key={paletteIndex}
                        className="rounded-pill size-[26px] shadow-[0_0_0_3px_var(--color-bg)]"
                        style={{
                          background: sliceColors(paletteIndex).fill,
                          marginLeft: i === 0 ? undefined : '-9px',
                        }}
                      />
                    ))}
                  </span>
                  No account needed. Viewers just click the link.
                </div>
              </div>

              {/* The same drawing the wheel page and the share cards use —
                  components/wheel/disc.tsx. It was a conic-gradient here, which
                  gave the hero a wheel with no dividers between its slices and a
                  hub half again the size of the real one. The rim comes from the
                  backdrop circle inside the SVG now, so the white padded box
                  that used to supply it is gone.

                  `landing-turn` moves to the svg: it is the disc that turns, and
                  the pointer it turns under must not. */}
              <div className="flex justify-center" aria-hidden="true">
                <div className="relative w-[min(420px,100%)]">
                  <WheelPointer />
                  <WheelDisc
                    slices={DECORATIVE_SLICES.map((palette) => ({ palette }))}
                    className="landing-turn block w-full"
                    style={{ filter: `drop-shadow(${DISC_SHADOW})` }}
                  />
                </div>
              </div>
            </section>

            <section id="how" className={`pb-24 ${GUTTER}`}>
              <h2 className="mt-0 mb-7.5 text-[38px]">Three steps, one link</h2>
              <div className="grid [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))] gap-5">
                <StepCard
                  step="1"
                  chipClassName="bg-accent-200 text-accent-800"
                  title="List the options"
                >
                  Type them in, edit them any time. The wheel redraws as you go.
                </StepCard>
                <StepCard
                  step="2"
                  chipClassName="bg-accent-2-200 text-accent-2-800"
                  title="Share the viewer link"
                >
                  Everyone sees the same wheel and can suggest options. Only you
                  can edit or spin.
                </StepCard>
                <StepCard step="3" chipStyle={AMBER_PILL} title="Spin it">
                  Confetti, a winner, and no more back-and-forth in the group
                  chat.
                </StepCard>
              </div>
            </section>

            <section id="uses" className={`pb-24 ${GUTTER}`}>
              <h2 className="mt-0 mb-2 text-[38px]">What people spin for</h2>
              <p className="mt-0 mb-6.5 text-[17px] text-neutral-700">
                Anything with too many opinions and not enough time.
              </p>
              <div className="flex flex-wrap gap-3">
                <UsePill className="bg-accent-200 text-accent-800">
                  Team lunch
                </UsePill>
                <UsePill className="bg-accent-2-200 text-accent-2-800">
                  Who runs standup
                </UsePill>
                <UsePill style={AMBER_PILL}>Friday film</UsePill>
                <UsePill style={TEAL_PILL}>Secret santa order</UsePill>
                <UsePill style={VIOLET_PILL}>Raffle prizes</UsePill>
                <UsePill className="bg-neutral-200 text-neutral-700">
                  Chores
                </UsePill>
              </div>
            </section>

            <section
              className={`bg-accent mb-18 flex flex-wrap items-center justify-between gap-7 rounded-lg px-11 py-14 text-white ${GUTTER_AS_MARGIN}`}
            >
              <div>
                <h2 className="m-0 mb-2.5 text-[40px] leading-[1.05]">
                  Lunch is in twenty minutes.
                </h2>
                <p className="m-0 text-lg opacity-92">
                  Make the wheel now, argue never.
                </p>
              </div>
              {/* The one button that inverts: white fill on the accent band.
                Deep accent for the label — the base accent on white is 3.15:1
                and fails AA, same pairing rule as the global link colour. */}
              <CreateWheelButton className="text-accent-700 bg-white px-9 py-[15px] text-lg hover:bg-neutral-200 active:bg-neutral-300">
                Make a wheel
              </CreateWheelButton>
            </section>
          </main>
        </CreateWheelProvider>

        <footer
          className={`border-divider relative flex flex-wrap justify-between gap-4 border-t pt-6.5 pb-10 text-sm text-neutral-700 ${GUTTER}`}
        >
          <span>Spinnerly</span>
          <span>Made for teams that can&rsquo;t pick a restaurant.</span>
        </footer>
      </div>
    </div>
  )
}
