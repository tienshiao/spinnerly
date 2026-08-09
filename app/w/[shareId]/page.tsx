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

  /**
   * Keyed on `shareId`, which is a correctness point rather than a hint.
   *
   * Duplicating a wheel navigates with `router.push` inside this same route
   * segment, so without a key React keeps the component instance and every
   * piece of local state in it — and `copyableOptions` in lib/wheels/store.ts
   * **preserves option ids** through a fork, so the Picked badges from the
   * source wheel would land on the copy's identical ids. The rotation, the
   * notice strip and the preview toggle are facts about the wheel that was left
   * behind in exactly the same way.
   *
   * `useWheelSession` still resets its own pending entries on a `shareId`
   * change, and should: it is a hook, and it cannot assume its caller was
   * remounted.
   */
  return <WheelPage key={shareId} shareId={shareId} />
}
