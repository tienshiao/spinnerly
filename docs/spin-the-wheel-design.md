# Spin the Wheel — Design Doc

**Status:** Draft
**Last updated:** 2026-08-06

---

## 1. Overview

A lightweight web app for group decision-making. One person creates a wheel of
options, shares a link, friends suggest additions, the creator curates the list
and spins.

Canonical use case: a group deciding where to eat.

### Design principles

- **No accounts.** Creating a wheel takes one click. Access is by URL, not login.
- **Small surface area.** Edit the list, spin the wheel. Everything else is
  phase 2 or never.
- **Ephemeral by default.** Wheels are disposable artifacts, not saved documents.
- **Responsive, and mobile-first for participants.** The share link gets pasted
  into a group chat, so most participants arrive on a phone. The participant
  view is a mobile surface that also works on desktop, not the reverse.

### Non-goals (v1)

- User accounts, profiles, wheel history
- Synchronized/live spins (phase 2)
- Chat (phase 2)
- Weighted options, elimination mode, multi-round tournaments

---

## 2. Roles and access

| Role             | Has                        | Can                                                       |
| ---------------- | -------------------------- | --------------------------------------------------------- |
| **Owner/editor** | Edit URL (contains secret) | Read wheel, edit options, accept/reject suggestions, spin |
| **Participant**  | Share URL                  | Read wheel, submit suggestions, watch                     |

Both roles are defined entirely by which URL you hold. There is no identity.

### URL structure

```
Edit:   https://example.app/w/{shareId}#e={editToken}
Share:  https://example.app/w/{shareId}
```

**The edit token lives in the URL fragment, not the path or query.** Fragments
are never sent to servers, so the token stays out of `Referer` headers,
access logs, analytics, and any error reporter added later.

`shareId` is an unguessable Firestore auto-ID (~120 bits). `editToken` is a
separately generated random string — knowing one must not reveal the other.

### Resolved: the edit URL is transferable

Anyone holding the edit token is an editor. The creator may hand it to a
co-organizer and both edit concurrently. There is no per-editor identity and no
concept of an owner distinct from an editor.

Consequence: **concurrent editors are a supported case, not an edge case.** See
§6 _Concurrent editors_ — a naive full-array `PATCH` is a lost-update bug under
this model.

---

## 3. Architecture

```
                  ┌──────────────────────────┐
                  │        Browser           │
                  └───────┬──────────┬───────┘
                          │          │
              writes      │          │   reads (onSnapshot)
       (HTTPS + Bearer)   │          │   direct, live
                          ▼          │
              ┌──────────────────┐   │
              │  Next.js         │   │
              │  route handlers  │   │
              │  Admin SDK       │   │
              └────────┬─────────┘   │
                       │             │
                       ▼             ▼
              ┌──────────────────────────┐
              │        Firestore         │
              │  client writes: DENIED   │
              │  client reads:  get only │
              └──────────────────────────┘
```

### The core decision

**Writes go through an API. Reads go direct to Firestore.**

- Every client write is denied at the rules layer. Clients cannot touch
  Firestore for mutation, period.
- Writes hit an HTTPS endpoint using the Admin SDK, which bypasses rules and
  performs its own authorization against the edit token.
- Reads stay as client-side `onSnapshot` listeners. This is the entire reason
  we're on Firestore — live updates for free, no websocket layer to build.

Routing reads through the API too would mean polling or hand-rolled websockets,
at which point Firestore buys us nothing over Postgres.

### What this gains

Everything security rules can't express: rate limiting, suggestion dedupe,
length/content filtering, atomic accept-and-remove, audit trail, and a
server-side RNG for phase-2 spins.

### What this costs

**Loss of latency compensation.** Firestore normally echoes a client's own write
to its local cache before the round trip, so edits feel instant. With writes
routed through an API, the path becomes client → API → Firestore → snapshot
back. The editor UI _must_ hold optimistic local state or editing will feel
laggy. This is the single most likely "why does this feel bad" regression.

