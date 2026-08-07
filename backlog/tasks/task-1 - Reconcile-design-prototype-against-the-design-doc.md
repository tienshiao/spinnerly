---
id: TASK-1
title: Answer the two open questions in design doc section 11
status: To Do
assignee: []
created_date: '2026-08-07 08:34'
updated_date: '2026-08-07 08:54'
labels: []
dependencies: []
documentation:
  - docs/spin-the-wheel-design.md
  - docs/spin-the-wheel-editor/README.md
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All prototype-versus-doc gaps are resolved as decisions 10 to 17 in design doc section 10, and duplicate title handling is settled (decision 17). Two questions remain in section 11. Neither blocks implementation.

1. What goes in the OG image, given it will be cached stale? The doc leans title plus option count plus a decorative wheel rather than the live option list. Slack and Twitter cache aggressively, the share URL is the cache key, and it is the thing people paste, so cache-busting is not available. TASK-23 is already built around staleness-robustness, so confirming this leaning costs nothing and contradicting it costs a rework. Decision 17 reinforces it: forks share a title, so the image was never going to be a reliable identifier.

2. Do we notify participants that a wheel is near expiry? There is no channel to reach them and no accounts, so there is no mechanism short of inventing one. The doc leans no, with the duplicate flow as the mitigation. Worth writing down explicitly rather than leaving as an unexamined omission, because a wheel silently vanishing after 30 days is the kind of thing that reads as data loss to the group that was using it.

The remaining section 11 question, on Vercel Firewall rate limiting, is owned by TASK-25 and should be answered there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each of the seven gaps above has a written decision recorded as a Backlog decision or in the design doc
- [ ] #2 Design doc section 6 API table reflects any endpoint added or removed by these decisions
- [ ] #3 Design doc section 4 data model reflects any field added by these decisions
- [ ] #4 Design doc section 11 remaining questions 1, 2 and 3 are answered or explicitly deferred with a reason
- [ ] #5 If persisted, the data model in section 4 and the API table in section 6 are updated to match
- [ ] #6 Placement for title editing, the suggestionsOpen kill switch and duplicate is decided and recorded
- [ ] #7 Design doc section 11 questions 5 and 6 are struck once answered
- [ ] #8 Design doc section 11 questions 1, 2 and 3 are answered or explicitly deferred with a reason
- [ ] #9 The Picked chip is decided as local-only or persisted, and recorded in the design doc
- [ ] #10 Duplicate title handling is decided and recorded, and TASK-13 matches it
- [ ] #11 Expiry notification is decided or explicitly declined with a written reason
- [ ] #12 Design doc section 11 is emptied or reduced to genuinely open items
- [ ] #13 OG image content is decided and recorded in the design doc, and TASK-23 matches it
- [ ] #14 Expiry notification is decided or explicitly declined with a written reason
- [ ] #15 Design doc section 11 is reduced to genuinely open items
- [ ] #16 OG image content is decided and recorded in the design doc, and TASK-23 matches it
<!-- AC:END -->
