---
id: TASK-25
title: 'Set up Vercel deployment, environments and the Firestore budget alert'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-07 08:40'
updated_date: '2026-08-11 17:42'
labels: []
dependencies:
  - TASK-2
  - TASK-5
documentation:
  - docs/spin-the-wheel-design.md
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ship it. Vercel is the hosting decision (design doc section 10, decision 8), chosen for zero-config Next.js deploys, nodejs as the default runtime, and free preview deployments. Write volume is a handful of small documents per lunch decision, so the cross-cloud hop from Vercel to Firestore in GCP is a weak constraint that does not justify operating a Cloud Run service.

Accepted cost: cold starts. The first request after a quiet period stalls a second or two, and Vercel has no always-warm option comparable to the Cloud Run min-instances setting. This is accepted rather than mitigated, which is why TASK-15 has to make pending writes feel deliberate.

Set the Firestore budget alert. This is the tripwire. With rate limiting deferred out of v1, the budget alert is the mechanism by which anyone finds out that the deferral has stopped being safe. It is not optional.

While here, check whether Vercel Firewall rate limiting is available on the current plan (design doc section 11 question 4). If it is, it closes the deferred gap in section 7 with no Redis and no application code, which makes it the cheapest available answer by a wide margin. Record the finding either way.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Production and preview deploys both build and run, with preview pointing at a non-production Firebase project
- [ ] #2 Every required environment variable is set in Vercel and documented in .env.example
- [x] #3 A GCP budget alert on the Firestore project is configured and delivers to a monitored address
- [x] #4 Whether Vercel Firewall rate limiting is available on the current plan is checked and the finding recorded in the design doc
- [x] #5 The service account key is stored only as a Vercel environment secret
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC 3 done. Budget 2f1ecbee-a6d9-40e0-b7e8-3c0471c47337 on billing account 01BB47-670E50-3AB967, display name Spinnerly Firestore tripwire, 5 USD per calendar month, thresholds at 50, 90 and 100 percent of current spend.

Scoped with --filter-projects to projects/751382100704, which is spinnerly-prod alone. This matters: a budget defaults to the whole billing account, and four unrelated projects share this one, so an unscoped budget would fire for spend that has nothing to do with Spinnerly and the tripwire would be trained away as noise within a month.

notificationsRule is empty, which means default IAM recipients - billing account administrators and users - receive the email. That is tienshiao@gmail.com. Worth stating plainly: configuration is verified, delivery is not, and cannot be until a threshold actually trips.

AC 4 done. Vercel WAF rate limiting is available on ALL plans including Hobby, so the answer to the open question is yes. Recorded in the design doc in three places: section 11 question 3, the section 7 bullet, and decision row 9.

Numbering correction: this task and the design doc disagree. The task calls it section 11 question 4; the doc has three questions and this is question 3.

Hobby terms: one rate-limit rule per project, IP or JA4 digest keys, fixed window only, 10s to 10min, 1,000,000 allowed requests included. Two properties recorded because they change how a rule should be written - counters are per region, so a distributed source can exceed the configured limit by a multiple of the regions it reaches; and rate-limited traffic incurs neither CDN Requests nor Fast Data Transfer, making a rule a cost control as well as an abuse one.

No rule is configured. That is deliberately outside this task - the AC asks for the finding to be recorded, not for the gap to be closed.

Production is live at https://www.spinnerly.fyi. Verified from outside: the landing page serves prerendered HTML with the full openGraph and twitter tag sets intact (card: summary_large_image present, so the group-replacement trap the notes warn about has not been reintroduced); /opengraph-image returns a 1200x630 PNG; robots.txt serves both groups, the named unfurlers allowed and /w/ plus /api/ disallowed for *; the apex 308-redirects to www. The marketing card renders with Caprasimo and Figtree both correct, which is the one thing that could only be checked after a deploy - it proves outputFileTracingIncludes carried the ttf files into the bundle, whose failure mode is a card in a fallback face rather than a build error.

AC 1 stays open on its second half. Only Production is deployed and only the Production env scope is populated; no preview deployment has been exercised and spinnerly-preview's values are not in the dashboard. A preview build would reach admin.ts's required() and throw on FIREBASE_PROJECT_ID at the first route that touches Firestore, so this is not a latent 'probably fine' - it is a preview environment that cannot run.

