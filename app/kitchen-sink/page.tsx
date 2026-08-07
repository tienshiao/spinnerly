import { notFound } from 'next/navigation'
import { KitchenSink } from './kitchen-sink'

/**
 * A development-only rendering of every shadcn primitive this project
 * installs, in each variant, size and state — the checkable surface for
 * TASK-4. Not a design artefact; delete it if the primitives ever grow a real
 * documentation page.
 *
 * `notFound()` rather than a `_`-prefixed private folder, because a private
 * folder does not route at all and there would be nothing to open in dev.
 */
export default function KitchenSinkPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <KitchenSink />
}
