---
id: TASK-21
title: Build the create-wheel flow and the share and preview controls
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:39'
updated_date: '2026-08-10 01:42'
labels: []
dependencies:
  - TASK-17
  - TASK-9
priority: high
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
How a wheel comes into existence and how it gets shared.

Create: the landing page call to action posts to /api/wheels and redirects to /w/{shareId}#e={editToken}. Creating a wheel is one click with no account, per the design principles. The edit token must reach the URL fragment and nothing else — do not stash it in a query string en route, and do not log it.

The token is a bearer capability and the edit URL is transferable by design (decision 1). The creator may hand it to a co-organiser and both edit at once. Because there is no account and no recovery path, losing the edit URL means losing edit rights permanently — the UI should make it obvious that this link is the only key, and the duplicate flow is the documented mitigation.

Share: a Copy viewer link button that copies /w/{shareId} with the fragment stripped, and confirms via toast. The prototype copy is Viewer link copied — they can look and suggest, not edit, which is worth keeping because it explains the permission model in one line.

Preview: a toggle that lets an editor see the participant view without opening another browser. Prototype labels are Preview viewer link and Back to editing. This is local UI state, not a role change; the token stays in the fragment throughout.

Duplicate: surface the duplicate action, which is open to anyone with the share URL, not just editors.

Include a clipboard fallback for browsers or contexts where navigator.clipboard is unavailable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The landing call to action creates a wheel and lands the user on the edit URL with the token in the fragment
- [x] #2 The edit token never appears in a query string, a path segment, or a log line at any point in the flow
- [x] #3 Clipboard copy has a working fallback when navigator.clipboard is unavailable
- [x] #4 The viewer preview toggle switches the rendered view without discarding the token
- [x] #5 The UI communicates that the edit link is the only key and cannot be recovered
- [x] #6 The duplicate action is reachable by a participant, not only an editor
- [x] #7 Copy share link copies the share URL with the fragment stripped and confirms on the button itself
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/clipboard.ts — copyText(text), the fallback AC 4 asks for. Today there is none: wheel-header.tsx tests navigator.clipboard and, when it is missing, shows the URL in the notice strip. That is a graceful failure, not a fallback. copyText tries navigator.clipboard.writeText, and on an absent clipboard goes STRAIGHT to a hidden-textarea document.execCommand('copy') without awaiting anything first — an await spends the user gesture, and the gesture is what execCommand is checked against. A rejected writeText still tries the fallback, which may fail for that reason; both exhausted is what raises. Tested in jsdom, which implements neither API, so both are stubbed.

2. lib/wheels/new-wheel.ts — a one-shot per-tab flag, markWheelCreated / consumeWheelCreated, keyed on shareId. sessionStorage rather than a ?new=1 query param: a param rides along in every copy of the address bar and outlives the moment it describes, and this is a fact about THIS tab's history, not about the URL. Guarded for the server render and for a storage that throws (Safari private mode), where the honest answer is 'no banner'.

3. app/create-wheel-button.tsx — the create flow, as a client component. createWheel(), then markWheelCreated(), then router.push('/w/{shareId}#e={editToken}'). Same shape as the duplicate flow in wheel-page.tsx, which already navigates a freshly minted token into a fragment. Takes an optional api for tests, as use-editor-role and use-wheel-session do. In flight it is disabled and says so; a failure renders an inline role=alert beside it, because the landing page has no notice strip to borrow.

4. app/page.tsx — the two 'Make a wheel' buttons (hero and call-to-action band) become that component. 'See a live one' and the nav's 'Open a wheel' stay inert: the first is TASK-22's open question and real scope, and the second has no agreed destination. The file comment saying all four are deliberately inert stops being true and is rewritten rather than left to mislead — a client boundary opens here now, for the two controls that have behaviour.

5. app/w/[shareId]/wheel-header.tsx — CopyLinkButton calls copyText. The confirmation stays the button's own label. AC 3's 'confirms via toast' is amended to match, since a control whose whole job is to confirm one thing can confirm it itself, and toasts stay TASK-20's for the events with no control to land on.

6. app/w/[shareId]/wheel-page.tsx — AC 6, as a one-time banner on a wheel created in this tab, reusing the notice strip. The strip currently holds two sources and dismisses them two different ways through a ternary on failure === null; a third makes that unreadable, so notice becomes a { kind, message } and dismissal switches on the kind. Precedence failure > rejection > created, and created is state rather than a render-time read, so a failure that preempts it does not consume it — dismiss the failure and the banner is still there. A freshly created wheel cannot be a rejected one, so only the first pair can actually collide.