**Cold starts.** The first request after a quiet period will stall by a second
or two on any serverless platform. Acceptable for suggestions; annoying for the
first edit. Vercel has no always-warm option comparable to Cloud Run's
`min-instances`, so this is accepted rather than mitigated.

### Stack: Next.js (App Router)

Both pages are simple and the API is six routes, so the framework's job is
mostly to give us server-rendered metadata and one deployment instead of two.
Route handlers replace the standalone write API; the Admin SDK runs in them
exactly as it would in Cloud Run.

**Runtime split:** the Firebase Admin SDK requires Node — it does not run on
edge. Set `runtime = 'nodejs'` on every route that touches Firestore. Don't
assume anything can be moved to edge later.

### Open Graph previews

**This is the main reason to use a framework at all.** Sharing _is_ the product,
and Slack, Discord, iMessage, and Twitter crawlers do not execute JavaScript. A
client-rendered SPA would show one identical generic preview for every wheel
ever created.

```
app/w/[shareId]/page.tsx              → generateMetadata(): title, description
app/w/[shareId]/opengraph-image.tsx   → ImageResponse, rendered per wheel
```

`next/og` renders JSX to PNG via Satori. Constraints to design around:

- **Flexbox only** — no grid, no float.
- Fonts must be explicitly fetched and passed in.
- Only a subset of CSS is supported.

A wheel graphic is arcs and text, so it's very doable — but write it as
inline-styled flex boxes or raw SVG. The app's React wheel component will not
render here.

**Unfurl caching is the real constraint.** Slack and Twitter cache OG images
aggressively and won't re-fetch when the wheel changes. The share URL is the
cache key and it's the thing people paste, so cache-busting isn't available.
**Design the image to be robust to staleness** — title, option count, decorative
wheel — rather than an exact render of the current option list.

### The edit page cannot be server-rendered

The edit token lives in the URL fragment (§2), which is never sent to the
server. The edit page must therefore be a client component that reads
`location.hash` on mount and then calls the API. Brief loading state, no SSR.

**Do not "fix" this by moving the token into a route segment**
(`/w/[id]/edit/[token]`). That puts it back in the request path and into every
server and platform log — exactly what the fragment placement avoids.

Free benefit: if someone pastes their _edit_ URL into Slack, the fragment is
stripped before Slack fetches the page. The unfurl is an ordinary share preview
and the token never reaches Slack's servers.

### Hosting

### Hosting: Vercel (decided)

Chosen for simplicity — zero-config Next.js deploys, `runtime = 'nodejs'` is the
default, and preview deployments come free. Write volume is a handful of small
documents per lunch decision, so the cross-cloud hop to Firestore in GCP is a
weak constraint that doesn't justify running our own Cloud Run service.

Alternatives considered:

| Option                          | Why not                                                                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cloud Run** (Next standalone) | Keeps the write path in-region and `min-instances=1` kills cold starts, but it's infrastructure to operate for a latency win we don't need. Revisit if write volume ever justifies it. |
| **Firebase App Hosting**        | Same region benefit, tighter Firebase integration, less mature.                                                                                                                        |
| **Cloudflare Workers**          | Ruled out — see below.                                                                                                                                                                 |

### Why not Cloudflare

`runtime = 'nodejs'` is _not_ the obstacle. The old `@cloudflare/next-on-pages`
adapter forced Edge runtime for everything; the current `@opennextjs/cloudflare`
adapter inverts that and expects the Node.js runtime, running Next in workerd
via the `nodejs_compat` layer. That part is fine.

**The blocker is `firebase-admin`.** Its Firestore client uses gRPC over native
bindings and raw sockets, which `nodejs_compat` cannot shim. This is a
long-standing, unresolved gap. The workaround is calling the Firestore REST API
directly with a WebCrypto-signed service-account JWT — viable for our write set
(create, patch, delete, one transaction via `:beginTransaction` / `:commit`) but
it means hand-rolling the data layer, and the unofficial wrapper libraries
aren't worth depending on.

