import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { conicFromPalette, sliceColors } from './wheel-palette'
import { CreateWheelButton, CreateWheelProvider } from './create-wheel-button'
import './landing.css'

/**
 * The landing page, ported from docs/spin-the-wheel-editor/project/Home.dc.html.
 *
 * A server component still, with one client boundary in it. The two "Make a
 * wheel" buttons are `CreateWheelButton` — they post to the create endpoint and
 * navigate into the new wheel's edit URL, which is the whole of the create flow
 * (TASK-21). Both sit under one `CreateWheelProvider`, which is what makes
 * "only one wheel is being made" a fact about the page rather than about
 * whichever button was pressed.
 *
 * The other two call-to-action buttons stay deliberately inert `<button>`
 * elements, and stay styled with `buttonVariants()` rather than the `Button`
 * component: Base UI's Button carries a 'use client' directive, and opening a
 * client boundary for a control that does nothing would ship JavaScript for no
 * behaviour. Both belong to TASK-22, which owns the one question neither this
 * task nor that styling can answer — where "See a live one" goes, given a demo
 * wheel needs an owner, a mutation policy and something to reset it.
 *
 * Every such call is wrapped in `cn()`. `buttonVariants()` alone returns raw cva
 * output, which concatenates rather than merges: an override and the variant
 * default both survive into the class list and the winner is decided by
 * stylesheet order, not by call site. That silently rendered the band's button
 * white-on-white — `bg-white` won, `text-accent-700` lost to
 * `text-primary-foreground`. `cn()` runs tailwind-merge, which drops the
 * superseded class outright.
 *
 * The prototype is a fixed-width desktop mockup with no media queries; its hero
 * grid alone has a 680px floor. The responsive behaviour here is therefore new
 * work rather than a port, and is the one place this file departs from the
 * prototype by design.
 */

/* Colours drawn from the wheel palette rather than repeated as literals, so a
 * retune of the slice colours carries through to the page that advertises them.
 * Each index list names the prototype's exact sequence — the hero wheel skips
 * SLICE[7] (the pink) and closes on SLICE[8], which is why these are explicit
 * index lists rather than a `.slice(0, n)`. */
const HERO_WHEEL_SLICES = [0, 1, 2, 3, 4, 5, 6, 8] as const
const BRAND_MARK_SLICES = [0, 1, 2, 4] as const
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
        <header
          className={`relative flex flex-wrap items-center justify-between gap-5 py-[22px] ${GUTTER}`}
        >
          <div className="flex items-center gap-3">
            <div
              className="rounded-pill size-[38px] shadow-[inset_0_0_0_5px_#fff]"
              style={{ background: conicFromPalette(BRAND_MARK_SLICES) }}
              aria-hidden="true"
            />
            <span className="font-heading text-[22px]">Spinnerly</span>
          </div>
          <nav className="flex items-center gap-6.5 text-[15px]">
            <a href="#how">How it works</a>
            <a href="#uses">Ideas</a>
            <button type="button" className={cn(buttonVariants())}>
              Open a wheel
            </button>
          </nav>
        </header>

        {/* Both "Make a wheel" buttons under one provider, so the second cannot
            post while the first's request is out — see create-wheel-button.tsx.
            Everything inside stays a server component: `children` is passed
            through, not rendered by the client boundary. */}
        <CreateWheelProvider>
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
                <div className="flex flex-wrap gap-3 pt-1">
                  <CreateWheelButton className="px-9 py-[15px] text-lg shadow-md">
                    Make a wheel
                  </CreateWheelButton>
                  <button
                    type="button"
                    className={cn(
                      buttonVariants({ variant: 'secondary' }),
                      'px-8 py-[15px] text-lg',
                    )}
                  >
                    See a live one
                  </button>
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

              <div className="flex justify-center" aria-hidden="true">
                <div className="relative w-[min(420px,100%)]">
                  {/* The pointer. A CSS triangle, as in the prototype. */}
                  <div className="border-t-accent-600 absolute -top-2 left-1/2 z-2 size-0 -translate-x-1/2 border-x-[15px] border-t-[30px] border-x-transparent" />
                  <div className="rounded-pill bg-surface aspect-square w-full p-2.5 shadow-lg">
                    <div
                      className="landing-turn rounded-pill relative size-full"
                      style={{
                        background: conicFromPalette(HERO_WHEEL_SLICES),
                      }}
                    >
                      <div className="bg-surface rounded-pill border-accent absolute inset-[38%] border-5" />
                    </div>
                  </div>
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
