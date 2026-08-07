---
id: TASK-5
title: Wire the Firebase SDKs against the local emulator
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
updated_date: '2026-08-07 18:12'
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
- [ ] #1 firebase-admin initialises from environment variables and is reused across invocations within a warm lambda
- [ ] #2 The client SDK config is public-safe and contains no service account material
- [ ] #3 The service account private key is absent from the repository and from any committed env file
- [ ] #4 A documented .env.example lists every required variable
- [ ] #5 Local development can point at a separate Firebase project from production via one environment variable
- [ ] #6 The private key survives both storage forms — escaped backslash-n in a local env file and real newlines pasted into Vercel — without a code change
- [ ] #7 The client SDK module exports no write capability, and importing a Firestore write function from client code fails lint
- [ ] #8 Local development runs entirely against the Firebase Emulator Suite with no cloud project and no service account present on the machine
- [ ] #9 The local Firestore project id uses the demo- prefix, so a misconfiguration cannot reach a real project
- [ ] #10 firebase-tools is a pinned devDependency, not a global install
<!-- AC:END -->

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
<!-- COMMENTS:END -->
