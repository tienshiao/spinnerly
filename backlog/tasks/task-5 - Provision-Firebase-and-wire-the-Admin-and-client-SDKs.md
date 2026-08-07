---
id: TASK-5
title: Provision Firebase and wire the Admin and client SDKs
status: To Do
assignee: []
created_date: '2026-08-07 08:36'
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
Create the Firebase project and Firestore database, and wire both halves of the split described in design doc section 3: writes go through server route handlers using the Admin SDK, reads go direct from the browser using the client SDK.

Server side: firebase-admin initialised once per lambda from a service account in environment variables, never from a checked-in key file. Must be lazily initialised so it survives Next.js hot reload and serverless reuse.

Client side: the modular Firebase JS SDK configured with the public web config, used only for onSnapshot reads. The client must never be given a write path.

Environments: at minimum a local/dev project and a production project, selected by environment variable, so preview deploys never write to production data.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 firebase-admin initialises from environment variables and is reused across invocations within a warm lambda
- [ ] #2 The client SDK config is public-safe and contains no service account material
- [ ] #3 The service account private key is absent from the repository and from any committed env file
- [ ] #4 A documented .env.example lists every required variable
- [ ] #5 Local development can point at a separate Firebase project from production via one environment variable
<!-- AC:END -->
