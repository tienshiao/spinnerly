---
id: TASK-9
title: Implement POST /api/wheels — create a wheel
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:36'
updated_date: '2026-08-08 04:30'
labels: []
dependencies:
  - TASK-7
  - TASK-8
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Unauthenticated. Creates a wheel document, mints the share ID and edit token, and writes the token hash to wheelSecrets/{shareId}. This is the only time the raw edit token is ever emitted.

Writes wheels/{shareId} with title, empty options array, suggestionsOpen true, createdAt, updatedAt and expiresAt set 30 days out (design doc section 8).

The wheel document and its secret document must be created atomically. A wheel with no secret is an unowned, uneditable, publicly writable suggestion endpoint that nobody can shut off.

Runtime must be nodejs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /api/wheels returns 201 with shareId and the raw editToken
- [x] #2 wheels/{shareId} and wheelSecrets/{shareId} are created atomically in a batch or transaction
- [x] #3 The stored secret contains only the SHA-256 hash, never the raw token
- [x] #4 expiresAt is set 30 days from creation
- [x] #5 The raw editToken appears in the response body only, and in no log line
- [x] #6 An optional title in the request body is validated against the shared caps and defaults sensibly when absent
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/wheels/request.ts — readJsonObject(request): parse a JSON body into a plain object, throwing ValidationError for anything else. An ABSENT body must mean {} (the landing CTA creates a wheel in one click and sends nothing), while a malformed one must be 400 rather than the 500 that a bare request.json() would produce. Shared rather than inlined because TASK-10/11/12 all need the same two rules and this is exactly the kind of thing that drifts per endpoint.
2. app/api/wheels/route.ts — replace the 501 stub with POST. Read the body, validateNewWheelTitle, createWheel, return 201 { shareId, editToken }.
3. Response carries Cache-Control: no-store. The body holds a bearer capability and must never sit in a shared cache.
4. Nothing is logged on the success path at all, so the raw token cannot reach a log line. Unexpected failures console.error the error only.
5. The route accepts a title and nothing else. It deliberately does not take an initial options array: the create flow is one click (TASK-21) and duplicate (TASK-13) calls createWheel directly, so no caller needs it, and a smaller body is a smaller attack surface on an unauthenticated endpoint.
6. Tests split by what they need. app/api/wheels/route.test.ts covers every rejection in the unit project — those paths never reach Firestore. app/api/wheels/route.emulator.test.ts covers 201, atomicity, hash-only storage, expiresAt at 30 days, and asserts the raw token appears in no console output.
7. npm test, npm run test:emulator, typecheck, lint, format.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added app/api/wheels/route.ts (POST, replacing the 501 stub), lib/wheels/request.ts, and three test files. Unit suite 232 green (up from 200), emulator suite 42 green, typecheck/lint/format clean, production build succeeds.

Decisions:

- lib/wheels/request.ts holds readJsonObject rather than the route inlining a parse. Three rules that would otherwise drift per endpoint: an ABSENT body means {} (creating a wheel is one click and sends nothing, and request.json() throws on an empty body, so a route calling it directly answers a valid create with a 500); a MALFORMED body is 400, not the 500 an uncaught throw gives; and a body that parses to null/42/an array is refused, since null is typeof 'object' and slips past a naive check until the first property read throws. Also caps the body at 64KB — route handlers read their own body and Next.js applies no limit to them, the 1MB figure people remember being the Server Action cap.
- The route accepts a title and nothing else. createWheel can write an initial options array, but the create flow is one click (TASK-21) and the only bulk-options path is duplicate (TASK-13), which calls createWheel directly. Accepting a list nobody sends would widen an unauthenticated surface and would need its own OPTIONS_MAX check to avoid writing past the cap.
- Response carries Cache-Control: no-store. It is the one response in the app whose body is a bearer capability.
- Nothing is logged on the success path, which is what keeps the raw token out of Cloud Logging. The only console.error is in the failure branch, where no token is in scope.

Test split is deliberate and load-bearing. app/api/wheels/route.test.ts runs in the unit project because every rejection path is refused before createWheel is called — so the rule 'an invalid request must not touch the database' is enforced by the suite itself: move validation after the write and those tests start failing for want of an emulator rather than passing quietly. app/api/wheels/route.emulator.test.ts covers what can only be seen in the data — both documents present, hash-only storage, expiresAt on wheel AND secret, title defaulting and sanitisation, no-store, and a console spy asserting the raw token appears in the response body and in no console output.

