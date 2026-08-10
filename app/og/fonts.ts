import type { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { OG_FONT } from './theme'

/**
 * Caprasimo and Figtree, as Satori can consume them.
 *
 * **These files exist because the OG route cannot reuse the app's fonts.**
 * app/fonts.ts loads both faces through `next/font/google`, which self-hosts
 * them as **woff2** under `.next/static/media` with content-hashed filenames.
 * Satori does not parse woff2 at all — it wants ttf, otf or woff — and a hashed
 * path under a build directory is not something a route handler can name
 * anyway. So the OG image gets its own copies, committed under assets/fonts.
 *
 * Both faces are OFL-1.1, so redistributing them in this repository is fine;
 * the licence text for each sits beside the file it covers.
 *
 * Not subset, though a subset would be smaller. The only text these cards draw
 * is a wheel's title, and a title is up to `TITLE_MAX` code points of arbitrary
 * user input — an ASCII subset would render "Café" with a hole in it. The files
 * are ~40KB each as they stand, which is not worth optimising against that.
 *
 * Read once at module scope rather than per request. The files never change
 * between deployments, and `ImageResponse` is handed the same buffers every
 * time. Next.js traces `process.cwd()`-rooted reads into the deployment bundle,
 * and next.config.ts states these paths again in `outputFileTracingIncludes` so
 * the trace cannot miss them — a missing font is a blank card at runtime rather
 * than a build failure, which is the worst way to find out.
 */

const FONT_DIR = join(process.cwd(), 'assets', 'fonts')

const [caprasimo, figtree, figtreeBold] = await Promise.all([
  readFile(join(FONT_DIR, 'Caprasimo-Regular.ttf')),
  readFile(join(FONT_DIR, 'Figtree-Regular.ttf')),
  readFile(join(FONT_DIR, 'Figtree-Bold.ttf')),
])

/**
 * The `fonts` option, typed off `ImageResponse`'s own signature rather than
 * restated. Satori's weight field is a union of the nine numeric weights, so a
 * plain `number` would not assign — and hand-writing the union here would be a
 * copy of a type that already exists two imports away.
 */
type ImageResponseOptions = NonNullable<
  ConstructorParameters<typeof ImageResponse>[1]
>

export const OG_FONTS: ImageResponseOptions['fonts'] = [
  // Caprasimo ships one weight; there is no bold to fall back to, so nothing in
  // these cards should ask for one.
  { name: OG_FONT.heading, data: caprasimo, weight: 400, style: 'normal' },
  { name: OG_FONT.body, data: figtree, weight: 400, style: 'normal' },
  { name: OG_FONT.body, data: figtreeBold, weight: 700, style: 'normal' },
]