AC 2 stays open, and not only for the preview scope. NEXT_PUBLIC_SITE_URL is unset in Production, and the deployed site is advertising its cards at https://spinnerly-eight.vercel.app rather than the domain people paste. Both hosts serve the image today, so nothing is visibly broken.

Why it still has to be fixed before anyone pastes a link anywhere: an unfurl is cached against the share URL and never re-fetched, so the vercel.app image URL baked into a cached card is permanent for that link. It survives exactly as long as that hostname does, and renaming the Vercel project retires it - at which point old cards lose their picture with no cache-busting move available. The ordering that follows is that TASK-23 AC 7's Slack paste must come after this is fixed, or the verification itself caches the wrong-host card for the URL it tests.

Worth noting the cause may be staleness rather than misconfiguration: the landing page is prerendered, VERCEL_PROJECT_PRODUCTION_URL prefers a custom production domain when one is attached, and this build predates the domain. A redeploy alone might correct it. Setting NEXT_PUBLIC_SITE_URL explicitly is still the right fix, for a reason the redeploy would not settle - that variable prefers the SHORTEST custom production domain, which here is the apex spinnerly.fyi, and the apex 308s to www. Cards would then advertise an image URL one redirect away from its bytes, on the fetch least worth making fragile.

AC 5 stays open: the prod service account JSON is still on disk at ~/Downloads/spinnerly-prod-firebase-adminsdk-fbsvc-0d16c6f60e.json. The repository is clean - nothing credential-shaped is tracked, and .gitignore covers .env* with only .env.example and .env.development opted back in - so this is the download, not a leak into the tree.

Production proven end to end against real Firestore, which nothing before this had established - the landing page and the marketing card are both prerendered, and a missing wheel falls back to the generic card whether the credentials work or not, so no read could distinguish a working service account from a broken one. A write can. POST /api/wheels returned 201, and five authenticated POSTs to the options route returned 201 each, so the credentials pasted into the Production scope authenticate, the Admin SDK initialises on a real lambda, and the bearer-token authorization path works deployed. Test wheel jeh02FU7nO2q3ZwcudSZ, which TTL-reaps on its own.

AC 5 met and checked: ~/Downloads/spinnerly-prod-firebase-adminsdk-fbsvc-0d16c6f60e.json deleted, after the writes above confirmed the values in Vercel were good. Deliberately in that order - the key cannot be re-downloaded, only regenerated, so deleting it before the credentials were exercised would have traded a small exposure for a real chance of locking production out of its own database.

AC 1 and AC 2 stand as recorded above: production only, and NEXT_PUBLIC_SITE_URL still unset.

NEXT_PUBLIC_SITE_URL set on the Production scope and redeployed. Verified: og:image and twitter:image on both the landing page and a real wheel page now name https://www.spinnerly.fyi, both card URLs return 1200x630 PNGs on that host, and the landing prerender regenerated rather than being served stale. The vercel.app host disappears from the emitted tags entirely, since an explicit override wins over VERCEL_PROJECT_PRODUCTION_URL in lib/site.ts.

One thing to preserve when the Preview scope is configured, because it is the same defect review finding 5 already fixed once in code: do NOT copy this variable into the Preview scope. It is set on Production only, which leaves siteUrl() falling back to VERCEL_URL on a preview build - the per-deployment host, which is what a preview should advertise. A production URL inherited into Preview would have every preview-created wheel advertise its card at https://www.spinnerly.fyi/w/{shareId}/opengraph-image, where that wheel does not exist, and the crawler would cache the generic card against the preview link.

AC 2 stays open on its remaining half only: the Preview scope is still empty.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude
created: 2026-08-07 17:54
---
From TASK-5: with the Firebase Emulator Suite handling local dev, this task is now the only place service account credentials are ever handled. They go from the Firebase console straight into the Vercel dashboard and never touch a developer machine.

Two env scopes to set, against two different Firebase projects: Production against the prod project, Preview against the preview project, so preview deploys cannot write production data. The emulator does not cover previews — they run in the cloud and cannot reach a local emulator.

Note the private key format trap when doing this: Vercel's dashboard accepts real newlines, while a local .env file needs them escaped. TASK-5 makes the code accept both, but be aware that copying a value between the two by hand will otherwise break it.
---
<!-- COMMENTS:END -->
