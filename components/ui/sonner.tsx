'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

/**
 * Retuned to the prototype's toast: an accent-900 pill with an accent-100
 * label at the top elevation.
 *
 * Two fixes to what shadcn generates:
 *
 *  - It read the active theme from `next-themes` and passed it through, but
 *    this app mounts no ThemeProvider, so `useTheme()` returns "system" and
 *    Sonner would render dark toasts for anyone whose OS prefers dark — on a
 *    page that has no dark mode. Pinned to "light" instead, which is the only
 *    theme this design has.
 *  - `--border-radius` pointed at `var(--radius)`, a variable this project
 *    never defines: shadcn's radius indirection is deliberately not adopted
 *    (see shadcn-tokens.css), so the toast would have fallen back to Sonner's
 *    own default rather than the pill the design calls for.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--color-accent-900)',
          '--normal-text': 'var(--color-accent-100)',
          '--normal-border': 'transparent',
          '--border-radius': 'var(--radius-pill)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'font-body text-sm shadow-lg',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