7. Tests. lib/clipboard.test.ts and lib/wheels/new-wheel.test.ts, both jsdom. app/create-wheel-button.test.tsx covers AC 1 and AC 2: the pushed URL is asserted by parsing it — search is empty, the pathname does not contain the token, and the token is only ever after the #. AC 2's 'not in a log line' is asserted by spying on every console method across the whole flow, which is cheap and is the only part of that AC a test can actually hold. Plus in-flight disabling and the failure path. wheel-page.test.tsx gains the banner cases and the clipboard fallback ones.

8. docs/spin-the-wheel-design.md section 2 gains a short 'Creating a wheel' subsection: the create-to-fragment navigation, and why the only-key notice exists where it does.

9. Backlog: AC 3 amended, and a comment on TASK-22 recording that AC 1 and AC 3 there are satisfied by this task, leaving it its genuine remainder — what 'See a live one' resolves to, and the nav button.

10. Verify: npm test, typecheck, lint, format:check, build. Then by hand under npm run dev:emulator, because every test here mocks next/navigation — that the fragment survives a real router.push is the one claim the suite cannot make, and the duplicate flow rests on it too.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered: the create flow, a real clipboard fallback, the edit-key warning, and the two landing buttons wired. Unit suite 865 (up from 829); typecheck, lint, format:check clean; production build succeeds and / is still statically rendered.

- app/create-wheel-button.tsx — POST /api/wheels, then router.push('/w/{shareId}#e={editToken}'). Both 'Make a wheel' buttons on the landing page (hero and call-to-action band) are this component.
- lib/clipboard.ts — copyText, with the execCommand fallback. lib/wheels/new-wheel.ts — the one-shot 'this tab made this wheel' signal.
- app/w/[shareId]/wheel-page.tsx — the edit-key warning, and the notice strip retagged by kind. wheel-header.tsx — the copy button goes through copyText.
- Design doc section 2 gains 'Creating a wheel, and the one moment the token exists'.

Three decisions were put to the user before any code was written, and all three took the recommendation: keep the button-label confirmation and amend the AC rather than pull a toast forward from TASK-20; wire the Make-a-wheel buttons here rather than leaving them to TASK-22; and make the only-key warning a one-time banner on a freshly created wheel.

AC 3 was reworded. It said the copy 'confirms via toast', which contradicted the shipped code — TASK-19 deliberately made the confirmation the button's own label and left toasts to TASK-20. The code was right: a control whose whole job is to confirm one thing can confirm it itself, and toasts belong to the events with no control to land on. Now AC 7, because removing and re-adding reindexed the list; the comments that cite AC numbers were realigned and qualified with 'TASK-21' where the file already uses bare 'AC n' for its own task.

Decisions worth knowing about:

- ONE-SHOT SIGNAL, NOT A QUERY PARAMETER. Whether to warn is a fact about this tab's history, not about the wheel, and a ?new=1 would ride along in every copy of the URL — announcing 'just created' to a co-organiser opening the edit link a week later. It also keeps the URL exactly what design doc section 2 says it is. sessionStorage, spent on arrival, so the warning is a moment rather than a fixture the reader learns to skip.

- THE READ IS A useState INITIALIZER, NOT AN EFFECT, and lint decided it: react-hooks/set-state-in-effect fails the effect version, correctly — the value is available to the first render, so spending a second render to reach it is a cascade. That put a browser-storage read into render, which needed two things to be safe. consumeWheelCreated is idempotent, because React double-invokes initializers in development and a second call that went back to an emptied slot would answer differently from the first. And nothing it affects renders before hydration is over: the notice strip is behind both of the page's gates, and both wait on something asynchronous. This was the one place where an inline eslint-disable was tempting; the repo has none anywhere, and restructuring turned out to be the better answer rather than the polite one.

- THE FALLBACK MUST NOT BE AWAITED INTO. Both clipboard routes are gesture-gated — the browser asks whether it is still inside the task the click started — so an await before execCommand spends the gesture and the fallback fails for a reason unrelated to the clipboard. Hence the missing-clipboard case jumps straight there rather than going through a rejected write. A rejected writeText still tries it, since that rejection is a denied permission which execCommand does not consult; it may fail for the gesture reason, and a fallback that sometimes works still beats one that never runs.