Consequence for TASK-8: its AC 1 is now half-demonstrated — this route imports its title rules from lib/wheels/validation.ts rather than restating them. Still not closable until TASK-10/11/12 land. TASK-8's validateNewWheelTitle now has its first caller; the bulk form assertOptionCapacity(current, adding) still has none and waits on TASK-11 and TASK-13.

Post-review revisions (/code-review found four issues, all confirmed and all fixed):

1. The 64KB ceiling did not bound memory at all. readJsonObject checked content-length, then called request.text() — which buffers the whole body before returning, so the post-read check ran after the memory was already spent. content-length is caller-supplied and legitimately absent on an HTTP/1.1 chunked body and optional under HTTP/2, so on an unauthenticated endpoint anyone willing to send chunked could have us buffer a body of any size. Verified the header is not even set by the Request constructor for a string body, so every request in the existing tests was already taking that path. Replaced with a streaming read over request.body that counts bytes and calls reader.cancel() at the ceiling.

2. The post-read check used raw.length — UTF-16 units — while the content-length check was in bytes, so the two disagreed. 65,536 CJK characters are 65,536 units and exactly 196,608 bytes: sent with content-length that body was refused, sent chunked it was accepted, and the accepting path was also the unbounded one. The streaming counter is in bytes, which is what content-length speaks and what memory costs. Regression test asserts both numbers explicitly.

3. The test 'does not choke on a body with no content-length header' was vacuous. It deleted a header the Request constructor never sets, so it was byte-identical to every other test in the file and would have passed even if the branch were broken. Replaced with two that bite: an oversized body that declares no length must still be refused (the case only the stream counter catches), and the byte-vs-UTF-16 case above. Added a third for the streaming decoder — a body split into 3-byte chunks mid-character must still parse, which decoding each chunk independently would break.

4. The emulator test initialised its own named app and deleted it in afterAll, and its docstring claimed the route used a separate one. Wrong: createApp() returns getApps()[0] when any app exists, so the route's getAdminDb() was handed the test's app, and afterAll was tearing down the handle cached in the admin module's globalThis cache. It passed only because nothing ran after it. Now reads through getAdminDb() — the same handle the route uses — and tears nothing down, with the reasoning recorded. Verified the suite still exits cleanly rather than hanging on an open gRPC channel.

Unit suite 234 green, emulator suite 42 green, typecheck/lint/format clean, production build succeeds.

Second review round (/code-review, post-Zod). Three findings, all confirmed and fixed:

1. await reader.cancel() was unguarded, so a rejecting cancel replaced the 413 with a 500. Verified both rejection paths in Node: cancel() rejects when the stream has already errored, and when the source's own cancel algorithm throws. The window matters because an oversized body is exactly the request a client is likeliest to abort — so the failure is attacker-triggerable, turning a clean 413 into a 500 plus an error-log line each time. Now .catch(() => {}). The regression test was checked against the unfixed code and does fail without the guard.

2. The read failure's bare catch discarded the underlying error, so every transport failure reached operators as a bare 400 unreadable_body that reads like malformed client input, with nothing recorded to distinguish a client disconnect from an infrastructure fault. ValidationError now takes ErrorOptions and the read attaches { cause }. Response shape is unchanged.

3. A test name asserted the opposite of its own assertion — 'keeps an explicitly empty object distinct from nothing' while asserting both yield {}. Misleading precisely for whoever implements PATCH, where the absent/present distinction is real but lives in the parsed object rather than in the difference between those two bodies. Renamed and the comment now says where the distinction does live.

The reviewer independently confirmed the previous round's fixes hold, including driving a real Next.js dev server against the emulator and proving with a raw socket that a 200MB chunked body with no content-length is refused after ~128KB rather than buffered.

Unit suite 249 green, emulator 42 green, typecheck/lint/format clean, build succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
POST /api/wheels creates a wheel unauthenticated, minting the share ID and edit token and writing wheels/{shareId} plus wheelSecrets/{shareId} atomically in one batch — the raw token is returned in the response body and stored nowhere, only its SHA-256 hash. Adds lib/wheels/request.ts, whose readJsonObject is the transport layer every later write route reuses: an absent body means {} (one-click create sends nothing), a malformed one is 400 rather than 500, and the body is bounded at 64KB by a streaming byte counter rather than a caller-supplied content-length. Verified by 249 unit tests and 42 emulator tests, typecheck/lint/format clean, production build succeeds; two /code-review rounds found seven issues, all confirmed and fixed, the last independently verified with a raw socket proving a 200MB chunked body is refused after ~128KB rather than buffered.
<!-- SECTION:FINAL_SUMMARY:END -->
