/**
 * Placeholder landing page. The real one is TASK-22, built from
 * docs/spin-the-wheel-editor/project/Home.dc.html once the design tokens
 * land in TASK-3.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-10">
      {/* No size, weight or tracking utilities: the base layer already sets
          the heading face and scale, and Caprasimo ships only a 400 weight, so
          `font-bold` would render as a synthesised fake bold. */}
      <h1>Spinnerly</h1>
      <p className="text-lg text-neutral-700">
        Build a wheel, share the link, let the room watch it land.
      </p>
      {/* neutral-700, not -600: #7d7a8c on this ground is 3.88:1, under AA. */}
      <p className="text-sm text-neutral-700">
        Scaffold only — see TASK-22 for the real landing page.
      </p>
    </main>
  )
}