- CREATED IS STATE, WHICH IS WHAT MAKES THE PRECEDENCE SAFE. Failure outranks the warning, but must not consume it: the failure most likely to appear on this page is the copy button refusing, and the warning is about the link they were trying to copy. Dismiss the failure and the warning is still there. The strip's dismissal also stopped being a ternary on 'failure === null' and became a switch on the notice's kind, which is what a third source made necessary.

- THE BUTTON STAYS DISABLED AFTER A SUCCESSFUL RESPONSE. The request finishing is not the click finishing, and a button that springs back for the frames before the navigation invites a second create — whose cost is not a duplicate request but an ORPHANED WHEEL, because the first token is thrown away by the navigation to the second. A ref guards the same thing against a double-click too fast for the disabled attribute to have rendered.

Verification beyond the suite:

- Driven by hand in Chrome against the emulator, because every test here mocks next/navigation and 'the fragment survives a real router.push' is the one claim the suite cannot make — the duplicate flow rests on it too. Clicking 'Make a wheel' landed on /w/{id}#e={token} with an empty search, the Editor badge resolved from the fragment, and the warning appeared. A reload cleared it and the page stayed an editor. 
- AC 2 checked against real logs rather than only the console spies: zero occurrences of the token in the Next dev log or firestore-debug.log, and the request lines carry the shareId alone (GET /w/{id}, POST /api/wheels, GET /api/wheels/{id}/editor). The token does travel in the Authorization header on the editor check, which is design doc section 6 and is not logged.
- One test was found to be asserting nothing and fixed: the selection-restore case passed just as happily with the restore disabled, because jsdom's select() leaves document.getSelection() alone. The stub now clears the selection at the point a browser would, and the case fails when the restore is removed. Verified in both directions.

Not in scope, and stated so the reviewer does not look for it: 'See a live one' and the nav's 'Open a wheel' are still inert. Both are TASK-22's, which now holds one real question — what a demo wheel is, given it needs an owner, a mutation policy and something to reset it.

Post-review pass, after the notes above were written. Six findings from /code-review, all fixed here rather than filed, plus four changes the user asked for on the shipped result. Unit suite now 878 (from 865); typecheck, lint, format:check and the production build clean, and / is still statically rendered.

TWO NOTES ABOVE ARE NOW SUPERSEDED, and both were load-bearing enough to be worth correcting rather than leaving for a reader to trip over:

- "THE READ IS A useState INITIALIZER" no longer describes the code. The initializer ran on the FIRST render, which is the loading render — before either gate has opened. A first snapshot that then 404'd or errored rendered the standalone error page instead, and the reload that succeeded found an empty storage slot: no warning, on the one page whose URL is the only key to the wheel, for the person who had just created it. The read now happens below every gate, on the render that actually draws the strip, as a plain call rather than a hook — which is legal there precisely because it is no longer a hook. The argument against an effect still stands; it just is not what decided the shape.
- "CREATED IS STATE, WHICH IS WHAT MAKES THE PRECEDENCE SAFE" is right about the requirement and wrong about the mechanism. What keeps a failure from consuming the warning is the per-share-ID memo in lib/wheels/new-wheel.ts, not React state — every later render gets the remembered answer instead of re-spending the slot.

The findings:

- THE DUPLICATE FLOW NEVER MARKED ITS FORK. A fork's token is minted exactly once too, so a participant duplicating an orphaned wheel landed as its only editor with nothing having warned them. Same one-line call the create flow makes.
- THE ONE-SHOT FLAG WAS SPENT ON A RENDER THAT COULD NOT SHOW IT. See above.
- consumeWheelCreated CACHED ON THE SERVER. It runs during the SSR of a client component, where storage() is always undefined, so every request added an entry to a module-level Map that nothing bounds or clears — one per distinct share ID ever requested, for the life of the process. It now returns before caching when there is no storage; the answer is false by construction there, so idempotence holds without the map.
- A TRAILING .catch ALSO CATCHES THE SUCCESS HANDLER. A throw out of router.push would have re-enabled the button under "That wheel could not be made" when the wheel was in fact made and its only token had just unwound with the closure — the next click orphaning it. Both create and duplicate now pass the rejection handler as then's second argument, so it can only see what the request rejected with.
- THE IN-FLIGHT GUARD WAS PER-BUTTON, NOT PER-PAGE. The landing page renders two of these, the old page stays interactive through an App Router transition, and api-client budgets 1-2s for a cold-start first write. CreateWheelProvider now holds one claim for both; a button with no provider falls back to its own, so a lone call site still works. pending is shared, failure stays local.
- THE CLIPBOARD FALLBACK DID NOT RESTORE FOCUS. It restored the selection but not the focused element, so a keyboard user on exactly the insecure-context build the fallback exists for was returned to the top of the document. Focus is restored before the selection, because focus() collapses the selection in some engines.

