/**
 * Placeholder wheel page. TASK-17 builds the real shell.
 *
 * Note for whoever picks that up: this page is server-rendered so the OG
 * metadata in TASK-23 can hang off it, but the *editor* view cannot be. The
 * edit token lives in the URL fragment (`#e=...`), which browsers never send to
 * the server, so role resolution has to happen in a client component reading
 * `location.hash` on mount. See design doc section 2.
 */
export default async function WheelPage({ params }: PageProps<'/w/[shareId]'>) {
  const { shareId } = await params

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-10">
      <h1 className="text-3xl font-bold tracking-tight">Wheel</h1>
      <p className="text-gray-600">
        Share ID: <code className="font-mono">{shareId}</code>
      </p>
      <p className="text-sm text-gray-500">
        Scaffold only — see TASK-17 for the real page shell.
      </p>
    </main>
  )
}
