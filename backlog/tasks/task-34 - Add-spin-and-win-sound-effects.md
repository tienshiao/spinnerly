---
id: TASK-34
title: Add spin and win sound effects
status: Done
assignee:
  - '@claude'
created_date: '2026-08-10 02:27'
updated_date: '2026-08-10 03:40'
labels: []
dependencies: []
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wheel has a payoff to look at and nothing to listen to. Two sounds, both synthesised with the Web Audio API rather than shipped as files — no assets to license, host or cache, and the tick can be driven from the same numbers the animation is.

The tick: a short click each time a wedge boundary passes the pointer. Because the spin runs on a 4.3s cubic-bezier(0.16, 0.85, 0.16, 1) coast, boundary crossings are dense at the start and stretch out as the wheel settles — so a schedule computed by inverting that easing slows down exactly with the picture, where a fixed-interval tick would drift away from it within the first second. Scheduled against the audio clock rather than setTimeout, which is what keeps it in step over four seconds.

The win: a short celebratory flourish, landing with the result and the confetti.

The control: a speaker toggle in the lower right of the wheel card. On by default — the sound is only ever the direct consequence of the user's own click on Spin the wheel, never ambient and never on load — and the choice is remembered across visits. Editor-only, because decision 13 keeps the spin in the spinning browser in v1, so a participant has nothing to mute.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A tick fires as each wedge boundary passes the pointer, so the ticks slow with the wheel rather than running on a fixed interval
- [x] #2 A celebratory sound plays with the result
- [x] #3 Sound is on by default, can be muted from a control in the lower right of the wheel card, and the choice survives a reload
- [x] #4 Muting schedules nothing, and no AudioContext is created before the first spin — so no browser autoplay warning and no audio graph on a page nobody spins
- [x] #5 prefers-reduced-motion suppresses the ticks, since there is no rotation for them to track, and keeps the win sound
- [x] #6 Leaving the page mid-spin cancels whatever is still scheduled rather than letting it play out
- [x] #7 No audio files are added to the repository
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. components/wheel/tick-schedule.ts — pure arithmetic: invert the spin easing to turn the rotation the wheel is about to travel into the times each wedge boundary passes the pointer. No DOM, no audio, testable under npm test like geometry.ts.
2. lib/sound-preference.ts — the mute flag over localStorage, exposed as an external store so the toggle and the audio layer read one source. useSyncExternalStore with a server snapshot of 'on', the same shape as useReducedMotion.
3. components/wheel/sounds.ts — the Web Audio layer. Lazily builds its context on first play, which is inside the spin click; schedules ticks and the win flourish against the audio clock; cancel() stops anything outstanding. Takes its context factory as an argument so a fake can record what was scheduled.
4. components/wheel/use-spin.ts — an optional third argument, alongside pick, for the sound sink. useSpin says what happened; the sink decides whether to make noise.
5. app/w/[shareId]/wheel-page.tsx — the speaker toggle, bottom right of the wheel card, editor-only.
6. Tests: the schedule's slowing and its endpoints, the preference's default and persistence, the audio layer against a fake context (nothing before the first spin, nothing while muted, cancel), the toggle, and the useSpin wiring including reduced motion.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Four new modules and one changed hook:

- components/wheel/tick-schedule.ts — pure. Inverts cubic-bezier(0.16, 0.85, 0.16, 1) by bisection to turn the angles the wheel is about to travel through into click times. Bisection rather than Newton on purpose: both x control points are 0.16, so dx/ds is near zero at the origin and a Newton step divides by it. Caps at 400 ticks and drops them from the START of the spin, where they are a flutter rather than countable clicks.
- lib/sound-preference.ts — the mute flag over localStorage as an external store, so the icon and the audio layer read one value; storage events carry a mute across tabs. On unless stored otherwise, and it survives a localStorage whose GETTER throws, which is what a browser with site data blocked does.
- components/wheel/sounds.ts — Web Audio. Ticks are bandpass-filtered noise bursts whose centre frequency and gain follow the gap before them, so the last few clicks knock lower and softer than the opening flutter; the win is a C-E-G-C triangle arpeggio over about half a second. Everything is scheduled against AudioContext.currentTime rather than setTimeout — a timer-driven tick drifts against a compositor-run animation, and clicks 25ms apart have no drift budget.
- components/wheel/sound-toggle.tsx — toggle button, aria-pressed, stable label.
- use-spin.ts takes an optional sink beside pick. Its rotation now comes from a ref rather than from a functional setState: the schedule needs both the from and the to angle somewhere a side effect is allowed, and a state updater is not that place.

Verified in a real browser against the seeded wheel, with AudioContext patched to record what the page scheduled: exactly one context, built on the spin click and not before; 31 clicks queued up front for a five-option wheel, the first at 26ms and the last at 2.744s (26ms gaps at the start, 727ms at the end — the wheel covers 96% of its travel in the first half of the spin, so the final half-wedge takes a second and a half in near-silence, as a real wheel does); four oscillators at the result. Muting then spinning scheduled nothing further and built no context; the choice survived a reload; the toggle sits 13px from the card's lower-right corner and does not overlap the spin button.

