import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn, type StringClassName } from '@/lib/utils'

/**
 * Retuned to Organic's `.btn` rule. Three changes from the shadcn default are
 * load-bearing rather than cosmetic:
 *
 *  - `outline-none` is gone. shadcn suppresses the native outline and draws
 *    its own focus indicator with a 3px ring; this project's focus indicator
 *    is a global `:focus-visible` outline in globals.css. Keeping `outline-none`
 *    while dropping shadcn's ring would leave the button with no keyboard focus
 *    indicator at all, so both go together.
 *  - `font-medium` is gone in favour of `font-heading`. Organic sets buttons in
 *    the display face, and Caprasimo ships only weight 400 — `font-medium`
 *    would ask the browser to synthesise a fake bold.
 *  - `rounded-pill`, not `rounded-lg`. Organic's rounded-frame override puts
 *    every small control at a full pill.
 */
const buttonVariants = cva(
  [
    'group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5',
    'rounded-pill border border-transparent bg-clip-padding whitespace-nowrap select-none',
    'font-heading text-sm leading-[1.2] font-normal transition-all',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
    'aria-invalid:border-destructive',
    '[&_svg]:pointer-events-none [&_svg]:block [&_svg]:shrink-0',
    "[&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        // .btn-primary — accent fill, page ground as the label, one ramp step
        // down on hover and two on press.
        default:
          'bg-primary text-primary-foreground hover:bg-accent-600 active:bg-accent-700',
        // .btn-secondary — no fill, divider hairline, ink tint on interaction.
        secondary:
          'border-border text-foreground hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] active:bg-[color-mix(in_srgb,var(--color-text)_14%,transparent)]',
        // .btn-ghost — accent label and accent tint. Its tighter inline padding
        // is a compoundVariant below, not part of this string.
        ghost:
          'text-accent-700 hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] active:bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)]',
        // Organic has no destructive button. Built from the deep accent step
        // so it stays in-palette; see the note in shadcn-tokens.css.
        destructive:
          'bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] text-destructive hover:bg-[color-mix(in_srgb,var(--destructive)_18%,transparent)]',
        link: 'text-accent-700 underline-offset-3 hover:text-accent hover:underline',
      },
      size: {
        // Organic's `--space-2 calc(--space-3 * 1.2)`, kept as tokens so the
        // scale stays the source of truth.
        default: 'px-[calc(var(--space-3)*1.2)] py-(--space-2)',
        sm: 'px-(--space-3) py-(--space-1) text-xs',
        lg: 'px-(--space-6) py-(--space-3) text-base',
        // .btn-icon — a fixed 36px square with no padding.
        icon: 'size-9 p-0',
        'icon-sm': "size-7 p-0 [&_svg:not([class*='size-'])]:size-3.5",
      },
      // .btn-block
      block: {
        true: 'mt-(--space-2) w-full',
      },
    },
    compoundVariants: [
      // Organic's .btn-ghost pulls its inline padding in to --space-1. This has
      // to be a compoundVariant: cva emits every `variants` entry before any
      // compound one, and within `variants` the size group comes after the
      // variant group, so a `px-*` written into the ghost variant is always
      // overridden by the size's own `px-*` and silently does nothing.
      //
      // Scoped to the text sizes on purpose — the icon sizes are fixed squares
      // with `p-0`, and re-adding inline padding would stretch them.
      {
        variant: 'ghost',
        size: ['default', 'sm', 'lg'],
        class: 'px-(--space-1)',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  block,
  ...props
}: StringClassName<ButtonPrimitive.Props> &
  VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, block, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