Second constraint: Worker bundles cap at 3 MiB free / 10 MiB paid, and
`next/og` ships a WASM renderer plus embedded fonts. OG generation is the
feature most likely to blow the limit.

**Cloudflare buys us nothing here** — reads already bypass our server entirely
(the browser talks to Firestore direct), so there's no edge-latency win to
capture. Choosing it seriously would mean switching the database to D1 +
Durable Objects, which discards the realtime model this entire design rests on.

**Vercel gives us no rate limiting.** Serverless functions share no state, so
per-IP limits would need an external store (Upstash Redis is the usual answer).
**Deferred — not in v1.** See §7.

### Firestore provisioning

**Native mode, `us-east1`.** Both are permanent — neither can be changed
without recreating the project, so they're recorded here rather than left to
whoever clicks through the console.

Native mode because Datastore mode has no `onSnapshot`, which is the entire
reason this design is on Firestore. `us-east1` because the write path is Vercel
→ Firestore and Vercel's functions default to `iad1`; the multi-region `nam5`
buys availability insurance this doesn't need at a latency and cost premium.

Reads go browser → Firestore directly, so if the userbase is ever
predominantly non-US, this is the decision to revisit — and revisiting it means
a migration, not a setting.

### Local development runs on the emulator

**The Firebase Emulator Suite, not a shared dev project.** Two cloud projects
exist — production, and one that Vercel preview deploys point at — and neither
is used for local work.

The reason is credential blast radius. With `FIRESTORE_EMULATOR_HOST` set, the
Admin SDK skips credential resolution entirely, so **no service account key ever
lands on a developer machine**. The private key exists in exactly one place, the
Vercel dashboard, and local setup involves no secrets at all.

It also makes §5 testable. Rules against a live project can only be checked by
hand, once; against the emulator they're unit-testable on every change, which
matters because `allow list: if false` is the whole security model.

**The emulator does not cover preview deploys** — they run in the cloud and
can't reach a laptop. That's why a second cloud project exists rather than one.

---

## 4. Data model

### `/wheels/{shareId}`

The single source of truth. One document = one listener = one read per update.

```js
{
  title: string,              // "Lunch Friday"
  options: [                  // array, not subcollection
    {
      id: string,             // client-stable ID for animation keying
      label: string,          // max 60 chars
      addedAt: timestamp,
      fromSuggestion: string | null   // suggestion doc ID, if accepted
    }
  ],
  suggestionsOpen: boolean,   // owner kill switch
  createdAt: timestamp,
  updatedAt: timestamp,
  expiresAt: timestamp        // TTL target; slides forward on activity (§8)
}
```

**Why an array, not a subcollection:** atomic reordering, one snapshot listener,
one document read per live update, trivially under the 1MB limit at any sane
option count. Enforce a hard cap (~50 options) in the API.

**There is no `picked` field** (resolved). The "Picked" chip the prototype shows
against previously-won options is client state in the spinning browser, gone on
refresh and invisible to everyone else. This follows from the v1 spin model:
spins are local to one browser (§6), so a shared chip would have to persist
something no other client ever witnessed happening. Phase-2 spins write a
`spins/{spinId}` document (§9) and give a real history for free — that is the
right place to revisit this, not a bolted-on boolean now.

### `/wheels/{shareId}/suggestions/{suggestionId}`

```js
{
  label: string,              // max 60 chars
  status: "pending" | "accepted" | "rejected",
  createdAt: timestamp,
  clientHint: string          // coarse fingerprint for dedupe/rate limiting
}
```

Separate from the wheel doc because it has a different write policy and a
different lifecycle. Accepting is a transaction: `arrayUnion` onto
`wheels.options` plus a status flip, so a double-click can't duplicate an option.

