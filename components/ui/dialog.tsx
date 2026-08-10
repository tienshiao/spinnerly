'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { cn, type StringClassName } from '@/lib/utils'
import { useInertPopup } from '@/lib/base-ui-inert'
import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

/**
 * Retuned to Organic's `.dialog` rules. Beyond colour, three substantive
 * changes from the shadcn default:
 *
 *  - `rounded-xl` and `rounded-b-xl` become `rounded-container` /
 *    `rounded-b-container`. The xl step does not exist in this theme, so the
 *    originals would have rendered a square-cornered panel.
 *  - The footer loses shadcn's inset muted bar (negative margins, top border,
 *    tinted ground) for Organic's `.dialog-actions`, which is a plain
 *    right-aligned row on the panel surface.
 *  - `DialogFooter`'s close button was `variant="outline"`, a variant this
 *    project's Button no longer defines; it is `secondary`, which is the
 *    Organic equivalent.
 *
 * `outline-none` is kept on the popup itself — unlike Button and Input, this
 * element is focused programmatically when the dialog opens, and a visible
 * ring around the whole panel is not the intent. Focus indication inside the
 * dialog still comes from the global `:focus-visible` rule.
 */

/**
 * Carries what DialogContent needs to drive the background-inert workaround and
 * cannot read off the DOM — see lib/base-ui-inert.ts.
 *
 *  - `modal`, because the marker Base UI stamps is not a modality signal.
 *  - `open`, so the inert is released when the dialog closes rather than when
 *    the popup finally unmounts after its exit animation.
 *  - `triggerRef`, so the focus-restore fallback has a definite element to
 *    return to. Querying `[data-slot="dialog-trigger"]` would pick the wrong
 *    one as soon as a page has two dialogs.
 */
const DialogStateContext = React.createContext<{
  modal: DialogPrimitive.Root.Props['modal']
  open: boolean
  triggerRef: React.RefObject<HTMLElement | null>
}>({ modal: true, open: false, triggerRef: { current: null } })

function Dialog({
  modal = true,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: DialogPrimitive.Root.Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(
    defaultOpen ?? false,
  )
  const isOpen = open ?? uncontrolledOpen
  const triggerRef = React.useRef<HTMLElement | null>(null)

  const handleOpenChange = React.useCallback<
    NonNullable<DialogPrimitive.Root.Props['onOpenChange']>
  >(
    (next, details) => {
      setUncontrolledOpen(next)
      onOpenChange?.(next, details)
    },
    [onOpenChange],
  )

  const state = React.useMemo(
    () => ({ modal, open: isOpen, triggerRef }),
    [modal, isOpen],
  )

  return (
    <DialogStateContext.Provider value={state}>
      <DialogPrimitive.Root
        data-slot="dialog"
        modal={modal}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DialogStateContext.Provider>
  )
}

function DialogTrigger({ ref, ...props }: DialogPrimitive.Trigger.Props) {
  const { triggerRef } = React.useContext(DialogStateContext)

  // Records the trigger for the focus-restore fallback while still honouring a
  // ref the caller passed.
  const attach = React.useCallback(
    (node: HTMLButtonElement | null) => {
      triggerRef.current = node
      if (typeof ref === 'function') return ref(node)
      if (ref) ref.current = node
    },
    [ref, triggerRef],
  )

  return (
    <DialogPrimitive.Trigger
      ref={attach}
      data-slot="dialog-trigger"
      {...props}
    />
  )
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: StringClassName<DialogPrimitive.Backdrop.Props>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 isolate z-50 duration-100',
        // Organic's .dialog-backdrop — the darkest neutral at 50%, not black.
        'bg-[color-mix(in_srgb,var(--color-neutral-900)_50%,transparent)]',
        'supports-backdrop-filter:backdrop-blur-xs',
        'data-open:animate-in data-open:fade-in-0',
        'data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  initialFocus,
  ...props
}: StringClassName<DialogPrimitive.Popup.Props> & {
  showCloseButton?: boolean
}) {
  // Makes the page behind the dialog untabbable, which Base UI does not do on
  // its own. Only for a fully modal dialog — see lib/base-ui-inert.ts.
  const { modal, open, triggerRef } = React.useContext(DialogStateContext)
  const { popupRef, attachPopup } = useInertPopup(
    modal === true && open,
    triggerRef,
  )

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={attachPopup}
        // Pin initial focus to the popup rather than relying on the default.
        // Base UI's default is the first tabbable element inside, which is
        // fine, but focusing the container is the conventional modal behaviour:
        // the dialog is announced on open, and the first Tab lands on the first
        // control rather than skipping past it. Callers can override.
        initialFocus={initialFocus ?? popupRef}
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid -translate-x-1/2 -translate-y-1/2',
          // .dialog — width min(440px, 100%), surface fill, top elevation.
          'w-[min(440px,calc(100%-2rem))] gap-(--space-3) p-(--space-4)',
          'rounded-container bg-surface text-foreground text-sm shadow-lg',
          'duration-100 outline-none',
          'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
          'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-(--space-2)', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      // .dialog-actions
      className={cn(
        'mt-(--space-2) flex flex-col-reverse gap-(--space-2)',
        'sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="secondary" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: StringClassName<DialogPrimitive.Title.Props>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // .dialog-title — the display face at 20px, not a bolded body face.
      className={cn(
        'font-heading text-h4 leading-tight font-normal',
        className,
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: StringClassName<DialogPrimitive.Description.Props>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-muted-foreground text-sm',
        '*:[a]:hover:text-accent *:[a]:underline *:[a]:underline-offset-3',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
