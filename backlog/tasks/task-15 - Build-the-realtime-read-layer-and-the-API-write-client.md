---
id: TASK-15
title: Build the realtime read layer and the API write client
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:38'
updated_date: '2026-08-08 23:10'
labels: []
dependencies:
  - TASK-5
  - TASK-6
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The two halves of the client data path from design doc section 3.

Reads: onSnapshot listeners straight from the browser to Firestore, one on wheels/{shareId} and one on the suggestions subcollection. This is the entire reason the project is on Firestore — live updates with no websocket layer to build. Routing reads through the API too would mean polling or hand-rolled websockets, at which point Firestore buys nothing over Postgres.

Writes: a thin typed client that calls the route handlers and attaches Authorization: Bearer {editToken} when the caller has one.

The expensive part is the optimistic layer. Because writes are routed through an API, the client loses Firestore latency compensation — normally Firestore echoes a write into the local cache before the round trip, so edits feel instant. Here the path is client to API to Firestore to snapshot back. The design doc calls this out as the single most likely why does this feel bad regression. The editor UI must hold optimistic local state, and that state must reconcile cleanly when the real snapshot arrives without flickering or duplicating rows.

Cold starts compound it: the first request after a quiet period stalls a second or two on Vercel, with no always-warm option. Annoying on the first edit specifically. Design the pending state for that, do not assume writes are fast.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A hook exposes the live wheel document and a hook exposes the live suggestions list, both via onSnapshot
- [x] #2 Listeners are torn down on unmount and do not leak across navigations
- [x] #3 A typed write client covers every endpoint and attaches the bearer token when present
- [x] #4 Optimistic entries are keyed so the arriving snapshot replaces the local entry rather than rendering both
- [x] #5 A failed write rolls the optimistic entry back and surfaces the error
- [x] #6 A write that is slow past a threshold shows a pending affordance rather than appearing frozen
- [x] #7 A missing or deleted wheel renders a not-found state rather than hanging
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/model.ts — the shared domain types and ID guards, client-safe: no 'server-only', no firebase-admin. Moves SHARE_ID, isShareId, isSuggestionId, StoredOption and SuggestionStatus out of store.ts and adds Wheel and Suggestion; store.ts re-exports them, so there is still exactly one definition and no existing import changes. The dependency direction is the safe one — a client component that reaches for store.ts by mistake gets server-only's build error rather than a bundled Admin SDK.

2. lib/wheels/snapshot.ts — decode a client-SDK DocumentSnapshot into those types. Deliberately defensive rather than strict: a malformed field yields a fallback and never throws, because a throw inside an onSnapshot callback tears down the listener and the page then stops updating with no error anyone sees. Timestamps become Dates, so a caller cannot tell whether a value came from here or from an API response. Pure, so it tests in node.

3. lib/wheels/api-client.ts — the typed write client, all eight v1 endpoints (spins is phase 2). ApiError {status, code, message} built from the {error, message} body every route already returns, plus two codes for the failures that have no body at all: a fetch rejection, and Vercel's HTML 502, where res.json() throws a SyntaxError that would otherwise surface as a parse bug rather than as an outage. Bearer is attached only on the five editor endpoints — create, duplicate and submit are auth:none, and sending the token there would put it in a log for no benefit. fetch is injectable, the same shape store.ts uses for db. A per-request timeout via AbortSignal, so a hung write fails and rolls back instead of leaving a row pending forever.