**No submitter attribution** (resolved). There is no author field and the UI
shows no name. `clientHint` is a coarse fingerprint for dedupe and is never
displayed. v1 has no identity anywhere, and inventing a display name only for
suggestions would be the one exception — chat in phase 2 is the feature that
genuinely wants stable per-user identity, and it should introduce it
deliberately (§9) rather than have it arrive by accident here.

**The queue is visible to participants** (resolved). Everyone with the share URL
can see pending and accepted suggestions — it prevents duplicate submissions and
makes the curation feel collaborative rather than opaque.

Because it's public, **reject is a hard delete, not a status flip.** A `status:
"rejected"` row would leave spam and abuse visible to every participant until
someone builds a filter, and Firestore rules can't cleanly exclude a field value
from a `list` without forcing the client to shape its query correctly. Deleting
sidesteps the whole problem. The `status` field therefore only ever holds
`pending` or `accepted`.

### `/wheelSecrets/{shareId}`

```js
{
  editTokenHash: string,      // SHA-256 of the edit token — never the raw value
  createdAt: timestamp
}
```

Never readable by clients. Storing only a hash means a database leak doesn't
hand out edit rights to every live wheel.

**Binding invariant:** the document ID is the relationship. `wheelSecrets/{X}`
holds the token for `wheels/{X}` and for no other wheel. The lookup must always
be keyed by the wheel being written — see §6.

**The token must be an independent CSPRNG value.** Do not derive it from the
`shareId` (`hash(shareId + pepper)` or similar). A derived token means one
leaked pepper mints edit rights for every wheel in existence, and rotating it
locks out every live wheel simultaneously.

### `/wheels/{shareId}/spins/{spinId}` — phase 2

```js
{
  seed: string,
  resultIndex: number,
  optionsSnapshot: [{ id, label }],   // frozen at spin time
  startedAt: timestamp                // serverTimestamp
}
```

---

## 5. Security rules

Rules become a read-policy document and nothing else. Short enough to actually
audit.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /wheels/{shareId} {
      allow get: if true;
      allow list: if false;          // ← load-bearing
      allow write: if false;

      match /suggestions/{suggestionId} {
        allow get, list: if true;
        allow write: if false;
      }

      match /spins/{spinId} {
        allow get, list: if true;
        allow write: if false;
      }
    }

    match /wheelSecrets/{shareId} {
      allow read, write: if false;
    }
  }
}
```

### `allow list: if false` is the whole security model

Public read does **not** mean "readable if you know the ID." Rules are not
filters. With `list` permitted, anyone can call
`getDocs(collection(db, 'wheels'))` and walk the entire collection, secret IDs
included. Denying `list` is what makes the unguessable ID an actual secret.

Same applies to collection-group queries — verify that
`collectionGroup('suggestions')` cannot reach subcollection data from outside a
known parent path.

---

## 6. API surface

All endpoints authenticate the editor via `Authorization: Bearer {editToken}`,
compared against `editTokenHash`. Never accept the token in a path or query
string — it lands in Cloud Logging and load balancer logs. Scrub it from
logging config regardless.

### Authorization check

Editor authorization answers **"is this this wheel's token?"** — never merely
"is this a valid token?"

```js
// The wheel being written determines which secret to check.
const secret = await db.doc(`wheelSecrets/${shareId}`).get()
if (!secret.exists) return 404
if (!timingSafeEqual(hash(bearer), secret.data().editTokenHash)) return 403
```

`shareId` comes from the request path only. Never read it from the body, and
never let a caller specify which secret document to check against.

**Anti-pattern — do not do this:**

```js
// Validates the token globally, not its binding to this wheel.
// An editor of wheel A gains write access to wheel B.
const snap = await db
  .collection('wheelSecrets')
  .where('editTokenHash', '==', hash(bearer))
  .limit(1)
  .get()
if (!snap.empty) {
  /* ...proceed to write wheels/{shareId} */
}
```

This is a confused-deputy bug and it is easy to write by accident when
refactoring auth into shared middleware. Worth an explicit test:
_editor of wheel A receives 403 on wheel B._

