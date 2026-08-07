import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Retuned to Organic's `.tag` rule. The variants are Organic's four tag
 * flavours rather than shadcn's semantic set: each is a 100-step ground with
 * the matching 800-step label, which is how the ramps are built to pair.
 *
 * Sized by padding rather than the fixed `h-5` shadcn ships, so the tag grows
 * with its text instead of clipping. `rounded-4xl` becomes `rounded-pill` —
 * the 4xl step does not exist in this theme, so the original would have
 * rendered square corners.
 */
const badgeVariants = cva(
  [
    'group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1',
    'overflow-hidden rounded-pill border border-transparent',
    'px-2.5 py-[3px] text-[11px] tracking-[0.02em] whitespace-nowrap transition-all',
    '[&>svg]:pointer-events-none [&>svg]:size-3!',
  ],
  {
    variants: {
      variant: {
        // .tag-accent
        default: 'bg-accent-100 text-accent-800 [a]:hover:bg-accent-200',
        // .tag-accent-2 — the second voice, not a highlight.
        secondary:
          'bg-accent-2-100 text-accent-2-800 [a]:hover:bg-accent-2-200',
        // .tag-neutral, but on the 200 step rather than Organic's 100.
        // Organic's own neutral-100 (#f9f4ed) sits 1.22:1 against its surface;
        // the Spinnerly override collapses that step to pure #ffffff, which is
        // byte-identical to --color-surface, so a literal port renders an
        // invisible chip on every card, dialog and popover. The 200 step
        // restores roughly the separation Organic intended.
        neutral: 'bg-neutral-200 text-neutral-800 [a]:hover:bg-neutral-300',
        // .tag-outline
        outline:
          'border-accent text-accent-700 [a]:hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]',
        destructive:
          'bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  })
}

export { Badge, badgeVariants }
