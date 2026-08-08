---
id: TASK-27
title: Provision the Firebase cloud projects
status: To Do
assignee: []
created_date: '2026-08-07 18:09'
updated_date: '2026-08-08 09:08'
labels: []
dependencies: []
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 5500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the two Firebase cloud projects that deployed environments run against. This is console work — nothing here can be scripted from the repo, and none of it is needed to develop locally.

Split out of TASK-5. Local development runs on the Firebase Emulator Suite (design doc decision 19), so the SDK wiring, the emulator setup and the whole local workflow have no dependency on any of this. TASK-5 can be built, run and reviewed before this task starts. This exists because Vercel preview deploys run in the cloud and cannot reach a laptop's emulator.

Two projects, not one, so that preview deploys cannot write production data.

## Steps

1. Create two Firebase projects, e.g. spinnerly-prod and spinnerly-preview.

2. In each, create the Firestore database. Both of these are PERMANENT and cannot be changed without recreating the project — see design doc decision 18:

   - Mode: Native mode, not Datastore mode. Datastore mode has no onSnapshot, which is the entire reason this design is on Firestore.
   - Location: us-east1. Pairs with Vercel's iad1 default, keeping the write hop short.

3. In each, register a Web app (the </> icon in project settings) to get the public web config: apiKey, projectId, appId. These are safe to expose — they identify the project rather than granting access. Access is controlled by the rules in TASK-6.

4. In each, generate a service account key: Project settings, Service accounts, Generate new private key. This is a real credential that bypasses security rules entirely.

5. Do not enable App Check. That is TASK-24, deliberately kept separate so the client is not being debugged alongside it.

## Where the credentials go

Straight from the console into the Vercel dashboard, in TASK-25. They should never touch a developer machine, never be committed, and never be pasted into chat or a pull request description — the emulator means local work needs none of them, so the only handling is that one transfer.

Delete the downloaded JSON once the values are in Vercel.

Vercel scoping: the prod project's values against the Production environment, the preview project's against Preview and Development, so a preview deploy cannot reach production data.

## Rules deployment

The security rules authored and tested in TASK-6 need deploying to both projects. TASK-6 can be written and unit-tested against the emulator without this task, but cannot be deployed until these projects exist.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two Firebase projects exist, one for production and one that Vercel preview deploys point at
- [ ] #2 Firestore is created in Native mode and in us-east1 in both projects
- [ ] #3 A Web app is registered in each project, yielding apiKey, projectId and appId
- [ ] #4 A service account key exists for each project and is present only in the Vercel dashboard — not in the repository, not in any committed file, and not on a developer machine
- [ ] #5 App Check is left disabled, so that enabling it stays a single reviewable change in TASK-24
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 18:11
---
The "Dependencies: TASK-5" line on this task is a mistake I could not undo. It is ordering, not a block — this is pure console work and can be done at any time, including before TASK-5 starts or in parallel with it. Nothing in TASK-5 needs to exist first.

I set it while splitting the two tasks apart and then found the backlog CLI has no option to clear dependencies once set (there is --remove-ac and --clear-milestone, but no equivalent for --depends-on), and the project convention is not to hand-edit the task markdown. Flagging it rather than working around the convention.
---

author: @claude
created: 2026-08-07 18:18
---
Resolved — the stray TASK-5 dependency is gone. Removed by hand-editing the frontmatter, with the user's explicit approval to depart from the CLI-only convention for this one case, since the CLI has no option to clear dependencies. Verified afterwards that the CLI still parses and round-trips the file.

This task blocks on nothing. It is console work and can be done at any time, in parallel with TASK-5.
---

author: @claude
created: 2026-08-08 09:08
---
From TASK-14: after step 2 creates each Firestore database, and before that environment takes any real data, apply the TTL policies:

    GOOGLE_APPLICATION_CREDENTIALS=<the JSON from step 4> npm run ttl:configure -- --project <projectId>
    npm run ttl:check -- --project <projectId>     # until all three report ACTIVE

Once per project, so twice. The script covers three collection groups — wheels, wheelSecrets and suggestions — because a TTL delete does not cascade to subcollections and because a secret outliving its wheel leaves a live, publicly suggestable wheel whose owner has permanently lost the kill switch.

This is the step TASK-14 could not do: TTL is a cloud-only feature, the emulator serves no field-configuration API, and there was no project to apply anything to. It is also the one that fails silently if skipped — nothing in the application depends on a policy existing, so wheels keep working and simply never go away. TASK-14's AC 2 stays unchecked until this runs.
---
<!-- COMMENTS:END -->
