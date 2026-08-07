---
id: TASK-7
title: Build the server-side data and editor-authorization library
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:36'
updated_date: '2026-08-07 23:34'
labels: []
dependencies:
  - TASK-5
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The shared server module every write route handler sits on. This is the single most security-sensitive piece of the codebase, per design doc section 6.

Responsibilities:
- A Firestore handle from the Admin SDK.
- Minting a share ID (Firestore auto-ID, roughly 120 bits) and an edit token as an independent CSPRNG value. The token must not be derived from the shareId. A derived token means one leaked pepper mints edit rights for every wheel that exists, and rotating the pepper locks out every live wheel at once.
- SHA-256 hashing of the edit token. Only the hash is ever stored, in wheelSecrets/{shareId}.
- An assertEditor(shareId, request) guard that reads the bearer token from the Authorization header, looks up wheelSecrets keyed by the shareId taken from the request path, and compares hashes in constant time.

The guard answers is this THIS wheel token, never is this A valid token. The anti-pattern in design doc section 6 is a query across the wheelSecrets collection filtering on editTokenHash; that validates the token globally and hands an editor of wheel A write access to wheel B. It is a confused-deputy bug and it is easy to reintroduce when refactoring auth into shared middleware.

The shareId must come from the request path only. Never from the body, and a caller must never be able to name which secret document is checked.

The edit token must never appear in a path, a query string, or a log line. Scrub it from logging config regardless.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Share IDs and edit tokens are generated independently, with the token from a CSPRNG and not derived from the shareId
- [x] #2 Only the SHA-256 hash of the edit token is persisted; the raw token is returned exactly once, at creation
- [x] #3 assertEditor looks up wheelSecrets by the shareId from the request path and compares hashes with a timing-safe comparison
- [x] #4 Test: a request with the correct token for wheel A succeeds on wheel A
- [x] #5 Test: an editor of wheel A receives 403 on wheel B
- [x] #6 Test: a missing or malformed Authorization header receives 401, and an unknown shareId receives 404
- [x] #7 No code path queries wheelSecrets by editTokenHash
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Two modules plus a lint rule. getAdminDb() from TASK-5 already covers the Firestore handle, so this task is minting, hashing, the guard, and creation.