4. lib/wheels/optimistic.ts — the reconciliation, pure and React-free. A pending mutation carries a client key, a kind and its settled result; project(live, pending) returns what to render. Retirement is by IDENTITY, not by timer, and per kind:
   - add-option: retire when live options contain the id the 201 returned.
   - accept-suggestion: accept answers 204, so there is no option id to match — retire when live options contain an option whose fromSuggestion is that suggestion ID, which TASK-12 already writes. That field is what makes an optimistic accept keyable at all.
   - remove-option, reject-suggestion: retire when the id is gone from live.
   - submit-suggestion: retire on the returned id.
   - title, suggestionsOpen: no identity to match, so retire on the first snapshot received after the response resolved, tracked with a snapshot sequence number.
   The last case rests on a fact from TASK-14 and is only safe because of it: every mutating route slides expiresAt, so every successful write changes the wheel document and therefore does emit a snapshot. Without that, a PATCH setting the title to the value it already held would emit nothing and the overlay would never retire.
   Retiring on the HTTP response instead of on the snapshot is the flicker this module exists to prevent — the row would vanish on the 201 and reappear when the snapshot lands.

5. lib/wheels/use-wheel.ts and lib/wheels/use-suggestions.ts — the two listeners (AC 1). Status is loading | ready | not-found | error. A shareId that is not a Firestore auto-ID resolves to not-found without opening a listener at all. snapshot.exists() === false is not-found, so a deleted or reaped wheel renders rather than hangs (AC 7); a rules refusal is error. Teardown returns the unsubscribe and a changing shareId tears the old listener down before opening the new, with a generation counter dropping late callbacks — so a slow first snapshot for wheel A cannot write into the state of wheel B (AC 2).

6. lib/wheels/use-wheel-session.ts — composes the two listeners, the optimistic layer and the write client into what TASK-17 through 21 consume: the projected wheel and suggestions, the role, and one mutation per endpoint. Mutations roll back and then reject with ApiError, so TASK-20's toast has something to catch (AC 5). Each projected entry carries pending and slow, the second flipping at a threshold set for the 1-2s cold start design doc section 3 warns about, so the UI gets its affordance without any component owning a timer (AC 6).

7. Tests. model, snapshot, api-client and optimistic are node with no DOM, and carry the bulk of the coverage; optimistic.test.ts is where the duplicate-row and flicker cases live, table-driven. use-wheel.test.ts covers teardown and generation ordering against a stubbed onSnapshot. use-wheel.emulator.test.ts covers the real thing: a wheel created through store.ts arrives, an addOption arrives live, a missing wheel is not-found, and nothing lands after unmount.
   React tests need a DOM and this repo has none, so jsdom and @testing-library/react join devDependencies and each hook test declares // @vitest-environment jsdom rather than a third Vitest project being added. The projects are split by what a test needs from OUTSIDE the install — Java, an emulator — and jsdom is just a package, so npm test stays runnable on a bare install and the opt-out rule in vitest.config.mts is untouched. Recorded there and in CLAUDE.md.

8. Docs: design doc section 3 gains the retirement rule, which is the concrete form of the 'single most likely why does this feel bad regression' that section already warns about; CLAUDE.md gains the client data path and the jsdom convention.

9. npm test, npm run test:emulator, typecheck, lint, format:check, build.

Not in scope, and stated so the reviewer does not look for it: nothing renders. TASK-16 through 21 own the UI, app/w/[shareId]/page.tsx stays the TASK-17 placeholder, and this task delivers the data path and its tests only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered: six modules in lib/wheels, 269 new unit tests and 12 new emulator ones, and decision 22 in the design doc.

- model.ts — the shapes and ID guards both halves share, free of server-only. store.ts re-exports all of it, so the server keeps importing from the module it already imported from and there is still one definition of each.
- snapshot.ts — Firestore document to those shapes. Never throws.
- api-client.ts — one typed method per v1 endpoint, ApiError, injected fetch.
- optimistic.ts — the reconciliation. Pure, React-free, no clock.
- use-wheel.ts, use-suggestions.ts — the two listeners.
- use-wheel-session.ts — all of it assembled for a page.

Unit 552 (up from 283), emulator 281 (up from 269); typecheck, lint, format:check clean, production build succeeds.

Decisions worth knowing about:

- AN OPTIMISTIC ENTRY RETIRES ON THE SNAPSHOT, NEVER ON THE HTTP RESPONSE. Everything else follows from this. Retiring on the 201 is what anyone writes first and it is the flicker: the local row is dropped while the real one is still in flight, so the option vanishes and comes back — on a wheel, a slice disappearing mid-render. Each mutation therefore carries a way to recognise its own arrival: an add waits for the ID its 201 returned, a remove for that ID to be gone, a submit and a reject likewise on the queue.
- Accept is the awkward one, and it is why fromSuggestion is load-bearing for the UI and not only for provenance. POST /accept answers 204, so there is no new option ID to wait for, and the only key available is the field the accept transaction writes onto the option it creates. It also has to wait for BOTH documents — the wheel and the suggestion arrive as two independent snapshots, and retiring on the first lets the queue row flip back to pending until the second lands.
- A patch has no identity to match on, so it retires on VALUE, with the snapshot counter as a fallback. Value first because a snapshot can beat its own response, and a rule phrased as "a snapshot after the response" would then wait for a change nobody is going to make. The counter is needed anyway because two concurrent editors are ordinary here (decision 1): if the other editor writes last, the value we asked for never appears at all, and a value-only rule would show our title forever.
- That last case works only BECAUSE OF TASK-14. Every mutating route slides expiresAt, so every successful write changes the wheel document and does emit a snapshot. Without it a PATCH setting a field to the value it already held would emit nothing and the overlay would never retire. Written into design doc section 3 because it is a dependency between two tasks that nothing in the code makes visible.
- Nothing gives up on a settled entry on a timer. A write that succeeded is a change that exists, so the row is correct to draw whether or not the listener ever delivers it — abandoning it after ten seconds means an editor watching their own successful edit disappear. What is bounded is the request: a 30s timeout, set ABOVE Vercel's function limit rather than below it, so a server-side timeout surfaces as the server's own answer instead of being replaced by our generic one. And a timeout is deliberately not retryable, since the write may well have landed and every mutation here is commutative rather than idempotent.
- project() is pure and takes no clock. React's react-hooks/purity rule caught Date.now() in the useMemo that renders it — a replayed render would produce different output — so the threshold is crossed by a timer in the session hook that sets a flag on the entry. The timer aims at the next deadline rather than polling, so an idle wheel schedules nothing at all.
- The queue is fetched UNORDERED and sorted in the client. An orderBy on createdAt does not merely sort a document with no timestamp oddly, it EXCLUDES it from the result — invisible to the editor who has to action it and to the participant wondering where their submission went, with no error anywhere.
- The bearer header goes only on the five editor endpoints. Create, duplicate and submit are auth:none, and attaching a token to one of them is one more place it can reach a log for no benefit.
- A 2xx whose body is not the documented shape is treated as a failure, because it means a proxy answered in the route's place. Accepting one would put undefined into a URL fragment as an edit token — a share link that looks right and opens nothing. Non-JSON error bodies get the same treatment: response.json() on Vercel's HTML 502 throws "Unexpected token <", which sends whoever debugs it looking for a parsing bug rather than an outage.
- jsdom is declared per file with a vitest-environment directive rather than in a third Vitest project. The existing split is by what a test needs from OUTSIDE the install — Java, an emulator — and jsdom is just a devDependency, so a third project would add a third name to every command and a third way to misname a file in exchange for nothing.
- The Firebase CLIENT SDK works inside jsdom against the emulator, which was not obvious and is what use-wheel.emulator.test.ts rests on. It gives a real listener over a real WebChannel against fixtures written by store.ts — the same functions the routes call — and under the security rules the emulator now enforces.

Verified by mutation, not only by passing. Fifteen mutations; each was caught by the assertions meant to catch it and, with the two exceptions below, by nothing else:

- Retiring on the response instead of the snapshot: 19 fail, including every "never zero rows and never two" timeline.
- Accept retiring on the option alone: exactly 2, the half-landed case and the duplicate-row one.
- Dropping the fromSuggestion filter in the projection: exactly 1, the duplicate accept row.
- retireLanded losing its identity stability: 2 unit cases.
- patch-wheel losing the snapshot-counter fallback: exactly 2, both concurrent-editor cases.
- Bearer on every request: exactly the 3 unauthenticated endpoints.
- Pairing held state with its shareId removed: 3, including "never shows the previous wheel under the new ID".
- suggestionsOpen read by truthiness rather than a strict comparison: exactly the "true" string and the number 1.
- bySubmissionOrder sorting undateable rows first: exactly 2.
- readJson using response.json() directly: 4, including the HTML 502.
- The slow timer polling rather than aiming at the next deadline: exactly 2.
- The slow action losing its identity stability: exactly 2.

Two mutations initially caught NOTHING, and both were comments claiming more than the code did:

- Deleting the live guard from both listeners changed no test. The shareId pairing was doing all the work: a late callback writes wheel A's ID and the render discards it. The guard is not redundant, but the case it actually covers is two listeners on the SAME wheel with the older one dead — StrictMode's double-invoked effect — where both callbacks carry the right ID and pairing cannot tell them apart. Added a StrictMode test to each listener, which now fails when the guard goes, and corrected the comments, which had claimed the flag rather than the unsubscribe was what stopped the cross-navigation leak.
- Removing the entries dependency from the reconcile effect changed no test either, because project() filters landed entries itself — deliberately, since an effect runs after the commit and a view waiting for it would be wrong for a frame. So reconcile is housekeeping: without it the pending list grows for the life of the page. Its only observable is a timer still armed for an entry that is over, which is what the new sweep test asserts. Comment corrected to say what is actually at stake.

One failure mode recorded rather than fixed: breaking retireLanded's identity stability makes the session hook loop forever, and React does not depth-limit an effect-to-dispatch-to-effect chain the way it does a setState during render. So there is no "Maximum update depth" to read — the suite simply never finishes and CI times out with nothing to point at. Confirmed: the run had to be killed at 90s. The identity assertions on the pure function exist to fail first, in milliseconds. Noted in the code at both ends.

Adjacent changes, both to keep one definition of something the client now also needs. StoredOption in store.ts is now WheelOption intersected with a non-null addedAt, narrowing the shared type's nullable timestamp back for the side that writes it. WHEELS and SUGGESTIONS moved to model.ts; WHEEL_SECRETS deliberately did not — the browser has no business naming that collection, so a client-side read of it has to be typed as a string literal rather than reached by autocomplete, which is the point at which the lint rule and a reviewer both get a look at it.

Not done, and stated so the reviewer does not look for it: nothing renders. app/w/[shareId]/page.tsx is still the TASK-17 placeholder, and TASK-16 through 21 own the UI that consumes this.

Post-review (/code-review, five findings). Three fixed, two accepted and documented as one shared limitation.

Fixed:

- MEDIUM in effect though reported as LOW, the snapshot count read at settle time lagged by a commit. The session copied useWheel's seq into a ref inside a passive effect, and a settle is a resolved promise, so it can land between a snapshot's commit and that effect running. The entry then recorded a count one behind, hasLanded read "a later snapshot has arrived" against the very snapshot the entry was already holding, and the patch overlay retired a beat early — the title reverting for a frame. This was not a rare interleaving; it is what ordinarily happens when a response arrives just after a snapshot. useWheel now owns the counter in a ref bumped inside the onSnapshot callback and exposes latestSeq(). Confirmed by mutation: pointing the accessor back at state fails two cases.
- Exposing it as a ref on the state object was the first attempt and react-hooks/refs refused it, correctly — spreading a ref into the returned object makes every read of that object a ref read during render. A function is the honest shape, and its doc comment says where it may be called from.
- LOW, isRetryable called every 5xx retryable, including the gateway statuses. A 504 is a proxy saying the function did not answer IN TIME, not that it did not run, and a 502 is a proxy that could not read the answer to work that may already be committed — the same hazard as timeout, which the same getter already excluded for the same reason. Since these mutations are commutative rather than idempotent, acting on it turns one 504 into two options on the wheel. 408, 502 and 504 are now excluded; 503 deliberately is not, being the one 5xx from an intermediary that really does mean the request was never forwarded. No caller exists yet, so this was latent.
- LOW, a vacuous assertion. The 'submits a suggestion without a token' case asserted on the calls recorder after vi.spyOn had replaced the method, so it could never be populated whatever the hook did — the test would not have failed if the hook had started passing a token. Now asserts the spy's arguments, which is what the case was about.

