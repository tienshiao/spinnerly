import { DECORATIVE_SLICES, PALETTE_LENGTH } from '@/app/wheel-palette'
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site'
import type { WheelPreview } from '@/lib/wheels/model'

/**
 * Everything an unfurl says about a wheel, derived from the little it is
 * allowed to know.
 *
 * Pure, and separate from the cards for two reasons. It is the half that can be
 * tested under `npm test` — Satori's output is a PNG, and asserting on pixels
 * would test the renderer rather than the wording. And `generateMetadata` and
 * `opengraph-image` are two different route files that must agree: a card
 * saying "6 options on the wheel" beside an `og:description` saying five is a
 * mismatch nobody would notice locally, because they are read by different
 * programs.
 *
 * **Everything here is read from a cache, possibly long after it stopped being
 * true.** Slack and X keep an unfurl against the share URL — the string people
 * paste — and never come back for it, so there is no cache-busting move and no
 * way to correct a card once it is out. Design doc section 3.
 *
 * The card shows the options anyway. Design doc section 11 question 1 left that
 * open, leaning towards title and count alone; it is answered the other way —
 * the prototype's pills are worth more than the risk, and a list four items long
 * on a wheel that has since grown reads as a wheel that has grown, which is what
 * happened. What staleness does rule out is anything phrased as current or
 * complete: `optionCountLine` describes rather than promises, `optionPills`
 * always says how many it left out, and nothing anywhere claims the list is all
 * of them.
 */

/**
 * What a share link is called before we know whose it is.
 *
 * Used for a wheel that does not exist and for a read that failed — see
 * `wheelMetadata`, which deliberately cannot tell those apart.
 */
export const UNKNOWN_WHEEL_TITLE = 'A wheel to spin'

/** The badge above the title. Fixed copy, so nothing in it can go stale. */
export const INVITATION = "You're invited to spin"

/**
 * The count, in words, as it appears on the card.
 *
 * Written for the reader of a *cached* card, which is why it never promises the
 * number is current. "6 options on the wheel" describes the wheel at the moment
 * the image was made; the page behind the link is the live answer.
 *
 * Zero gets its own line rather than "0 options". An empty wheel is the state a
 * link is most likely to be shared from — the organiser pastes the URL and then
 * fills it in — so this is the case the copy should read well for, and by the
 * time anyone clicks it is usually no longer true.
 */
export function optionCountLine(count: number): string {
  const n = safeCount(count)
  if (n === 0) return 'Options going up now'
  if (n === 1) return '1 option on the wheel'
  return `${n} options on the wheel`
}

/**
 * The wedges the card's disc gets, as palette indices.
 *
 * Indices rather than a count so the wheel drawn here is the wheel drawn on the
 * page: `wedge i` takes `SLICE[i]`, exactly as components/wheel/wheel.tsx colours
 * an option by its position. The pills beside it are coloured from the same
 * source, which is what pairs a pill with its slice.
 *
 * Two bounds, in opposite directions:
 *
 *  - **Under three, fall back to `DECORATIVE_SLICES`.** One wedge is a plain
 *    disc and two is a coin; neither reads as a wheel, and the empty wheel is
 *    the commonest thing to share (see `optionCountLine`), so this is the
 *    default case rather than an edge one. That fallback is the landing hero's
 *    sequence, so an empty wheel unfurls as the wheel on the marketing card.
 *  - **Over `PALETTE_LENGTH`, stop at it.** The palette has ten colours and
 *    wraps, so an eleventh wedge repeats the first — and at `OPTIONS_MAX` of 50
 *    the disc is fifty slivers of five repeated colours, which reads as noise
 *    rather than as a wheel. Ten is one full pass with no repeat.
 */
export function decorativeSlices(optionCount: number): readonly number[] {
  const n = safeCount(optionCount)
  if (n < 3) return DECORATIVE_SLICES
  return Array.from({ length: Math.min(n, PALETTE_LENGTH) }, (_, i) => i)
}

/**
 * The title's font size, in pixels, chosen by how long the title is.
 *
 * A ramp rather than a clamp because Satori has no `line-clamp` worth relying
 * on and truncating someone's title in their own unfurl is worse than setting
 * it smaller. The buckets are sized so that `TITLE_MAX` — 80 code points — still
 * lands inside the card's right-hand column at the smallest step.
 *
 * Counted in code points, like everything else that measures user text here:
 * `.length` would count an emoji as two and drop a short title a bucket for no
 * reason. See the same argument in lib/wheels/validation.ts.
 */
export function titleFontSize(title: string): number {
  const points = Array.from(title).length
  if (points <= 14) return 76
  if (points <= 26) return 62
  if (points <= 46) return 48
  return 38
}

