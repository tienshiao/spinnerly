---
id: TASK-35
title: 'Fix cold-start tick loss: the monitor''s audio path eats the opening ticks'
status: In Progress
assignee: []
created_date: '2026-08-10 03:57'
updated_date: '2026-08-10 07:37'
labels:
  - bug
  - frontend
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reported after TASK-34: when the audio path is cold, a spin's ticks are partly or wholly inaudible while the win flourish 4.4s later always plays. A spin immediately after another spin ticks fine as long as the tab's speaker icon is still lit.

Investigated 2026-08-09 with live instrumentation in Chrome (see conversation; harness kept at public/audio-lab.html):

- On context creation with user activation, the audio clock advances at 1x within ~22ms and outputLatency reports a constant 16ms from the first sample. Chrome renders the scheduled tick train in real time from the start and exposes NO signal about the physical sink's state.
- Through 38s of silence the context stays running, clock at 1x, outputLatency unchanged: there is no Chrome-level stream idle to detect or resume from.
- The default output device is an LG monitor over DisplayPort. DP/HDMI sinks hard-mute after silence and take ~0.5-2s to unmute when signal returns. Samples rendered during the unmute window are consumed on schedule and physically discarded — which is exactly ticks-lost-then-flourish-fine, and 'no ticks at all' when the unmute exceeds the ~3s tick train.
- Why the committed warm() does not fix it: it opens the Chrome/OS stream, which was never the bottleneck; its 400ms prime peaks at about -52 dBFS, deliberately below Chrome's tab-audible threshold and almost certainly below the monitor's unmute level gate, so the monitor never wakes. PRIME_S=400ms is also shorter than a typical DP unmute, and IDLE_SLEEP_S=1s models a sleep that is not Chrome's.

Proposed fix (validate by ear with public/audio-lab.html first, since the monitor's threshold is not observable from code):
1. Replace the near-silent noise prime with a low-frequency tone (~40Hz) at a level well above any sink's level gate (~ -26 dBFS): electrically loud, psychoacoustically negligible on monitor/laptop speakers.
2. Prime earlier and longer: warm on the first pointerdown/keydown anywhere on the page (document-level, once activation exists) and on pointerenter of the wheel section, not only the button; hold the prime for several seconds and refresh while hover persists, rather than a single 400ms burst.
3. Keep the tone running underneath the whole spin so the sink cannot re-gate mid-train, and let it linger ~30s after the last sound so the result-modal -> spin-again cycle stays hot.
4. Watch Chrome's tab-audible icon when tuning: the prime level ideally stays under Chrome's audibility threshold while over the monitor's gate; if the two overlap, decide which to sacrifice.

Delete public/audio-lab.html when the fix lands.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the monitor audio asleep (speaker icon off >10s), the first spin's opening ticks are audible
- [x] #2 The spin opens with the whoosh at flourish-comparable level (measured -9 dBFS peak via OfflineAudioContext), and sounds.test.ts asserts it precedes the first click, sustains >=0.3s, and is driven above the filter's cut
- [x] #3 Mute suppresses the whoosh along with everything else (spin schedules nothing while muted)
- [x] #4 warm() and its wiring are fully removed: SoundSink, use-spin, the button handlers, and the warming-up test suite
- [x] #5 npm test, typecheck, and lint pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Revised diagnosis after listening tests (2026-08-09): the monitor's audio path is a level/noise gate, not a slow unmute. The flourish plays cold (sustained tonal energy opens the gate); 22ms tick bursts never integrate enough level to open it; a continuous 40Hz keep-alive at -26 dBFS does not open it either (small-speaker DSPs high-pass before the level detector); everything works on MacBook speakers. No inaudible prime can work — quiet enough not to hear is below the gate threshold by construction.

Plan:
1. Remove the warm() machinery: SoundSink.warm, PRIME_S, IDLE_SLEEP_S, everActivated, quietFrom in sounds.ts; SpinState.warm in use-spin.ts; the four handlers on the spin button in wheel-page.tsx; the 'warming up' test suite and warm mocks.
2. Add a spin-up whoosh at the head of spin(): a rising bandpass noise sweep (~0.45s) at flourish-comparable level. It opens the gate audibly and by design; the tick train follows inside the gate's release window (proved seconds long by the spin-again observation).
3. Tune the whoosh level by OfflineAudioContext render (house methodology in sounds.ts) to peak near -9 dBFS.
4. Keep public/audio-lab.html with a button mirroring the shipped whoosh for by-ear validation on the gated monitor; delete the page when validated.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
warm() investigation closed: Chrome stream opens in 22ms, no Chrome-level idle exists, and the monitor gate ignores sub-audible primes. Decision with user: remove warm entirely, add audible spin-up whoosh.

Implemented: warm machinery removed everywhere; scheduleWhoosh added to spin() (300->1500Hz bandpass noise sweep, 40ms attack, 250ms hold, 500ms total, gain 2.0 = -8.8 dBFS peak measured offline). audio-lab.html button 6 mirrors the shipped whoosh for the by-ear cold test on the gated monitor. 958 unit tests, typecheck, lint all pass. Work staged, not committed. AC1 awaits the user's listening test.

Code-review follow-ups applied (2026-08-10): the outputLatency addend was removed from the schedule lead-in — the spec honours any start(t) at or after currentTime, and outputLatency delays all audio uniformly, so adding it doubled the audio/visual offset on high-latency outputs (Bluetooth); leadIn() is gone and SCHEDULE_LEAD_S alone is the margin, with the comment rewritten and a regression test replacing the one that pinned the addend. ensure() now closes a context abandoned by a half-built graph (was leaking one per failed retry against the browser's context cap) and attaches a rejection handler to resume(). The listening harness moved from public/audio-lab.html to docs/audio-lab.html so it cannot ship to production and passes format:check; still open it from disk for the by-ear cold test, and still delete it once AC1 is validated. 961 unit tests, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->
