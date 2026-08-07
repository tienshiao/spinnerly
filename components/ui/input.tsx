import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/utils'

/**
 * Retuned to Organic's `.input` rule: a 36px surface-filled pill on a divider
 * hairline, with the accent as the caret.
 *
 * As with Button, `outline-none` and shadcn's 3px focus ring are both dropped
 * so the global `:focus-visible` outline is the single focus indicator. The one
 * exception Organic asks for is `focus-visible:outline-offset-0` — the ring
 * sits flush against the border here rather than 2px clear of it, because on a
 * fully rounded field an offset ring reads as a second, detached outline.
 *
 * The `dark:` variants shadcn ships with are removed rather than left inert:
 * this design has no dark mode, and the variant rebinding in shadcn-tokens.css
 * already neutralises them, so keeping them would only mislead.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'rounded-pill border-input bg-surface min-h-9 w-full min-w-0 border',
        'text-foreground caret-accent px-3.5 py-1.5 text-sm transition-colors',
        'placeholder:text-muted-foreground',
        'hover:border-[color-mix(in_srgb,var(--color-text)_45%,transparent)]',
        'focus-visible:border-accent focus-visible:outline-offset-0',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        'aria-invalid:border-destructive',
        'file:text-foreground file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
