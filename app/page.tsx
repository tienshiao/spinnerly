/**
 * Placeholder landing page. The real one is TASK-22, built from
 * docs/spin-the-wheel-editor/project/Home.dc.html once the design tokens
 * land in TASK-3.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-10">
      <h1 className="text-4xl font-bold tracking-tight">Spinnerly</h1>
      <p className="text-lg text-gray-600">
        Build a wheel, share the link, let the room watch it land.
      </p>
      <p className="text-sm text-gray-500">
        Scaffold only — see TASK-22 for the real landing page.
      </p>
    </main>
  )
}
