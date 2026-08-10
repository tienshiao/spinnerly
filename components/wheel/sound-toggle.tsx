'use client'

import { Volume2Icon, VolumeXIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { setSoundOn, useSoundOn } from '@/lib/sound-preference'
import { cn } from '@/lib/utils'

/**
 * Mute, and unmute. The one control the sound effects need.
 *
 * A toggle BUTTON rather than a switch, and labelled for its state rather than
 * for the action: `aria-pressed` is what tells a screen reader that this is a
 * two-state control and which state it is in, and a label that changed to
 * "Unmute" as well would say the same thing twice and disagree about tense
 * while doing it.
 *
 * It draws from the store rather than from a prop, so that the icon cannot
 * disagree with what components/wheel/sounds.ts is obeying — and so that a
 * second tab muting the wheel is reflected here without anything being passed
 * anywhere. Where it sits on the page is the caller's business; `className` is
 * how it gets there.
 */
export function SoundToggle({ className }: { className?: string }) {
  const soundOn = useSoundOn()

  return (
    <Button
      variant="ghost"
      // The full 36px square rather than the 28px one, and a 20px glyph inside
      // it. This sits in a corner on its own with nothing to be measured
      // against, so the small size read as an artefact rather than a control —
      // and 36px is also the smallest square that is a comfortable touch target.
      size="icon"
      aria-label="Sound effects"
      aria-pressed={soundOn}
      title={soundOn ? 'Mute the wheel' : 'Unmute the wheel'}
      onClick={() => {
        setSoundOn(!soundOn)
      }}
      className={cn('text-neutral-600', className)}
    >
      {/* The size goes ON THE ICON, not on the button as `[&_svg]:size-5`.
          Button's own rule is `[&_svg:not([class*='size-'])]:size-4`, whose
          `:not()` makes it the more specific of the two — so a size written at
          the button level loses to it silently and the glyph stays 16px. The
          `:not` is there precisely so that a class here takes over. */}
      {soundOn ? (
        <Volume2Icon className="size-5" />
      ) : (
        <VolumeXIcon className="size-5" />
      )}
    </Button>
  )
}
