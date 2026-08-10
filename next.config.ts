import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The Open Graph cards read three .ttf files off disk at module scope (see
   * app/og/fonts.ts), and a serverless bundle only contains what the build's
   * file trace decided it needed.
   *
   * Stated explicitly rather than left to the tracer because of how it fails:
   * a font that did not make it into the bundle is not a build error, it is a
   * card rendered in a fallback face — or an unhandled `ENOENT` on the image
   * route — discovered when somebody pastes a link into Slack and the unfurl
   * has already been cached wrong.
   *
   * Both image routes are listed. They import the same module, but the key is
   * matched against the route that owns the bundle, not against the module that
   * does the reading.
   */
  outputFileTracingIncludes: {
    '/opengraph-image': ['./assets/fonts/**'],
    '/w/[shareId]/opengraph-image': ['./assets/fonts/**'],
  },
}

export default nextConfig