| Method   | Path                                        | Auth   | Purpose                                                                            |
| -------- | ------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| `POST`   | `/wheels`                                   | none   | Create wheel; returns `shareId` + `editToken` (only time the raw token is emitted) |
| `POST`   | `/wheels/{shareId}/duplicate`               | none   | Fork into a new wheel; returns new `shareId` + `editToken`                         |
| `PATCH`  | `/wheels/{shareId}`                         | editor | Update title, `suggestionsOpen`                                                    |
| `POST`   | `/wheels/{shareId}/options`                 | editor | Add one option                                                                     |
| `DELETE` | `/wheels/{shareId}/options/{optionId}`      | editor | Remove one option                                                                  |
| `POST`   | `/wheels/{shareId}/suggestions`             | none   | Submit a suggestion                                                                |
| `POST`   | `/wheels/{shareId}/suggestions/{id}/accept` | editor | Accept → transaction into `options`                                                |
| `DELETE` | `/wheels/{shareId}/suggestions/{id}`        | editor | Reject (hard delete)                                                               |
| `POST`   | `/wheels/{shareId}/spins`                   | editor | _(phase 2)_ Server-authoritative spin                                              |

### Concurrent editors

The edit URL is transferable (§2), so two editors on two devices is a normal
case. **`options` must never be written as a whole array from the client** —
two editors each adding an item would have the second write erase the first.
Hence the granular endpoints above.

**Option order is not meaningful** (resolved), so there is no reorder operation,
and every remaining mutation commutes: simultaneous adds both land, and add and
remove on different options don't interact. There is no conflict to detect —
no `rev` counter, no 409, no retry path, no conflict UI.

**Option labels are immutable** (resolved). There is no
`PATCH /wheels/{shareId}/options/{optionId}`. Fixing a typo means removing the
option and adding it again, which the UI should make cheap rather than hide.

This is the one mutation that _wouldn't_ commute — two editors editing the same
label concurrently is a genuine last-write-wins conflict, and it's the only case
in the whole design that would need a `rev` counter, a 409 and a conflict UI.
Dropping in-place editing is what keeps the "no conflict to detect" property
above true, and it's cheap to drop because relabelling a lunch spot is rare and
remove-then-add costs two clicks.

Insertion order is the de facto display order for free: `arrayUnion` appends and
Firestore preserves array order, so slices stay stable without a sort field.
Positions still need to hold steady across clients _during_ a spin — the client
snapshots the list at spin start in v1, `optionsSnapshot` in phase 2.

### Mid-spin edits

The wheel must not reflow while it's spinning — slices shifting mid-rotation, or
the result landing on an option that just disappeared.

**Solved by freezing the view, not locking the data.** The spinning client
snapshots `options` at spin start, animates against that snapshot, shows the
result, then re-renders from live state. Concurrent edits land normally and no
editor is ever blocked.

There is deliberately **no server-side spin lock.** In v1 the spin exists in a
single browser — nobody else is watching, so there is no shared state to
protect, and the only thing a remote edit can damage is the spinner's own
animation. A lock would buy the same outcome at the cost of an endpoint, a
timestamp field, a self-expiring timer, refresh logic for long animations, and a
423 path through every mutating endpoint.

The same reasoning holds in phase 2: `optionsSnapshot` inside the spin document
already freezes the list for every viewer (§9).

**Residual, accepted:** a result may name an option deleted moments earlier. For
a lunch app this is arguably correct — show the result, let the group re-spin.

### Participants do not see the spin in v1

A direct consequence of the above: the spin exists only in the spinning browser.
Participants see the option list update live, but no rotation, no result, no
confetti. The editor announces the outcome the way they would anyway.

**The UI must not imply otherwise.** The prototype's viewer copy — "Watching
live" — promises a synchronized experience that only arrives in phase 2 (§9),
and a participant who stares at a still wheel waiting for it to move will
reasonably conclude the app is broken. Viewer copy should describe what the
participant can actually do — read the list, suggest a spot — and leave the spin
out of it.