Then four changes on the shipped result:

- AN EMPTY WHEEL DRAWS AS ONE BLANK SLICE. It was a neutral-100 disc inside a white rim under a drop shadow, which reads as a component that failed to load rather than as a wheel waiting for its first option - and that is the state every new wheel opens in. wedgePath(0, 0) is the same full disc a one-option wheel gets, since segmentAngle floors the count at 1. That guard is now load-bearing rather than defensive, and its comment says so.
- THE HEADER MOVED ON THE PREVIEW TOGGLE. WheelTitle rendered the editable state as a padded button and the read-only state as a bare span, so flipping editable took 4px off the title's width and 4px off its height. The title column is the tallest thing in the header's left group, so the whole header changed height. It also broke the alignment of the "Spinnerly" line below, which carries its own px-1 to sit flush with title text it only matched in one of the two states.
- "OPTION", NOT "SPOT". The prototype's word, carried into this task's and TASK-18/19's descriptions. It reads as a lunch venue and narrows the product to the one use case the mockup happens to show, while the landing page sells the general tool. Both placeholders were already contradicting their own aria-labels, which said "option" all along. Recorded in design doc section 8 so the next prototype port does not reintroduce it. The TASK-18 and TASK-19 descriptions still quote the old strings.
- THE TITLE OPENS FOCUSED ON ARRIVAL. A wheel arrives called "Untitled wheel" and naming it is what its creator came here to do, so the field opens with the title selected instead of waiting to be found behind a hover state that says nothing on a touch screen. Driven by the same created signal as the warning, read once as initial state so a dismissal is final. The blur this adds to every new wheel is a no-op: commit() returns early when the title is unchanged, so there is no rename nobody made and no expiry slide from one.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-08-07 08:52
---
Decision 16: the header controls this task builds now include an overflow menu alongside the copy-link and preview-toggle buttons. It holds Duplicate wheel (TASK-13). The suggestionsOpen toggle is NOT here; it lives in the Suggestions panel.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the create-wheel flow: the landing page's two 'Make a wheel' buttons post to /api/wheels and navigate to /w/{shareId}#e={editToken}, with the token reaching the fragment and nothing else. Added a real clipboard fallback behind the copy button, and a one-time warning on a freshly created wheel that the edit URL is the only key and cannot be recovered. The title now opens as a focused field on arrival, so naming the wheel is the opening move rather than a discovery. The preview toggle and participant-reachable duplicate were already in place from TASK-17 and TASK-19 and are covered by existing tests.

Verified with the unit suite at 878 (up from 829), typecheck, lint, format:check and a production build, plus a hand-driven pass in Chrome against the emulator - because every test here mocks next/navigation, and that the fragment survives a real router.push is the one claim the suite cannot make. AC 2 was additionally checked against real server logs, which carry the shareId alone.

Six review findings were fixed rather than filed, four of them about the same thing from different directions: a token that exists exactly once must not be dropped. The duplicate flow was not marking its fork; the one-shot creation flag was being spent on a render that could not display it, losing the warning whenever a first snapshot failed; a trailing .catch was catching its own success handler, so a throw after a successful create reported failure and invited a second one; and the in-flight guard was per-button on a page that renders two, so both could post and orphan the first wheel's token. Also fixed: an unbounded module Map that grew once per share ID on every server render, and a clipboard fallback that restored the selection but not the focus.

Three changes to the shipped result, all user-asked: an empty wheel draws as a single blank slice rather than a white disc that reads as a failed load; the title keeps the same box in both roles, which is what was moving the whole header on the preview toggle; and the wheel pages say 'option' rather than 'spot', matching WheelOption, the API and the landing page - the placeholders had been contradicting their own aria-labels since they were written.

AC 3 was reworded, with the user's agreement, from 'confirms via toast' to 'confirms on the button itself': the code TASK-19 shipped was right, and toasts stay TASK-20's for the events with no control to land on.
<!-- SECTION:FINAL_SUMMARY:END -->
