import { WheelPage } from './wheel-page'

/**
 * `/w/{shareId}` — the wheel, for both roles.
 *
 * A server component that renders one client component and nothing else, and
 * the split is load-bearing rather than habit. This half stays on the server so
 * TASK-23 can hang Open Graph metadata off it — an unfurled share link is how
 * most people meet a wheel, and metadata generated in the browser arrives long
 * after Slack has stopped reading.
 *
 * The other half cannot be here. Role comes from the edit token in the URL
 * fragment (design doc section 2), which browsers never send to a server, so
 * every decision that depends on it happens in ./wheel-page.tsx after mount.
 * Nothing role-dependent may move up into this file: it would be rendered for
 * the wrong role and then corrected, which is the flash AC 5 forbids.
 */
export default async function Page({ params }: PageProps<'/w/[shareId]'>) {
  const { shareId } = await params

  return <WheelPage shareId={shareId} />
}