---

## 7. Abuse and cost controls

Public write is a **billing** surface as much as a correctness one. A scraped
share URL lets someone loop writes against our Firestore quota.

- **App Check — enable before launch.** Trivial config on day one, a migration
  later. This is the highest-leverage item in this section.
- ~~Rate limit suggestions per IP and per `shareId`.~~ **Deferred.** Requires an
  external state store (Redis) that we're not standing up for v1.
- Cap: options per wheel (~50), suggestion length (60 chars), pending
  suggestions per wheel (~200).
- `suggestionsOpen: false` as an owner kill switch when a wheel gets brigaded.
  **Its control belongs in the Suggestions panel header** (resolved), not in a
  settings menu. It is the only tool an editor has while a wheel is actively
  being spammed, and it needs to be within reach of the thing going wrong rather
  than two clicks deep behind an overflow icon. Title editing and duplicate are
  unhurried by comparison and can live in a header overflow menu.
- Set a Firestore budget alert. **This is the tripwire** — with rate limiting
  deferred, the budget alert is how we find out the deferral stopped being safe.
  Not optional.

**What carries the load instead:** App Check is the primary defense and always
was; rate limiting would have been a second layer. The per-wheel caps above
bound the damage from any single wheel without needing shared state, which is
the common case. The residual exposure is someone who defeats App Check and
spreads writes across many wheels.

**Cheapest way to close it later,** in order of preference:

1. **Vercel Firewall rate limiting** — platform-level, configured in the
   dashboard, no application code and no Redis. Availability depends on plan;
   check this before building anything else.
2. Upstash Redis + a sliding window in the route handlers.

---

## 8. Lifecycle

### Why expire at all

1. **Bounding a leaked share URL.** Share links get pasted into group chats that
   outlive the group. A wheel that lives forever is a permanently open write
   endpoint attached to a URL nobody is tracking.
2. **Data minimization.** We accept arbitrary user-submitted text with no
   accounts and no moderation queue. Holding it indefinitely means owning it
   indefinitely.
3. **Cleanup.** With no accounts, nobody can ever delete a wheel. Without a TTL
   the collection only grows, and every orphan is a live suggestion endpoint.

Storage cost is _not_ a reason — it's negligible at any plausible scale.

### Sliding expiry

`expiresAt` is set at creation (30 days) and **pushed forward 30 days on any
activity** — edit, suggestion, or spin. Active wheels are effectively permanent;
only genuinely dead ones get reaped.

A flat expiry would silently kill a recurring "Friday lunch" wheel that a team
reuses, which is exactly the usage the transferable edit URL and duplicate flow
are meant to support. Implementation cost is the same either way: one field, one
Firestore TTL policy.

**Decide this before launch.** TTL is trivial at creation time and impossible to
retrofit onto data users have already been promised we'd keep.

### Duplicate

`POST /wheels/{shareId}/duplicate` is available to **anyone with the share
URL**, not just editors. It mints a fresh `shareId` and `editToken`, copies
`title` and `options`, and drops suggestions and spins.

Open to participants deliberately: it's the escape hatch when a wheel expires,
when the edit token is lost, or when someone wants to fork the list for their
own group. Nothing is disclosed that the share URL didn't already expose.

**The title is copied verbatim** (resolved). No "(copy)" suffix, no rename
prompt. Renaming is a one-field edit the forker can make if they want it, and
guessing on their behalf gets it wrong for the most common case — a wheel that
expired and is simply being resurrected under the same name.

Consequence for §3: two forks of one wheel produce identical OG unfurls. Since
the image is already designed to be robust to staleness rather than an exact
render, this is consistent rather than a new problem — but it does mean the
unfurl can't be relied on to tell two wheels apart. The URL is the identifier.

---

## 9. Phase 2

### Live synchronized spins

**The spin result is a document, not an animation.** The API generates the
result server-side (the RNG must not live in a client anyone can open devtools
on — this matters more than it sounds once the wheel is picking who pays) and
writes a `spins/{spinId}` doc. Every client renders deterministically from the
seed.