948 tests pass — 16 on the schedule, 13 on the audio layer, 9 on the preference, 5 on the toggle, 6 on the wiring in use-spin. Lint, typecheck, format and build clean.

Follow-up, after the sound turned out to be inaudible on real hardware.

**It was the level, and the level was invisible.** Every node was connected, every source started, and Chrome lit the tab's audio indicator — a graph that is running and a graph that can be heard are not the same claim. Rendering the exact tick graph through an OfflineAudioContext and reading the samples back put a click at -32 dBFS: the bandpass at Q 2.5 was throwing away about 20 dB and nothing compensated for it. A filter's insertion loss is not something that can be read off its parameters, which is why the levels are now measured rather than reasoned about.

Q dropped to 0.9 — a band wider than its own centre frequency, which still reads as a mechanism rather than a tone — and TICK_GAIN raised to 1.2. Above unity on purpose: it is the level BEFORE the filter takes its cut, so anyone who reads it as a volume control and trims it will silence the effect again. WIN_GAIN 0.28 to 0.6.

Measured on the live page by tapping the app's own master gain with an AnalyserNode: ticks now peak at -9.1 dBFS and the flourish at -9.4, against -31.6 and -15.7 before. A whole spin rendered offline peaks at -9 dBFS with nothing clipped. sounds.test.ts gained two cases so this cannot regress silently: the click envelopes must reach above 0.5, and a slow click must be quieter than a fast one.

The toggle is the 36px icon button rather than the 28px one, with a 20px glyph. The size had to go on the ICON: Button's own rule is [&_svg:not([class*='size-'])]:size-4, whose :not() makes it the more specific of the two, so [&_svg]:size-5 written at the button level lost to it silently — measured at 16px in the browser before the fix, 20px after.

Follow-up: the ticks were unreliable — always missing on the first spin after load, intermittently on later ones, while the flourish always played.

Three causes, all found by instrumenting the live page rather than by reading the code, which looked right throughout.

1. **Scheduled inside the buffer the device already had.** `currentTime` is where the audio thread has rendered TO; the frames between there and the speaker are committed and cannot be changed. The first click was 26ms out, which is inside that window on plenty of machines, and the next ones were 25ms apart — so what got dropped was the opening flurry, which is the part that sounds like ticking. The flourish is scheduled four seconds into a running context and was never at risk, which is exactly why it always played. Everything now goes out at `currentTime + 60ms + outputLatency`.

2. **The output device was opening from cold underneath the clicks.** Measured: on a fresh context `outputLatency` reads 0 and only becomes a real number (16ms here) once the stream is actually running. A Bluetooth link takes hundreds of milliseconds to negotiate and swallows whatever plays meanwhile. `SoundSink.warm()` now opens the device and plays 80ms of noise at 1/400th of a click's level — inaudible, and not silence, since some drivers stay asleep until a stream carries signal. The page wires it to the spin button's `pointerdown` and `keydown`, so the wake-up happens in the gap between pressing the button and letting it go. Measured after a press alone: context running, one priming sound, clock already at 0.075.

3. **The clicks were overlapping into a smear.** The wheel leaves the pointer at about eight turns a second, so its first clicks are 25ms apart, and each one was 45ms long — every click still sounding while the next two began. `TICK_DECAY_S` is now 22ms, comfortably inside the tightest gap. `TICK_GAIN` went up with it, 1.2 to 1.9: the overlap had been carrying part of the level, so shortening the envelope alone traded a smear for a whisper.

Measured on a cold page load, three consecutive spins: clicks peak at 0.39 (-8.1 dBFS) and the flourish at 0.343 (-9.3), nothing clipped, energy continuous from 84ms after the click through 2.7s and decaying 0.34 to 0.14 as the wheel slows. Before: clicks intermittently absent.

AC 4 still holds as written — a press on the spin button is the start of a spin, so nothing builds a context on a page whose wheel nobody reaches for, and the gesture is real, so there is no autoplay warning.

Follow-up: warming moved earlier, from the press to the hover.

A press buys only the length of a click; a hover buys seconds. The catch is that neither `pointerenter` nor `focus` grants user activation, and a context built without any is born suspended, logs the autoplay warning, and opens no device — all cost, no head start. Confirmed on the page rather than assumed: a context constructed with `navigator.userActivation.hasBeenActive === false` came back `suspended` and stayed there, clock frozen at 0.

So `warm()` now checks STICKY activation — has this page ever been touched, not is a gesture running — and declines otherwise. That is the exact condition the autoplay policy tests, which is what makes a hover usable at all: a `pointerenter` grants nothing of its own, but on a page where anything has already been clicked, nothing is needed. Missing API, which is Safari, reads as 'assume touched': the cost of guessing wrong that way is a suspended context on a page that was never going to make a sound, where the other way is silence on a browser that would have played.

The button now warms on `pointerEnter`, `focus`, `pointerDown` and `keyDown` — earliest first, with the press as the backstop that always works and the one that covers touch, where there is no hover to have.

