---
id: TASK-5
title: Wire the Firebase SDKs against the local emulator
status: Done
assignee:
  - '@claude'
created_date: '2026-08-07 08:36'
updated_date: '2026-08-07 19:03'
labels: []
dependencies:
  - TASK-2
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the Firebase projects and Firestore databases, and wire both halves of the split in design doc section 3: writes go through server route handlers using the Admin SDK, reads go direct from the browser using the client SDK.

Server side: firebase-admin initialised once per lambda from a service account in environment variables, never from a checked-in key file. Lazily initialised so it survives Next.js hot reload and serverless warm reuse.

Client side: the modular Firebase JS SDK configured with the public web config, used only for onSnapshot reads. The client must never be given a write path.

Local development runs against the Firebase Emulator Suite (design doc decision 19). Cloud projects are used for deployed environments only, and creating them is TASK-27.

This task has no dependency on TASK-27. Everything below runs against the emulator, so the app is buildable, runnable and reviewable before any Firebase project exists. The cloud path is written and code-reviewed here but only exercised once TASK-27 and TASK-25 land.

## What the emulator decision changes

The big win is that no service account ever lands on a developer machine. When FIRESTORE_EMULATOR_HOST is set, the Admin SDK skips credential resolution entirely — it does not authenticate, because there is nothing to authenticate against. So the private key exists in exactly one place, the Vercel dashboard, and local setup involves no secrets at all.

Second win: it makes TASK-6 real. Security rules against a live project can only be tested by poking at them by hand; against the emulator they are unit-testable with @firebase/rules-unit-testing, in CI, on every change. Rules are the entire security model per design doc section 5, so this matters more than it sounds.

It also removes the "dev project has open rules until TASK-6 lands" hazard from the original plan, because there is no dev cloud project to leave open.

What it does NOT remove: Vercel preview deploys run in the cloud and cannot reach a laptop's emulator. So a second cloud project is still wanted, for previews, unless previews are to write to production data. Two cloud projects, one local emulator.

Verified on this machine: Java 17 is present, which the emulator requires.

## What this task does

Emulator setup:

1. Add firebase-tools as a devDependency rather than a global install, so the version is pinned in the repo and CI gets the same one.
2. firebase.json configuring the Firestore emulator and the emulator UI, plus .firebaserc.
3. Use the project id demo-spinnerly locally. The demo- prefix is load-bearing: the emulator treats such ids as strictly local and refuses to contact Google, so a misconfigured client cannot silently read or write a real project. It also means the local client needs no real API key.
4. npm scripts: one to run the emulator, one to run dev against it.
5. A seed script so a fresh emulator has a wheel to look at, since emulator data is discarded on exit by default.

SDK wiring:

6. Install firebase-admin and firebase.
7. lib/firebase/admin.ts — lazy singleton cached on globalThis so hot reload does not re-initialise and warm lambdas reuse the connection. Detects FIRESTORE_EMULATOR_HOST and skips credentials in that case. Handles the private key newline problem for the cloud case.
8. lib/firebase/client.ts — read-only client, calling connectFirestoreEmulator when pointed at the emulator.
9. .env.example, documented, plus a README section on local setup.
10. A local eslint rule in the spinnerly/* family, spinnerly/no-client-firestore-writes, failing on any Firestore write function imported from client code: setDoc, addDoc, updateDoc, deleteDoc, setDocs, writeBatch, runTransaction, and the deleteField/increment style field transforms that only make sense in a write.

    Approved. Rationale: design doc section 3 says the client must never be given a write path, and the runtime invariant in TASK-2 showed that a lint rule is the difference between a documented constraint and an enforced one. It follows the same shape as the existing rules — implementation in eslint-rules/index.mjs, tests in index.test.mjs, run by npm test. As with those, it needs to handle the forms a naive check misses: namespace imports, aliased imports, and dynamic import().

## The environment variables

Local, and this is the whole local setup — no secrets:

  FIRESTORE_EMULATOR_HOST            127.0.0.1:8080
  NEXT_PUBLIC_FIREBASE_EMULATOR_HOST 127.0.0.1:8080
  NEXT_PUBLIC_FIREBASE_PROJECT_ID    demo-spinnerly
  NEXT_PUBLIC_FIREBASE_API_KEY       any non-empty string; the emulator does not check it

Deployed only, set in Vercel, scoped Production and Preview separately. Server secrets from the service account JSON:

  FIREBASE_PROJECT_ID      JSON field: project_id
  FIREBASE_CLIENT_EMAIL    JSON field: client_email
  FIREBASE_PRIVATE_KEY     JSON field: private_key

Deployed public values from the web config:

  NEXT_PUBLIC_FIREBASE_API_KEY     apiKey
  NEXT_PUBLIC_FIREBASE_PROJECT_ID  projectId
  NEXT_PUBLIC_FIREBASE_APP_ID      appId

Deliberately omitted: authDomain, storageBucket, messagingSenderId. Firestore needs none of them, and v1 has no accounts, uploads or push. appId is kept because App Check needs it in TASK-24. The project id appears as both a public and a server variable on purpose — collapsing them would leak the server variable into the browser bundle.

This also settles the AC #5 ambiguity raised in the comment below: the presence or absence of FIRESTORE_EMULATOR_HOST genuinely is the single switch between local and cloud, which is what the criterion was reaching for.

## What I need from you

Nothing. That is the point of the split — the emulator needs no account, no project and no credential, so this task is unblocked as it stands.

Credentials are handled once, in TASK-27 and TASK-25, and go from the Firebase console straight into the Vercel dashboard. They should never be pasted into chat, a task, or a committed file. .gitignore already covers .env*; the real exposure risk is chat history and pull request descriptions, not the working tree.

## Gotchas worth knowing before they cost an afternoon

  - Emulator data is in-memory and discarded on exit unless started with export-on-exit. The seed script exists so that is a shrug rather than an annoyance.
  - FIRESTORE_EMULATOR_HOST is read by the Admin SDK automatically, but the client SDK needs an explicit connectFirestoreEmulator call, and it must happen before any other Firestore call or it throws.
  - The demo- project id prefix is what guarantees isolation. A non-demo id in .firebaserc means a typo can reach a real project.
  - The private key newline problem, for the cloud path. The JSON private_key holds real newlines; env files conventionally store escaped backslash-n which must be unescaped at runtime. Vercel's dashboard accepts real newlines, so a value copied from Vercel back to a local file breaks, and vice versa. The code will handle both forms.
  - Lazy init is not optional. initializeApp at module scope throws "The default Firebase app already exists" on the second hot reload.
  - Java is required for the emulator. Verified present on this machine; it will need to be in CI too when TASK-6 adds rules tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 firebase-admin initialises from environment variables and is reused across invocations within a warm lambda
- [x] #2 The client SDK config is public-safe and contains no service account material
- [x] #3 The service account private key is absent from the repository and from any committed env file
- [x] #4 A documented .env.example lists every required variable
- [x] #5 Local development can point at a separate Firebase project from production via one environment variable
- [x] #6 The private key survives both storage forms — escaped backslash-n in a local env file and real newlines pasted into Vercel — without a code change
- [x] #7 The client SDK module exports no write capability, and importing a Firestore write function from client code fails lint
- [x] #8 Local development runs entirely against the Firebase Emulator Suite with no cloud project and no service account present on the machine
- [x] #9 The local Firestore project id uses the demo- prefix, so a misconfiguration cannot reach a real project
- [x] #10 firebase-tools is a pinned devDependency, not a global install
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add deps: firebase-admin + firebase (runtime), firebase-tools pinned exact (dev).
2. firebase.json (Firestore emulator 127.0.0.1:8080, UI 4000, singleProjectMode) and .firebaserc pointing at demo-spinnerly. No firestore.rules key yet — TASK-6 adds it.
3. Env: commit .env.development with the four secret-free emulator values so npm run dev needs zero setup, plus a documented .env.example covering both local and deployed sets. Unignore both in .gitignore.
4. npm scripts: 'emulator' (emulators:start), 'dev:emulator' (emulators:exec wrapping seed + next dev), 'seed'.
5. scripts/seed-emulator.mjs — refuses to run without FIRESTORE_EMULATOR_HOST, writes one demo wheel + suggestions + wheelSecrets hash, prints the share and edit URLs.
6. lib/firebase/admin.ts — lazy singleton cached on globalThis, emulator branch skips credentials, private key normalised for both escaped-\\n and real-newline storage.
7. lib/firebase/client.ts — client-only, lazy, connectFirestoreEmulator before any other Firestore call, exports a read handle and no write helper.
8. eslint rule spinnerly/no-client-firestore-writes in eslint-rules/index.mjs + tests: named, aliased, namespace member, namespace destructure, dynamic import() and require() forms.
9. README local-development section; run typecheck, lint, test, format:check, and a real emulator round trip.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and verified against a live emulator.

Files: firebase.json, .firebaserc, .env.development, .env.example, lib/firebase/admin.ts, lib/firebase/client.ts, scripts/seed-emulator.mjs, eslint-rules/index.mjs (+ tests), eslint.config.mjs, package.json, .gitignore, README.md.

## Verification

- Emulator round trip: 'firebase emulators:exec' + seed writes wheel, suggestions and wheelSecrets.
- Admin module under --conditions=react-server: initialises with no credential, writes and reads back.
- Client module in a browser-shaped graph: reads the seeded wheel and a suggestion subcollection doc, and onSnapshot delivered a live Admin SDK write. That is the whole reason this app is on Firestore, so it was worth proving rather than assuming.
- Guards proven to fire, not just present: admin module imported from a Client Component fails the build ('server-only' cannot be imported from a Client Component module); client module imported from a route handler fails the build ('client-only' cannot be imported from a Server Component module); a real client component calling setDoc/arrayUnion errors under the new lint rule while doc() does not.
- npm run dev:emulator serves / and /w/{shareId} at 200 with the emulator UI up.
- lint, typecheck, format:check clean; npm test 38 pass.

## Departures from the plan, and why

firebase-tools pinned to 14.18.0, not latest. 14.19.0 raised the emulator Java floor from 11 to 21 (MIN_SUPPORTED_JAVA_MAJOR_VERSION, a hard throw before any emulator starts). This machine has JDK 17 and 11. The Firebase install-and-configure docs still claim Java 11+, which has been wrong since October 2025. User chose the pin over installing a JDK 21. Documented in the README so the next bump is a deliberate decision with a CI setup-java step, not an incidental one.

Emulator UI moved off Firebase's default port 4000 to 4001 — 4000 was occupied on this machine and the emulator treats the clash as a hard startup failure rather than falling back.

server-only and client-only added as direct dependencies. server-only was not installed at all and client-only was only present transitively via styled-jsx. Worth noting that tsc does not catch this: typecheck passed with server-only missing entirely, and only next build failed. A bare side-effect import is not the safety net it looks like.

Env shape: .env.development is committed rather than expecting a copy of .env.example. Every local value is a secret-free constant, so a fresh clone runs with no setup step at all, which is the point of decision 19. .env.example still documents the full set including the deployed-only variables.

## Bug the verification caught

normalizePrivateKey called raw.trim(), which silently ate the trailing newline of a real-newline-form PEM key — the same class of quiet mangling the function exists to undo, and it would have hit exactly the Vercel-paste path AC #6 is about. Now strips whitespace only from outside surrounding quotes. Both storage forms are asserted.

## Left for other tasks

firebase.json has no firestore.rules key, so the emulator runs open and warns on startup — TASK-6 adds the rules file and the @firebase/rules-unit-testing suite, and will need Java in CI.

## Post-review fixes

Code review found six issues; five were real and are fixed, one I disagreed with and left with the reasoning recorded in the code. All confirmed by reproduction before fixing, and all covered by new tests — the suite went from 38 to 51.

1. npm run seed could never work standalone. Plain 'node scripts/seed-emulator.mjs' loads no env file, so FIRESTORE_EMULATOR_HOST was unset and the safety guard refused to run — while the README advertised the command as 'reseed a running emulator'. It only worked inside dev:emulator, where emulators:exec injects the variable. Now runs with --env-file=.env.development --env-file-if-exists=.env.local. Verified: node's --env-file does not override an already-set shell variable, so the emulators:exec value still wins inside dev:emulator, and later --env-file entries beat earlier ones, matching Next's precedence. That also fixes the knock-on the reviewer spotted: a .env.local project-id override now reaches the seed script, so seed and app can no longer target different projects under singleProjectMode.

2. require-nodejs-runtime went blind exactly where this task gave it something to guard. Its trigger only matched a direct firebase-admin import, so once lib/firebase/admin.ts became the canonical indirection, any route segment importing the wrapper was silently exempt — including app/w/[shareId]/page.tsx and opengraph-image.tsx, the server-reading segments the design doc plans for. The wrapper is now recognised by path suffix, so both the @/ alias and relative spellings count.

3. no-client-firestore-writes was bypassable by re-export. 'export { setDoc } from ...' and 'export * from ...' both reported nothing, which is the worst case rather than a marginal one: a barrel puts a write one import away while guaranteeing nothing downstream ever mentions firebase/firestore again. Both forms now report, export * with its own message since it names no specific write. Also closed: a namespace laundered through a chain of local consts (const g = fs; const h = g), handled with a worklist so it is the chain being followed rather than one hop special-cased, and the internal @firebase/firestore spelling, which resolves and works.

4. The client SDK split the emulator host on the first colon with no validation. connectFirestoreEmulator(db, host, NaN) does not throw — it produces a client that quietly never reaches the emulator, which reads as an empty database. Since .env.local is explicitly invited to override this value, 'localhost' with no port is a plausible typo. Now splits on the last colon and rejects a non-integer or out-of-range port with a message naming the variable. Verified against the emulator: five malformed forms rejected, [::1]:8080 no longer torn in half, real reads unaffected.

5. Disagreed and did not change: the reviewer wanted cache.db set before connectFirestoreEmulator, so a throw would not leave every subsequent call throwing. Caching first would hand the next caller a working-looking client aimed at the wrong Firestore. A loud repeated error is the better failure here, so the behaviour stands, with a comment saying so and the throw wrapped in a message that names the actual cause.

Not fixed by design: the reviewer noted the new rule will block TASK-6's @firebase/rules-unit-testing suite, which must import client writes to assert they fail. True, but a config override matching a directory that does not exist yet is dead config, so it is a comment on TASK-6 instead.

Re-verified after the changes: 51 tests pass, lint, typecheck, format:check and next build clean, npm run seed works standalone against a running emulator, client SDK still reads the seeded fixture.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 17:21
---
Flagging an ambiguity in AC #5 rather than silently reinterpreting it: it asks that local dev point at a separate project "via one environment variable", but the dev and prod projects need different service accounts as well as different project IDs, so in practice it is a set of variables that changes together, not one switch. The conventional shape is per-environment env files — .env.local locally, per-environment variables in Vercel — with no selector variable at all, since a selector would mean shipping both projects' credentials everywhere and choosing at runtime, which is worse.

I read AC #5 as intent rather than literal wording and plan to satisfy it that way. Say so if you actually want a single FIREBASE_ENV-style switch and I will reword the criterion instead.
---

author: @claude
created: 2026-08-07 17:53
---
Decision: local dev uses the Firebase Emulator Suite. Task rewritten around it.

Two consequences worth noting outside this task:

TASK-6 gets materially better. Rules against a live project can only be checked by hand; against the emulator they are unit-testable with @firebase/rules-unit-testing on every change. Since design doc section 5 makes rules the whole security model, that moves them from "reviewed once" to "verified continuously". Commented on TASK-6 separately.

TASK-25 is where the credentials get handled, and now the only place. With the emulator local, the service account never needs to exist on a developer machine — it goes from the console straight into Vercel.

One thing the emulator does not solve: Vercel preview deploys run in the cloud and cannot reach a local emulator, so a second cloud project is still wanted for previews unless previews should write to production. Part A therefore still asks for two projects, just not three.
---

author: @claude
created: 2026-08-07 18:12
---
Split, per the decision to let the emulator work land first. The console half is now TASK-27, "Provision the Firebase cloud projects", and this task keeps the emulator setup, both SDK modules, .env.example and the new lint rule.

The two are genuinely independent: this task needs no Firebase account, project or credential to be built, run or reviewed. Earlier comments on this task refer to "Part A" — that content moved wholesale to TASK-27.

The lint rule is approved and is now item 10 of the plan rather than a proposal: spinnerly/no-client-firestore-writes, same shape as the existing runtime-invariant rules.
---

author: @claude
created: 2026-08-07 18:42
---
firebase-tools is pinned to 14.18.0 rather than 15.x, and it is worth knowing why before someone bumps it.

14.19.0 raised the emulator's Java floor from 11 to 21 — MIN_SUPPORTED_JAVA_MAJOR_VERSION in lib/emulator/commandUtils.js, thrown before any emulator starts. The task description says 'Verified on this machine: Java 17 is present, which the emulator requires', which was true when written; the Firebase install-and-configure docs still say Java 11+ and have been wrong since October 2025.

So the bump is not a version bump, it is an everyone-installs-a-new-JDK bump, plus a setup-java step in CI. TASK-6 is the natural place to do it deliberately, since its rules tests need Java in CI anyway.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Wired both halves of the design doc section 3 split against the Firebase Emulator Suite, with no cloud project and no service account on the machine.

Server: lib/firebase/admin.ts, a lazy Admin SDK singleton cached on globalThis so it survives hot reload and warm lambda reuse. When FIRESTORE_EMULATOR_HOST is set it initialises with no credential at all; otherwise it builds one from the service account variables, normalising the private key so both escaped-backslash-n and Vercel's real newlines work unchanged.

Client: lib/firebase/client.ts, a read-only handle whose connectFirestoreEmulator call happens inside the same lazy init that creates the instance, so no caller can obtain an unconnected one.

The 'client never writes' invariant is enforced three ways rather than asserted once — security rules (TASK-6), the new spinnerly/no-client-firestore-writes lint rule, and the module exporting nothing that writes. The rule handles aliased imports, namespace member access including the computed form, destructuring off a namespace, await import() with no binding, and require().

Local setup is zero-step: .env.development is committed because every emulator value is a secret-free constant, and npm run dev:emulator starts the emulator, seeds a wheel and runs the dev server.

Verified against a live emulator, not just compiled: the client SDK read an Admin SDK write back, onSnapshot delivered a live update, and each guard was proven to fail the build or the lint when violated. That verification caught a real bug — normalizePrivateKey was trimming the trailing newline off a real-newline PEM key, the exact Vercel-paste case AC #6 covers.

Two deliberate deviations: firebase-tools is pinned to 14.18.0 because 14.19.0 raised the emulator's Java floor to 21 and this machine runs JDK 17, and the emulator UI sits on port 4001 because 4000 was taken and the clash is a hard startup failure. Both documented in the README.
<!-- SECTION:FINAL_SUMMARY:END -->
