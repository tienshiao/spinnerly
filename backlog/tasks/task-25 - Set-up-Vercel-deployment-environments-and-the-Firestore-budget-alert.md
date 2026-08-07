---
id: TASK-25
title: 'Set up Vercel deployment, environments and the Firestore budget alert'
status: To Do
assignee: []
created_date: '2026-08-07 08:40'
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
- [ ] #3 A GCP budget alert on the Firestore project is configured and delivers to a monitored address
- [ ] #4 Whether Vercel Firewall rate limiting is available on the current plan is checked and the finding recorded in the design doc
- [ ] #5 The service account key is stored only as a Vercel environment secret
<!-- AC:END -->
