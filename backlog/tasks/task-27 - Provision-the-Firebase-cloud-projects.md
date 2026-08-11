---
id: TASK-27
title: Provision the Firebase cloud projects
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-07 18:09'
updated_date: '2026-08-11 17:40'
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
- [x] #1 Two Firebase projects exist, one for production and one that Vercel preview deploys point at
- [x] #2 Firestore is created in Native mode and in us-east1 in both projects
- [x] #3 A Web app is registered in each project, yielding apiKey, projectId and appId
- [ ] #4 A service account key exists for each project and is present only in the Vercel dashboard — not in the repository, not in any committed file, and not on a developer machine
- [x] #5 App Check is left disabled, so that enabling it stays a single reviewable change in TASK-24
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Authenticate as tienshiao@gmail.com (user, interactive): npx firebase login, gcloud auth login, gcloud auth application-default login.
2. Create both projects with firebase projects:create. Project IDs are globally unique across all of GCP, so confirm the chosen pair is available and record what was actually taken.
3. Create the (default) Firestore database in each: --location us-east1, standard edition. firebase-tools only creates Native mode, so AC 2 is satisfied by construction; verify with firestore:databases:get.
4. Register a Web app in each with apps:create web, then read apiKey and appId with apps:sdkconfig. These go to Vercel in TASK-25 and are never committed.
5. Apply the TTL policies with npm run ttl:configure against each project, then npm run ttl:check until all three collection groups report ACTIVE. Authenticate via application-default credentials rather than a downloaded key, so no service-account JSON is created for this step.
6. Add prod and preview aliases to .firebaserc, keeping demo-spinnerly as default so the emulator workflow is unchanged.
7. Confirm App Check is disabled in both projects (AC 5).
8. Service-account keys are deliberately NOT generated here. A key is a real credential that bypasses rules entirely, and generating it now leaves it on disk until TASK-25 pastes it into Vercel. Generate each key at that moment instead. AC 4 stays unchecked until then.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Provisioning blocked partway through step 2. The GCP project spinnerly-prod exists (project number 751382100704, owner tienshiao@gmail.com, firebase.googleapis.com enabled), but the :addFirebase call returns a bare 403 PERMISSION_DENIED, so it is a plain GCP project and not yet a Firebase one. spinnerly-preview was not attempted.

Ruled out by inspection: IAM (the account holds roles/owner) and API enablement (firebase.googleapis.com is listed as enabled). The remaining cause is that this Google account has never accepted the Firebase Terms of Service - projects:list reports no projects at all - and the addFirebase endpoint reports that state as an undifferentiated permission error. There is no CLI path to accepting the terms.

Correction to the task description for whoever reads it next: the claim that nothing here can be scripted from the repo is too strong. firebase-tools 14.18.0 is already a devDependency and covers projects:create, firestore:databases:create, apps:create and apps:sdkconfig. What genuinely requires the console is the one-time Terms of Service acceptance on a Google account that has never used Firebase. Once that is done, the rest of the provisioning runs from the CLI.

Provisioning complete except for TTL and the service-account keys.

Created, both on the CLI once the Terms of Service were accepted in the console:
  spinnerly-prod     project number 751382100704   web app 1:751382100704:web:e86e980c7399a41d99ee85
  spinnerly-preview  project number 1038961096249  web app 1:1038961096249:web:88209abee21fdad87c3fe8

Both databases verified FIRESTORE_NATIVE, STANDARD edition, us-east1. App Check confirmed disabled on both - the firebaseappcheck API is not enabled, so TASK-24 stays a single reviewable change. .firebaserc gained prod and preview aliases, with demo-spinnerly kept as default so the emulator workflow is unchanged.

BLOCKED: TTL policies cannot be applied. Firestore TTL is a Blaze feature, and both projects are on Spark with no billing account, so all six collection-group policies failed with 403 billing disabled. The script reported the failure correctly and did not claim success. This also blocks TASK-14 AC 2, and TASK-25 AC 3 will need the same billing account for its budget alert - so attaching billing is a prerequisite shared by three tasks rather than a detail of this one.

Google Analytics was enabled on spinnerly-prod during the console step. Harmless: lib/firebase/client.ts imports only firebase/app and firebase/firestore, so the Analytics SDK never initialises and no data is collected. Left in place rather than unlinked.

Decision: TTL is applied to spinnerly-prod only. spinnerly-preview stays on Spark with no TTL policy.

Forced by a quota rather than chosen freely. The billing account 01BB47-670E50-3AB967 caps at five linked projects, the standard self-serve limit, and all five slots were taken by earlier work. Unlinking rss-manual freed exactly one, and it went to prod.