Two details:

1. **Animate relative to receipt time, not wall clock.** Clock skew will
   otherwise show different people different landing positions on the same spin.
2. **`optionsSnapshot` freezes the list**, so an edit mid-spin can't desync
   anyone. Free history feature as a side effect.

### Chat

Subcollection, same write-through-API pattern, same `onSnapshot` read path.
Note: chat is the first feature that genuinely wants stable per-user identity —
anonymous auth for display names, distinct from the edit-token model. Worth
scoping separately rather than bolting on.

---

## 10. Decisions

| #   | Question                                   | Decision                                                                                                                    |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the edit URL transferable?              | **Yes** — token is a bearer capability, multiple concurrent editors supported (§2, §6)                                      |
| 2   | Edits during spin animation?               | **View frozen client-side**, data not locked — no server-side lock in either phase (§6)                                     |
| 3   | Can participants see the suggestion queue? | **Yes** — public queue, reject is a hard delete (§4)                                                                        |
| 4   | TTL length?                                | **30 days, sliding** — refreshed on any activity (§8)                                                                       |
| 5   | Duplicate-wheel flow?                      | **Yes** — open to anyone with the share URL (§8)                                                                            |
| 6   | Does option order matter?                  | **No** — no reorder op; all mutations commute (§6)                                                                          |
| 7   | Framework?                                 | **Next.js App Router** — server-rendered OG metadata is the deciding factor (§3)                                            |
| 8   | Hosting?                                   | **Vercel** — simplicity; cross-cloud write hop is negligible at this volume (§3)                                            |
| 9   | Rate limiting in v1?                       | **Deferred** — App Check + per-wheel caps + budget alert instead of standing up Redis (§7)                                  |
| 10  | Can option labels be edited in place?      | **No** — remove and re-add; no `PATCH` option endpoint. Keeps every mutation commutative (§6)                               |
| 11  | How do rejected suggestions appear?        | **They don't** — reject is a hard delete, no tombstone, no "Declined" chip (§4)                                             |
| 12  | Suggestion attribution?                    | **None** — no submitter name in v1; identity arrives deliberately with chat in phase 2 (§4, §9)                             |
| 13  | Do participants see a spin?                | **No in v1** — the spin is local to the spinning browser, and the copy must say so (§6)                                     |
| 14  | Mobile support?                            | **Responsive throughout, participant view mobile-first** — the share link lives in group chats (§1)                         |
| 15  | Is the "Picked" chip persisted?            | **No — local-only**, client state in the spinning browser, gone on refresh. No schema, no endpoint (§4)                     |
| 16  | Where do the editor affordances live?      | **Title inline in the header; `suggestionsOpen` in the Suggestions panel header; duplicate in a header overflow menu** (§7) |
| 17  | Does duplicate rename the fork?            | **No — title copied verbatim.** Renaming is one field edit away if the forker wants it (§8)                                 |
| 18  | Firestore mode and location?               | **Native mode, `us-east1`** — pairs with Vercel's `iad1`; both choices are permanent (§3)                                   |
| 19  | Local development environment?             | **Firebase Emulator Suite** — no cloud project, no service account on dev machines, and it makes §5 rules testable (§3)     |

Decisions 10–16 resolve conflicts between this document and the Claude Design
prototype in `docs/spin-the-wheel-editor/`. Where the two disagree, this table
wins; the prototype is a visual reference, not a specification.

## 11. Remaining questions

1. What goes in the OG image, given it will be cached stale? Leaning
   title + option count + decorative wheel rather than the live list.
2. Do we notify participants that a wheel is near expiry, given there's no
   channel to reach them and no accounts? Probably "no, and the duplicate flow
   is the mitigation" — but worth stating explicitly.
3. Does Vercel Firewall rate limiting cover §7 on our plan? If so it closes the
   deferred gap with no Redis and no code.