/**
 * How many options the card names before it starts counting instead.
 *
 * Four is the prototype's. It is also about what fits: the pills wrap, and a
 * fifth pushes them to a third row under a long title.
 */
export const PILLS_MAX = 4

/**
 * How long a pill's label may be before it is cut short.
 *
 * `OPTION_LABEL_MAX` is 60, which at the card's 22px would take a row on its
 * own and push everything after it off the card. Longer than the wheel's own
 * `LABEL_MAX` of 18, because a pill is a horizontal box rather than a wedge and
 * has the room.
 */
export const PILL_LABEL_MAX = 24

export type OptionPill = {
  label: string
  /** Which slice this is, so the pill's dot matches its wedge. */
  palette: number
}

export type OptionPills = {
  pills: OptionPill[]
  /** How many options are not shown. Zero means the list is all of them. */
  overflow: number
}

/**
 * The options, as the card lists them.
 *
 * **The one place a cached card makes a claim about specific things**, which is
 * what design doc section 11 question 1 was weighing. Two rules keep it honest
 * when it goes stale, and both are load-bearing rather than cosmetic:
 *
 *  - **Anything not shown is counted**, so a card that has more to say says so.
 *    Four pills followed by "+2 more" read as a sample; four pills alone read as
 *    the whole wheel. `overflow` is 0 at exactly `PILLS_MAX` and that is right
 *    rather than a gap — the list really was complete when the image was made,
 *    and the count line beside it already says the same number. What would be
 *    wrong is a fifth option going unmentioned.
 *  - **The order is the wheel's order**, and `palette` is the option's position
 *    rather than the pill's, so a pill's dot is its own wedge's colour. That is
 *    also why nothing is sorted or filtered here: a card whose pills did not
 *    line up with its disc would be a picture disagreeing with itself.
 *
 * Non-string and empty labels are dropped rather than rendered as blank pills.
 * No write path can produce one — `validateOptionLabel` refuses both — but this
 * reads a stored document, and an empty pill on a cached card cannot be fixed.
 */
export function optionPills(options: readonly string[]): OptionPills {
  const usable = options
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => typeof label === 'string' && label.trim() !== '')

  return {
    pills: usable.slice(0, PILLS_MAX).map(({ label, index }) => ({
      label: shorten(label.trim(), PILL_LABEL_MAX),
      palette: index,
    })),
    overflow: Math.max(0, usable.length - PILLS_MAX),
  }
}

/** What the card and the metadata call a wheel, with the empty case handled. */
export function displayTitle(title: string | undefined): string {
  const trimmed = title?.trim()
  return trimmed ? trimmed : UNKNOWN_WHEEL_TITLE
}

export type WheelMetadataCopy = {
  title: string
  description: string
}

/**
 * The `<title>` and `og:description` for a wheel page.
 *
 * `null` means the wheel could not be read — it does not exist, or Firestore
 * did not answer. **Those two are deliberately indistinguishable here.** A
 * description that said "this wheel has expired" would be pinned into every
 * crawler's cache by a single failed read during a deploy, and would then
 * describe a live wheel as gone for as long as the cache holds. The generic
 * copy is true in both cases and stays true if the wheel comes back.
 */
export function wheelMetadata(preview: WheelPreview | null): WheelMetadataCopy {
  if (!preview) {
    return { title: UNKNOWN_WHEEL_TITLE, description: SITE_TAGLINE }
  }

  const title = displayTitle(preview.title)
  const count = safeCount(preview.optionCount)

  if (count === 0) {
    return {
      title,
      description: `A wheel on ${SITE_NAME}, filling up now. Open it to add an option or give it a spin.`,
    }
  }

  return {
    title,
    description: `${optionCountLine(count)}. Open it and give it a spin.`,
  }
}

/**
 * A label, cut to `max` code points with an ellipsis.
 *
 * Code points rather than UTF-16 units, for the reason
 * components/wheel/geometry.ts gives at length: a plain `.slice` can cut an
 * astral character in half and leave a lone surrogate, which renders as a
 * replacement box — and a label is arbitrary user text, so this is reachable
 * rather than theoretical.
 */
function shorten(label: string, max: number): string {
  const points = Array.from(label)
  if (points.length <= max) return label
  return points.slice(0, max - 1).join('') + '…'
}

/**
 * A count that can be rendered.
 *
 * Defensive because the input comes from a Firestore document rather than from
 * this codebase, and the failure it prevents is silent: `undefined` interpolates
 * into "undefined options on the wheel", and a fractional or negative number
 * reaches `decorativeSlices` and draws a disc with `NaN` wedges, which SVG
 * renders as nothing at all.
 */
function safeCount(count: number): number {
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.trunc(count))
}