Verified in the browser, both branches: a hover on an untouched page builds no context and plays no priming sound; the same hover with activation reported builds one context and schedules one priming sound. Note the event — React derives `onPointerEnter` from `pointerover`, which bubbles, so a synthetic `pointerenter` dispatched at the element never reaches the handler and made the first attempt at this measurement read as a failure.

What could not be exercised end-to-end: Chrome starting the context RUNNING under genuine sticky activation. The automation cannot deliver a trusted gesture to an occluded window. It is documented Chrome behaviour and matches the earlier measurement in this task, where a trusted click produced a context in state 'running'. The design degrades safely if it is ever wrong: a context that comes back suspended is resumed by `ensure()` on the spin click, which is exactly what happened before this change.

Follow-up, from the sharpest bug report in this task: 'I only hear the ticks when Chrome's tab shows the speaker icon. If I wait for it to disappear and then spin, I do not hear ticks. If I spin immediately after a previous spin, while the icon is still showing, I can hear them.'

That indicator is a readable proxy for whether the output stream is live, and it named the defect exactly: warming was latched to once per CONTEXT — `if (primed || !everActivated()) return` — so after the first prime it returned early forever. An idle stream is put back to sleep by the browser, the OS, or a headset dropping to standby, and every spin after the first was paying the wake-up out of its own opening flurry, with nothing left to wake it.

Warming is now once per SILENCE. The sink tracks `quietFrom`, the audio-clock time at which the last thing it scheduled ends, and re-primes whenever the output has been quiet for more than a second. `quietFrom` starts at -Infinity so a context that has never played counts as quiet forever; 0 would have read as 'sound ended exactly now' on a fresh context and suppressed the first warm-up of all.

The prime also grew from an 80ms blip to a 400ms looping buffer. A blip pokes the device and lets go, which is no use if the wake-up is longer than the blip; 400ms holds the stream open across it and covers the usual gap between reaching for a button and pressing it.

Verified in the browser on a real running context — a trusted click finally landed, so this is genuine user activation rather than a stubbed flag. After the output had been quiet for four seconds, a hover re-primed (2 primes to 3); a second hover immediately after did not (still 3), because the device was awake. Both branches, on the real thing.

Code review of both tasks (/code-review). Four findings, all acted on; the reviewer's read was right in each case.

- **Muting mid-spin did not silence the spin.** The only preference check was in `ensure()`, at schedule time, and a spin hands three seconds of clicks to the audio thread up front — so pressing the speaker button a second into a spin silenced the flourish four seconds later and nothing before it. `cancel()` had no production caller at all. `createWheelSounds` now subscribes to the preference when it builds its context (in an event handler, not in the `useState` initialiser, where a subscription would be a side effect during render) and cancels what is in flight when the answer turns to off. Unsubscribed in `dispose`.
- **A partial failure in `ensure()` latched the sink silent for the life of the page.** `context` is assigned before the nodes hanging off it, so a throw from `createGain` left a context with no master; every later call then skipped the build branch and fell out at the master check. The catch now clears both.
- **The 120ms Spin again beat bypassed `togglePreview`'s guard.** For those 120ms `spinning` is false, so a preview was neither refused nor disabled, and the queued spin would start behind the participant view where nothing announces a result. The queued re-spin is now dropped when the preview opens — the newer intention wins, which is better than a control that ignores a click for a tenth of a second.
- **The winner card could paint a frame with an empty title.** Base UI keeps the popup mounted and merely hidden until a PASSIVE effect decides its animations are done, so the commit that empties the label can be painted first — the comment claiming otherwise was wrong. The modal now holds the last label it was given. Via state adjusted during render rather than a ref, which `react-hooks/refs` refuses to let a render read, and rather than an effect, which would be a render behind and flash the PREVIOUS winner every time the card opens. The reviewer also spotted that the backdrop's exit animation is dead code, since Base UI unmounts the portal on the popup's animations and the popup deliberately has none; removed, and the comments corrected.

Both behavioural fixes were mutation-tested — the new cases fail with the fix reverted and pass with it — after the first attempt at the preview case turned out to pass either way, since a spin behind the participant view is invisible from it. It is asserted by trying to LEAVE the preview instead: a running spin refuses that toggle, so a page that returns to the editor is a page where nothing started.

967 tests pass; lint, typecheck, format and build clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The wheel now clicks as it turns and plays a short flourish when it lands, both synthesised — no audio files were added.

The clicks are wedge boundaries passing the pointer, not a metronome: their times come from inverting the spin's own easing, so they crowd into the first second and stretch to nearly three quarters of a second apart by the end, and they cannot drift from the animation because both are the same curve. They are handed to the audio clock in one go, which is what keeps 25ms gaps honest across four seconds on a busy main thread.

Sound is on by default and muted from a speaker button in the lower right of the wheel card, remembered in localStorage and shared across tabs. Muting schedules nothing and builds no AudioContext at all; nor does a page whose wheel nobody spins, which is what keeps the browser's autoplay warning away. prefers-reduced-motion drops the clicks — there is no rotation for them to mark — and keeps the flourish. Leaving the page mid-spin cancels the four seconds of clicks already queued.
<!-- SECTION:FINAL_SUMMARY:END -->