Accepted and documented, because they are one limitation with one real fix, and that fix is on the server side of the wire:

The responses give the client no way to say which document VERSION its write produced. A 204 says the write committed; it does not say what came out. So "a snapshot arrived after our response" is not the same statement as "a snapshot generated after our commit", and two residuals follow.

- A patch can retire one snapshot early, if a delivery still in flight from before our commit satisfies the counter fallback. The field then shows the stored value until the next snapshot corrects it. It needs another write to land in the window before ours AND its snapshot to be slower than a full API round trip, which is narrow now that the count is read synchronously — the lag above is what made it common rather than rare. Self-correcting either way.
- A created entity deleted before this client ever saw it strands its row. Firestore does not promise to deliver every intermediate version, so a suggestion submitted and rejected inside one round trip, or rejected while the tab was asleep, may never appear in any snapshot here: a phantom row, a pendingCount that never returns to zero, and a slow affordance with nothing behind it. Not fixed by a timeout, because "absent" and "not delivered yet" are the same observation on this side, and a timeout that guessed wrong would delete a row the editor really did add.

Both are written into optimistic.ts under a heading that names the cause rather than the symptoms, with the fix stated: have the mutating routes return the version they committed and compare against that instead of counting deliveries. That is an API change to TASK-10's route and is not taken unilaterally here.

Four more mutations run against the fixes, each caught by the assertion meant for it: the accessor reading state rather than the counter (2 fail), an error callback counting as a delivery (1), the counter not resetting for a new wheel (1), and the gateway statuses folded back under the 5xx branch (3).

Re-verified: unit 560 (up from 552), emulator 281, typecheck, lint, format:check clean, production build succeeds.

Follow-up: the mutating routes now return the version they committed, which closes both residuals above rather than documenting them.

The problem was one sentence long: the responses gave the client no way to say WHICH document version its write produced. A 204 says it committed; it does not say what came out. Everything else followed from that, in both directions — a delivery counter could retire against a snapshot generated before our own commit, and it could never conclude that something was absent because it had been deleted rather than because it had not arrived yet.

What changed:

- Every mutating route answers with `x-wheel-updated-at`, an ISO 8601 timestamp with milliseconds: the `updatedAt` its write stored on the wheel document. Six routes; `POST /duplicate` deliberately has none, since it does not change the wheel it names.
- `updatedAt` is now a real Date computed by the route rather than `FieldValue.serverTimestamp()`. That is the whole enabling change: a sentinel is resolved during the commit, so a route using one has nothing to report. `createdAt` stays a server timestamp on both documents that have one — nothing compares it to a value we returned.
- Every mutating store function returns `WheelVersion & { ... }` rather than its bare result, so the version cannot be dropped on the way out. The two transaction-based ones capture it INSIDE the callback, because a transaction body can run more than once under contention and only the last attempt commits.
- `hasLanded` now takes two kinds of evidence. Identity — the option carries the ID the 201 returned, the row is gone, the queue row reads accepted — is the earliest signal and can never fire too soon. Version is what makes a NEGATIVE answer possible: once a snapshot's `updatedAt` reaches the value the route reported, we are looking at a document that already includes our write, so a thing that is not in it is not on its way.
- `wheelSeq` is gone from the client entirely, and with it the `latestSeq` accessor on useWheel that the previous review round had just added. The queue keeps a delivery counter, but now anchored to something meaningful rather than used alone.