Why this is acceptable rather than merely tolerated. Nothing in the application depends on a TTL policy existing - the script docstring says so directly - so a preview environment without one behaves identically to prod in every way a test could observe. Design doc section 8 also rules out storage cost as a reason for TTL, so the saving was never the point. What preview loses is reaping: its wheels accumulate indefinitely. For a throwaway environment holding only test data that is negligible, and the database can be wiped by hand.

What it costs, stated so nobody rediscovers it as a bug. Preview will never demonstrate that expiry works end to end, so the reaping behaviour is exercised in prod first. If that becomes unacceptable, the fix is to free a second billing slot or ask Google to raise the cap on the billing account.

Trap worth knowing before running ttl:configure against any new project: the Firestore Admin API reported 403 billing disabled for spinnerly-prod while gcloud billing projects describe reported billingEnabled true for the same project. The contradiction was not propagation lag, and waiting did not clear it.

Cause: the application default credentials had no quota project set. gcloud auth application-default login does not set one, and with it unset the client library attributes the call elsewhere - here the stale gcloud default project bc-nonprod-roc-1a1c, left over from a different account. The API then answered about billing on that project while naming spinnerly-prod in the message, which is what makes the error actively misleading.

Fix, and it took effect immediately:

  gcloud auth application-default set-quota-project spinnerly-prod

Anyone applying TTL to a second project - preview, if a billing slot is ever freed - has to repeat this for that project, or see the same false billing error.

TTL now ACTIVE on spinnerly-prod for wheels, wheelSecrets and suggestions, after setting the ADC quota project. Rules deployed to both projects. TASK-6 and TASK-14 are closed as a result.

Remaining on this task: AC 4 only, the service-account keys, deliberately deferred to the moment they are pasted into Vercel in TASK-25 so that a credential which bypasses security rules entirely never sits on a developer machine waiting for that step. Generate one per project then, with gcloud iam service-accounts keys create or the console, paste into Vercel scoped Production for prod and Preview plus Development for preview, and delete the local JSON immediately.

Validation: npm test green at 1071 tests across 35 files. The only repository change from this task is the .firebaserc aliases.

AC 4 revisited now that Vercel is configured, and it stays unchecked on both halves.

The prod key was generated and its values are in the Vercel dashboard, but the downloaded JSON is still on the developer machine at ~/Downloads/spinnerly-prod-firebase-adminsdk-fbsvc-0d16c6f60e.json. The AC is written as 'present only in the Vercel dashboard - not in the repository, not in any committed file, and not on a developer machine', and the third clause is the one that fails. Delete it and that half is met; the repository half is verified clean.

No key exists for spinnerly-preview at all, because no preview environment has been configured yet. That is TASK-25's remaining work and this AC cannot close ahead of it.

Nothing about the deferral in step 8 of the plan turned out wrong - the key went from console to dashboard without ever being needed locally. What it did not cover is the step after: the plan says to delete the local JSON immediately and that deletion has not happened, which is the whole reason a deferral was worth arranging.

Half of AC 4 is now met. The prod key's values are in Vercel's Production scope, proven working by five authenticated writes against production Firestore, and the downloaded JSON has been deleted from ~/Downloads. Nothing credential-shaped is tracked in the repository. For spinnerly-prod the AC now reads true on all three clauses.

It stays unchecked because it says 'for each project'. spinnerly-preview has no service account key at all, and generating one before there is a preview environment to paste it into would recreate exactly the situation step 8 of the plan was written to avoid - a credential that bypasses security rules sitting on a machine, waiting. Generate it at the moment the preview scope is configured in TASK-25, not before.
<!-- SECTION:NOTES:END -->

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

author: @claude
created: 2026-08-08 10:16
---
From TASK-6: the security rules need deploying to each project, and they must go BEFORE the first deploy of application code that reads Firestore from the browser.

    npm run rules:deploy -- --project <projectId>     # once per project, so twice

Ordering matters and only one order is safe. A client reading a path the deployed rules do not yet permit fails with permission-denied, which presents as a wheel page that renders and then stays empty — not as an obvious error. Rules that permit more than any client currently reads are inert, so deploying them early costs nothing.

Do this alongside the TTL step in comment #3; both are once-per-project commands against a database that has not taken real data yet. TASK-6's AC 1 stays unchecked until this runs.

Note the rules are already enforced locally — firebase.json points at firestore.rules — so a browser read that works against the emulator is being checked against the same policy that will be deployed here. Deploying is the only remaining gap, not verifying.
---
<!-- COMMENTS:END -->
