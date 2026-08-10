'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Ellipsis, Eye, PenLine } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WheelMark } from '@/components/wheel/disc'
import { copyText } from '@/lib/clipboard'
import type { WheelRole } from '@/lib/wheels/use-wheel-session'

import { WheelTitle } from './wheel-title'

/**
 * The page header. Ported from the prototype, with the two additions design doc
 * decision 16 makes this task's responsibility: the title is edited inline here
 * rather than in a settings panel, and an overflow menu holds Duplicate.
 *
 * What is deliberately NOT here is the `suggestionsOpen` kill switch. Design doc
 * section 7 puts it in the Suggestions panel header (TASK-19) because it is the
 * one control an editor reaches for while a wheel is actively being spammed, and
 * two clicks behind an overflow icon is the wrong place for that.
 */

/** How long the copy button stays on its confirmation before reverting. */
const COPIED_LABEL_MS = 2000

export type WheelHeaderProps = {
  title: string
  /** What the page is currently rendering as — preview included. */
  role: WheelRole
  /** Whether this browser actually holds a verified token, preview aside. */
  isEditor: boolean
  previewing: boolean
  onTogglePreview: () => void
  /** A spin is in flight, which is the one time previewing is refused. */
  spinning: boolean
  savingTitle: boolean
  /** This tab just made this wheel, so the title opens ready to be named. */
  titleStartsInEdit?: boolean
  onRename: (title: string) => Promise<void>
  onDuplicate: () => void
  duplicating: boolean
  /** The SHARE url — no fragment. See `CopyLinkButton`. */
  shareUrl: string
  onError: (message: string) => void
}

export function WheelHeader({
  title,
  role,
  isEditor,
  previewing,
  onTogglePreview,
  spinning,
  savingTitle,
  titleStartsInEdit,
  onRename,
  onDuplicate,
  duplicating,
  shareUrl,
  onError,
}: WheelHeaderProps) {
  return (
    <header className="border-divider relative flex flex-wrap items-center justify-between gap-5 border-b px-5 py-[22px] sm:px-10">
      <div className="flex min-w-0 flex-wrap items-center gap-3.5">
        <Link href="/" aria-label="Spinnerly home" className="flex-none">
          <WheelMark className="size-[38px]" />
        </Link>

        <div className="flex min-w-0 flex-col">
          <WheelTitle
            title={title}
            // Preview is a view of the page, not a change of rights: the token
            // is still held and still valid. Editing is suppressed because
            // that is what previewing means, not because anything was lost.
            editable={isEditor && !previewing}
            saving={savingTitle}
            startEditing={titleStartsInEdit}
            onRename={onRename}
            onError={onError}
          />
          <span className="px-1 text-[13px] text-neutral-600">Spinnerly</span>
        </div>

        {/* Tinted from the accent ramp for an editor and accent-2 for a viewer,
            which is the same pairing the Suggestions panel uses for the second
            voice — the chip and the panel are describing the same person. */}
        <Badge
          variant={role === 'editor' ? 'default' : 'secondary'}
          className="ml-1.5 px-3 py-[5px] text-xs font-bold tracking-[0.04em] uppercase"
        >
          {role === 'editor' ? 'Editor' : 'Viewer'}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {isEditor && (
          /* Disabled for the 4.3 seconds a spin is in flight. The wheel is
             frozen on the snapshot it spun until the result is dismissed, and
             the strip that dismisses it is editor-only — so previewing mid-spin
             would hide the only control that can thaw the wheel and swallow the
             result, which lands behind the preview and is cleared unseen on the
             way back. The page refuses it too; this is what stops it being a
             button that looks live and does nothing. */
          <Button
            variant="secondary"
            onClick={onTogglePreview}
            disabled={spinning}
            aria-pressed={previewing}
          >
            {previewing ? <PenLine /> : <Eye />}
            {previewing ? 'Back to editing' : 'Preview as viewer'}
          </Button>
        )}

        <CopyLinkButton shareUrl={shareUrl} onError={onError} />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="secondary"
                size="icon"
                aria-label="More wheel actions"
              >
                <Ellipsis />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {/* Open to both roles, and deliberately. Decision 5 makes duplicate
                unauthenticated: it is the escape hatch for a wheel whose editor
                has vanished, so gating it behind being an editor would remove
                it from exactly the person who needs it. */}
            <DropdownMenuItem onClick={onDuplicate} disabled={duplicating}>
              {duplicating ? 'Duplicating…' : 'Duplicate wheel'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

/**
 * Copies the SHARE url, for both roles, and says so on the label.
 *
 * An editor's own address bar holds `#e={editToken}`, and a button here that
 * copied "the current URL" would hand that token to whoever the link was sent
 * to — silently promoting every recipient to an editor of a wheel they were
 * only meant to see. The URL is passed in already stripped rather than read
 * from `location` here, so there is no version of this component that could
 * copy the fragment by accident.
 *
 * The confirmation is the button's own label rather than a toast. Toasts are
 * TASK-20, and a control whose whole job is to confirm one thing can confirm it
 * itself.
 */
function CopyLinkButton({
  shareUrl,
  onError,
}: {
  shareUrl: string
  onError: (message: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * The revert is two seconds out, which is comfortably longer than it takes to
   * leave this page — Duplicate pushes a new route the moment its response
   * lands, remounting the segment. A callback arriving after that would set
   * state on a tree that has gone.
   */
  useEffect(() => {
    return () => {
      if (revertTimer.current !== null) clearTimeout(revertTimer.current)
    }
  }, [])

  async function copy() {
    try {
      /**
       * `copyText` rather than `navigator.clipboard` directly, because the
       * clipboard API is absent outside a secure context — a plain-http preview
       * build, or an IP address in a browser tab — and this is the one button
       * the whole product depends on. See lib/clipboard.ts: it falls back to
       * `execCommand`, and it refuses to report success it did not have.
       */
      await copyText(shareUrl)

      // Restarted, not stacked. Without the clear, a second click at 1.9s still
      // reverts on the FIRST click's timer 100ms later — so the click that was
      // meant to be confirmed is the one whose confirmation flashes past.
      if (revertTimer.current !== null) clearTimeout(revertTimer.current)

      setCopied(true)
      revertTimer.current = setTimeout(() => {
        revertTimer.current = null
        setCopied(false)
      }, COPIED_LABEL_MS)
    } catch {
      // The URL goes in the message so the failure still ends with the user
      // holding the link, which is what they asked for.
      onError(`Could not reach the clipboard. The link is ${shareUrl}`)
    }
  }

  return (
    <Button onClick={() => void copy()}>
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy share link'}
    </Button>
  )
}