Decisions worth knowing about:

- A HEADER rather than a body. Four of the six routes answer 204 on purpose — a delete is a 204 whether or not there was anything to delete, which is what makes those endpoints safe to call twice — and moving the version into a body would have meant turning them into 200s and rewriting the reasoning that goes with them, across some thirty assertions. The version is metadata about the write rather than a representation of the thing written, so a header is where it belongs anyway. Not `Last-Modified`: its HTTP-date format has one-second resolution, and two writes inside the same second are exactly the case this exists to resolve.
- The version is the WHEEL's even on the suggestion routes, which works only because TASK-14 slides `expiresAt` on the wheel document for every mutation there is. One field versions the whole wheel, subcollection included.
- But it says nothing about the QUEUE listener, which is a separate subscription. So the three suggestion mutations additionally require a queue delivery since the write settled. Without that an optimistic suggestion row would vanish the moment the wheel caught up and reappear when the queue arrived — the same flicker, in the other panel.
- A missing version is not a failure. A proxy that strips unknown headers or an older deployment answering mid-rollout leaves `updatedAt` null, and the entry falls back to identity alone: sound, never early, and only unable to reach the negative conclusion. The write succeeded and the status already said so.
- The cost is that `updatedAt` is the route's wall clock rather than Firestore's, so two writes from two function instances are ordered by clocks that may differ by a few milliseconds. Against our own write the comparison is exact — it is the value we were handed. It is also not a new precedent: `expiresAt`, the field the TTL reaper acts on and by some distance the more consequential timestamp, has been computed this way since TASK-7, as has `addedAt`.

The one failure mode worth naming, because it is quiet: the header and the stored field have to be the same instant. A header running even a millisecond ahead of what was stored would describe a version no snapshot ever carries, so every optimistic row on that wheel would wait forever — and the symptom would be rows that never clear rather than anything resembling a timestamp bug. That equality is asserted against a real Firestore for all six routes, in app/api/wheels/expiry.emulator.test.ts, which is where the sliding-expiry invariants already live because both come out of the same `slidingExpiry` write.

Verified by mutation, five more, each caught by the assertions meant for it and by nothing else:

- `>=` weakened to `>`, so our own write's snapshot no longer counts: 2 fail, including the equality case.
- The queue mutations dropping their queue-delivery requirement: 2 fail, including the end-to-end phantom-row case.
- A null version treated as caught up: 3 fail, all in the degraded-path block.
- The route no longer stamping the header: 12 emulator cases fail; the api-client unit tests still pass, which is the correct split — they stub responses, and only the emulator can see what a real route sends.
- `updatedAt` reverted to a server-timestamp sentinel: 18 emulator cases fail, including the six sliding-expiry ones.

Unit 589 (up from 560), emulator 294 (up from 281); typecheck, lint, format:check clean, production build succeeds. Design doc sections 3, 4 and 6 updated, decision 22 reworded, README and CLAUDE.md follow.

Second review round (/code-review, five findings, all confirmed and fixed).

- MEDIUM, and it was the exact failure the version mechanism documents as fatal. `acceptSuggestion` captured `let version = new Date()` BEFORE its transaction, and the idempotent path — a second accept, which deliberately writes nothing at all, not even the expiry slide — returned without reassigning it. The route then stamped a clock reading strictly AHEAD of the wheel's stored `updatedAt`, which is the one shape this header must never have: it describes a state no snapshot ever carries, so `versionCaughtUp` becomes unsatisfiable and every optimistic entry on that wheel is left on identity alone. Concretely, an editor double-clicks Accept, another editor removes the accepted option before the snapshots reconcile, and the phantom slice never clears. The idempotent path now takes the version from the wheel snapshot the transaction has already read, which is also the honest answer to what the caller asked: the wheel is already at or past the state you wanted. `addOption`'s equivalent initialiser was changed to null for the same reason even though its transaction has no early return.

  The existing emulator table could not have caught this — every row seeds a fresh PENDING suggestion, so no case in it ever takes the idempotent path. A dedicated case now double-accepts and asserts the header equals the stored value; confirmed by restoring the bug, which fails it and nothing else.

  `WheelVersion.updatedAt` is nullable as a result, because a write that stores nothing and cannot read back what was there has genuinely no version to report. `writeHeaders` then omits the header rather than inventing one, and the client's degraded path — identity only, sound, never early — was already built and tested. That also collapsed `ClientVersion` into `WheelVersion`: they had become the same type with the same meaning.