1. lib/wheels/tokens.ts — pure crypto, no I/O, no Firestore, so it unit-tests without an emulator.
   - mintEditToken(): randomBytes(32) as base64url. 256 bits from a CSPRNG, generated with no reference to the shareId. base64url specifically because the token lives in a URL fragment (#e=...) and the standard alphabet's +, / and = would need escaping there.
   - hashEditToken(): SHA-256 hex. Plain SHA-256 rather than bcrypt or argon2 is correct HERE and the reason needs writing down: password KDFs exist to slow brute force over a guessable space, and a 256-bit random token has none. Worth a comment because 'why isn't this bcrypt' is the obvious review question.
   - editTokenMatches(presented, storedHash): timing-safe. crypto.timingSafeEqual THROWS on unequal buffer lengths, and the stored side comes from the database, so a malformed or truncated hash would turn an auth check into a 500. Note Buffer.from(x, 'hex') does not throw on invalid input — it silently truncates — so the guard is an explicit length check that fails closed, not a try/catch.
   - readBearerToken(header): case-insensitive scheme per RFC 7235, null on missing/malformed/empty.

2. lib/wheels/store.ts — Firestore access and the guard.
   - isShareId(): strict [A-Za-z0-9]{20} check for Firestore auto-IDs. This is load-bearing, not hygiene: both db.doc(path) and collection.doc(id) resolve SLASHES as path segments, so an unvalidated shareId is a path-traversal primitive into a document the caller named. The task's 'a caller must never be able to name which secret document is checked' is exactly this.
   - createWheel(): mints the shareId as a Firestore auto-ID and the token independently, then writes wheels/{id} and wheelSecrets/{id} in one batch. Batched because a wheel that exists without its secret has no editor and cannot be recovered. Returns the raw token — the only time it is ever emitted.
   - assertEditor(shareId, request): reads the bearer header, validates the shareId shape, gets wheelSecrets/{shareId} BY DOCUMENT ID, compares hashes timing-safely. Throws EditorAuthError carrying an HTTP status.
   - Throwing rather than returning a Result is deliberate: a caller who forgets to check a returned boolean writes unauthorised, whereas a caller who forgets to catch gets a 500 and denies the write. Fail closed on misuse.

3. eslint-rules: spinnerly/no-wheel-secret-queries. AC 7 says no code path queries wheelSecrets by editTokenHash. That is otherwise satisfied only by having looked, which does not survive the refactor the design doc warns it is easy to introduce. Flags where()/orderBy() on a wheelSecrets collection reference and any where() on editTokenHash. Matches the existing enforced-invariant pattern in eslint-rules/index.mjs.

4. Tests, split by what they need.
   - node --test on lib/wheels/tokens.test.ts, plus the lint rule tests: no emulator, stay in npm test.
   - Emulator-backed tests for assertEditor and createWheel behind a new npm script wrapping firebase emulators:exec, so npm test does not start requiring Java. Covers ACs 4, 5, 6: right token on its own wheel succeeds, editor of A gets 403 on B, missing and malformed headers get 401, unknown shareId gets 404.

5. Verify: typecheck, lint, format:check, build, npm test, the emulator suite, and grep the tree for the anti-pattern.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two modules, one lint rule, two test suites.

lib/wheels/tokens.ts — pure, no Firestore, no server-only, so it unit-tests with nothing installed.
lib/wheels/store.ts — isShareId, createWheel, assertEditor, EditorAuthError.
eslint-rules: spinnerly/no-wheel-secret-queries, enabled as an error.

Things decided along the way that are not obvious from the code:

- assertEditor THROWS rather than returning a result. A caller who forgets to inspect a boolean writes unauthorised; a caller who forgets to catch gets a 500 and no write. Misuse should fail closed, and only one of those does.
- shareId shape is validated BEFORE the lookup, and this is security-relevant rather than hygiene. Both db.doc(path) and collection.doc(id) resolve slashes as path separators, so an unvalidated shareId from a URL is a path-traversal primitive that lets the caller name the document being checked — which is the same class of bug as the confused deputy, arriving by a different door. Refused as 404 on shape, with the same code and message as a genuinely unknown wheel so a prober cannot tell which of their guesses were well-formed.
- Plain unsalted SHA-256 is correct here and the reasoning is written into the file, because 'why not bcrypt' is the obvious review question. Password KDFs are slow to defend a guessable space; a 256-bit CSPRNG token has none, so a work factor only adds latency to every authenticated request.
- editTokenMatches guards a trap: timingSafeEqual THROWS on unequal buffer lengths, so a corrupt stored hash would 500 every request for that wheel instead of denying. Note that Buffer.from(x, 'hex') does NOT throw on invalid input — it decodes to the first bad pair and returns a short buffer — so a try/catch there would catch nothing. The guard is an explicit length check on the decoded buffer, and it is tested.
- expiresAt is set at creation. Sliding it is TASK-14, but design doc section 8 is explicit that TTL is trivial at creation and impossible to retrofit onto data users were promised we would keep, so a wheel created before TASK-14 lands still expires rather than living forever.
- createWheel batches the wheel and its secret. A wheel that committed without its secret has no valid token and no way to acquire one — a live, publicly readable wheel nobody can edit or delete.
- options[].addedAt is a real Date, not serverTimestamp(). Firestore rejects the sentinel inside array elements; it is only valid at the top level or in a map.

Test infrastructure, which is new and affects everything downstream:

npm test stays runnable with no Java and no emulator. Firestore-backed tests are named *.emulator.test.ts and run under npm run test:emulator, which wraps firebase emulators:exec. npm run test:all runs both. The suffix is what routes them, so this scales to TASK-6 and the route tests without further plumbing. Documented in CLAUDE.md.

Three sharp edges found getting node --test to run these, all now documented:
- server-only throws in plain Node. --conditions=react-server resolves it to the empty module.
- Node strips types rather than compiling, so it resolves specifiers literally: relative imports need real .ts extensions (added allowImportingTsExtensions to tsconfig, safe under noEmit) and the @/ alias does not resolve at all. store.ts therefore imports relatively.
- Verified separately that Turbopack still resolves both the .ts extensions inside store.ts and the @/lib/wheels/store alias from a route, by temporarily importing it from app/api/wheels/route.ts and building. Nothing in app/ imports store.ts yet, so a passing build would otherwise have proved nothing and TASK-9 would have hit it first. Probe reverted.

Validation: typecheck, lint, format:check, build all clean. npm test 85/85 (18 token unit tests, 67 lint-rule tests including 16 new). npm run test:emulator 16/16 against a real Firestore.

AC 7 verified two ways: grepped the tree — every wheelSecrets access in app, lib and scripts is .doc(id), no queries — and confirmed the lint rule fires on a real file containing the design doc's verbatim anti-pattern, with one specific error rather than two overlapping ones.

--- Post-review pass (/code-review) ---

Four findings, all confirmed and all fixed. Re-verified: typecheck, lint, format:check, build clean; 90/90 unit; 16/16 emulator.

1. MEDIUM, and a live breakage. The seed fixture's share ID was 21 characters ('seedwheel000000000000'), so isShareId rejected it and assertEditor would have thrown 404 before ever reading the secret. Every write route from TASK-9 on would have 404'd against the one wheel the emulator ships with, while both documents sat there in the database — a debugging trap aimed squarely at whoever picks up TASK-9. The validator is right (Firestore auto-IDs are exactly 20 chars, and the strictness is the path-traversal guard), so the fixture is what conformed. Verified end-to-end by running the emulator, seeding, and authenticating: isShareId true, seeded token accepted, wrong token refused 403.

2. createWheel set expiresAt on the wheel but not on its secret, so the TTL policy would reap the wheel and leave the secret forever. Two consequences: assertEditor keeps succeeding for a wheel that no longer exists, and a set(..., {merge:true}) in a later route would resurrect it with no expiresAt at all — permanently un-reapable. Plus wheelSecrets grows without bound, which is the opposite of what design doc section 8 exists for. Now mirrored onto the secret so the pair is reaped together. Flagged to TASK-14 that the TTL policy has to cover both collections.

3. Narrowing npm test to explicit globs meant a file named with the ordinary *.test.ts convention was globbed by neither suite — green run, file never executed, nothing said so. Added test-conventions.unit.test.ts, which walks the repo and fails with the offending paths and the fix. Confirmed it actually fires by planting an orphan, and that it does not pass vacuously (it also asserts the walker finds the known suites).

4. no-wheel-secret-queries only understood the namespaced Admin shape. The modular form puts the collection name in the second argument and calls where() as a bare identifier, so the design doc's verbatim anti-pattern written in modular style linted clean — in the one rule that is the sole mechanical enforcement of AC 7. Now handles both argument positions and bare where() calls, and the modular nesting shape (query/getDocs/onSnapshot wrapping a collection ref) as well as the chained one. doc(collection(db, WHEEL_SECRETS), shareId) stays valid, since that is the correct modular spelling. Factored the double-report suppression into one isHashFilterCall helper used by both paths.

--- Test runner switched to Vitest (user request, after TASK-7 landed) ---

node --test replaced by Vitest 4.1.10, configured in vitest.config.mts as two projects (unit, emulator) with the include globs in test-includes.ts. Scripts unchanged in meaning: npm test, npm run test:emulator, npm run test:all, plus npm run test:watch.

The migration deleted all three sharp edges node --test had forced:
- allowImportingTsExtensions is gone from tsconfig.
- lib/wheels/store.ts is back on the @/ alias and extensionless imports, so it no longer looks different from every other module in the app.
- The --conditions=react-server flag is gone from the scripts.

Two things worth knowing for anyone touching the config:

1. server-only needs ssr.resolve.conditions, not resolve.conditions. Vitest's node environment resolves through Vite's SSR pipeline, so resolve.conditions alone silently does nothing and every test importing store.ts dies on server-only's deliberate throw. I also briefly added server.deps.inline for it, then removed it after confirming ssr.resolve.conditions alone is sufficient — worth not re-adding.

2. The config is .mts. This package is not "type": "module", so Vite's native config loader reads a .ts config as CommonJS and warns about the ESM syntax in it. The .mts extension settles that without making the whole package ESM.

@types/node bumped 20 to 22 to match the runtime actually in use, which the naming guard needed for node:fs globSync.

Assertions stayed on node:assert/strict rather than moving to expect. Both work under Vitest; the suites were already written with tuned assertion messages and rewriting them would have added risk for no gain.

test-conventions.unit.test.ts now imports the real globs from test-includes.ts instead of restating them, so it cannot drift from the config it guards. Re-verified it still fires by planting an orphan file.

Validation after the switch: typecheck, lint, format:check, build clean. 90/90 unit, 16/16 emulator — same counts as before the migration, so nothing was silently dropped.

--- Assertions moved to Vitest expect (user request) ---

node:assert/strict is gone from every suite. The eslint-rules suite needed no change — RuleTester does its own assertions and only imports describe/it.

Test counts went UP without adding coverage: 90 to 105 unit, 16 to 30 emulator. That is it.each expanding the table-driven cases into individually named tests, which was the real win. Previously a loop over seven malformed stored-hash values reported as one test and named the failing case only inside an assertion message; now each row is its own test with its own name.

Conventions set for future tests, written into CLAUDE.md:
- expect(value, 'why this matters') for the second-argument message form.
- it.each over for loops for table-driven cases, object form with a label and $label in the title.
- Tables needing a beforeAll fixture must wrap the value in a thunk. it.each evaluates its table at COLLECTION time, before any hook has run, so referencing a fixture directly yields undefined. The 401 header cases in store.emulator.test.ts are the worked example.

Mutation-tested the converted suite rather than trusting a green run: reintroduced the confused-deputy bug in assertEditor (short-circuited the hash comparison) and confirmed 6 tests fail, including 'refuses an editor of wheel A on wheel B with 403' by name. So the expect/resolves rewrite genuinely still catches the bug the task exists to prevent, rather than passing vacuously — which is the specific risk when converting assertions to a promise-aware matcher.

One config knock-on. test-includes had to become .mts: Vite's native config loader reads a .ts helper as CommonJS in a package that is not "type": "module" and warns about the ESM syntax in it. TypeScript will not resolve an .mts specifier without allowImportingTsExtensions, so that tsconfig flag is back — but for a narrower reason than before. It now covers only the two imports of test-includes.mts; application code is unaffected and still uses @/.

Validation: typecheck, lint, format:check, build clean. 105/105 unit, 30/30 emulator.

--- Second review pass (/code-review, post-Vitest) ---

Five findings, all confirmed and fixed. Re-verified: typecheck, lint, format:check, build clean; 105/105 unit, 30/30 emulator; seed re-verified end to end.

1. MEDIUM, and I introduced it in the Vitest migration. resolve.conditions: ['react-server'] REPLACES Vite's default condition list rather than extending it, and applied to every dependency in both projects — not just server-only. React therefore resolved to its react.react-server build, where useState and every other hook is undefined. Verified with a throwaway probe test: typeof React.useState was 'undefined'. The first component test written for TASK-16 or TASK-18 would have failed with 'useState is not a function' and read as a React version problem rather than a config one — a trap set for a future task, in a file nobody would think to suspect.

Replaced with a targeted alias from server-only to the package's OWN empty.js — the exact file Next loads when it builds a server component, resolved through createRequire so it survives hoisting, with an existsSync guard that fails loudly if the package layout changes. Verified React now resolves correctly AND the emulator suite still passes. CLAUDE.md previously documented the conditions approach as required; that paragraph now documents the alias and explicitly warns against 'fixing' it back.

2. afterAll dereferenced app unconditionally, but app is only assigned after the FIRESTORE_EMULATOR_HOST check. Running the emulator project without the emulator produced a second failure ('Invalid app argument') that buried the first — the one carrying the instructions. Guarded. Verified: the actionable message is now the only failure, with 30 skipped rather than a cascade.

3. The seed fixture wrote expiresAt on the wheel but not on wheelSecrets, diverging from createWheel in exactly the field TASK-14's TTL policy keys on. TTL work validated against seeded data would have looked correct while the real asymmetry stayed invisible. Fixed and verified end to end: both documents now read 30.0 days.

4. npm test silently required Node >= 22.17 — globSync's array-form exclude is only accepted from that patch, while the predicate form has worked since 22.0. Switched to the predicate form and added engines.node >= 22.0.0, which nothing previously declared.

5. The naming guard's failure message and CLAUDE.md both pointed at test-includes.ts after I renamed the file to .mts — sending a reader looking for a file that does not exist, for a rename whose extension is load-bearing. Fixed in both places.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 22:05
---
For TASK-8 through TASK-13, which all sit on this.

Route handlers use it like this:

    import { assertEditor, EditorAuthError } from '@/lib/wheels/store'

    export async function PATCH(request, ctx) {
      const { shareId } = await ctx.params
      try {
        await assertEditor(shareId, request)
      } catch (error) {
        if (error instanceof EditorAuthError) return error.toResponse()
        throw error
      }
      // ...authorised from here
    }

The shareId MUST come from ctx.params — the request path — and never from the body. Passing a body-supplied ID would let a caller name the secret being checked, which is the confused deputy by another route and is not something the lint rule can see.

The third parameter (the Firestore handle) exists for tests and defaults to getAdminDb(). Routes should omit it.

Two things I deliberately did not build, so nobody waits on them:
- Validation and the option caps are TASK-8. createWheel writes title and options as given.
- A generalised ApiError. EditorAuthError is scoped to auth failures. If TASK-8 wants one error type across all four-hundreds, promoting it is a small refactor and this is the moment to do it, before five routes have their own shape.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Built the server-side data and editor-authorization library — the module every write route sits on.

lib/wheels/tokens.ts holds the crypto: a 256-bit CSPRNG token minted with no reference to the shareId, base64url so it survives a URL fragment intact, SHA-256 hashing, a timing-safe comparison that fails closed on a corrupt stored hash rather than throwing, and RFC-7235 bearer parsing.

lib/wheels/store.ts holds the Firestore half: createWheel, which mints both IDs independently and batches the wheel with its secret, and assertEditor, which fetches wheelSecrets/{shareId} BY DOCUMENT ID using the shareId from the request path. It throws rather than returning a result so that forgetting to check it denies the write instead of allowing one.

Two guards beyond what the task asked for, both closing the same class of bug from a different direction. spinnerly/no-wheel-secret-queries fails lint on any query across wheelSecrets or any where() on editTokenHash, so acceptance criterion 7 survives the refactor design doc section 6 warns it is easy to introduce. And isShareId validates the ID shape before any lookup, because Firestore resolves slashes in a document ID as path separators — without it, an unvalidated shareId from a URL lets the caller choose which secret is checked.

Also established the test split this project did not have: npm test stays fast and dependency-free, *.emulator.test.ts runs against a real Firestore under npm run test:emulator. Getting node --test to run TypeScript against these modules surfaced three sharp edges — server-only throwing in plain Node, no @/ alias resolution, and mandatory .ts extensions — all now handled and written into CLAUDE.md.

Verified: typecheck, lint, format:check and build clean; 85/85 fast tests; 16/16 emulator tests including the editor-of-A-on-B refusal by name. Confirmed separately that Turbopack still resolves the module from a route, since nothing in app/ imports it yet and a passing build would otherwise have proved nothing.
<!-- SECTION:FINAL_SUMMARY:END -->