- LOW, `queueMoved` is a delivery count and carries exactly the weakness this module replaced one to avoid: a queue delivery arriving after the response can still have been generated before the commit. Fixed where it was avoidable and documented where it was not. REJECT no longer takes the version fallback at all — deleting a row means every snapshot at or after the commit lacks it, so identity is guaranteed to arrive and there is no negative conclusion left for a version to reach. Submit and accept both have one (a suggestion created and deleted unseen; an option another editor has since removed), so they keep it, and the residual is now listed under "What is still not certain" instead of being absent from it. The queue cannot have a version of its own: a collection is not a document and there is nothing to put a field on.

- LOW, `settle` broke the identity-stability invariant this file documents and that `reset` and `slow` were both given explicit guards for. `entries.map` always allocates, so settling a key that is no longer present — reachable whenever a write is in flight across a shareId change, since the reset empties the list first — handed back a different empty array and re-fired both effects that depend on it. It terminates, so not the infinite loop the file warns about, but the asymmetry was an oversight rather than a decision.

- LOW, two docblocks were stacked in api-client.ts: `readJson`'s description had ended up above `versionOf`, so one function was undocumented and the other carried an argument about JSON parsing. Reattached.

- LOW, a leftover one-line doc comment above `StoredOption`, left stacked on top of the replacement docblock.

Four more mutations, each caught by the assertion meant for it: the idempotent accept reporting a pre-transaction clock (1 emulator case), reject regaining the version fallback (1), `settle` losing its guard (1), and `writeHeaders` fabricating a version when null (1).

That last one is worth recording because it took two attempts. The first mutation of `writeHeaders` passed everything, since the null branch is unreachable from the emulator — the idempotent accept now always finds a real stored value to report. The branch is defensive, so it needed a direct unit test on the pure function rather than an integration one. A defensive branch that no test can reach is a branch that will be deleted by someone tidying up.

Unit 596 (up from 589), emulator 295 (up from 294); typecheck, lint, format:check clean, production build succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the client data path as six modules in lib/wheels: model.ts (shapes and ID guards shared with the server), snapshot.ts (document to model, never throws), api-client.ts (a typed method per v1 endpoint), optimistic.ts (the reconciliation, pure and React-free), the two onSnapshot listeners, and use-wheel-session.ts assembling them.

The load-bearing decision is decision 22, now in design doc section 3: an optimistic entry retires when the change appears in a SNAPSHOT, never when the HTTP response arrives. Retiring on the response is the implementation anyone writes first and it is the flicker the design doc warned about. Each mutation carries a way to recognise its own arrival — the returned ID for an add, fromSuggestion for an accept (which answers 204 and has no ID to wait for, and needs both its documents), and value-plus-snapshot-counter for a patch, which only terminates because TASK-14 slides expiresAt on every write.

Verified with 552 unit tests (up from 283) and 281 emulator tests (up from 269), typecheck, lint, format:check and a production build. Fifteen mutations were applied to confirm the assertions bite; thirteen were caught precisely by the tests meant to catch them. The two that caught nothing were both comments overclaiming — the listeners' live guard and the reconcile effect's entries dependency — and each got a test that now fails when it is removed, plus a corrected comment.

Nothing renders: app/w/[shareId]/page.tsx remains the TASK-17 placeholder.
<!-- SECTION:FINAL_SUMMARY:END -->
