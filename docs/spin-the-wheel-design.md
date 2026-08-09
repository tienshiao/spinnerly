# Spin the Wheel — Design Doc

**Status:** Draft
**Last updated:** 2026-08-07

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

**Resolved: an optimistic entry retires on the snapshot, not on the response.**
Holding local state is only half the problem; the other half is knowing when to
let go of it, and the obvious answer is wrong. Dropping the local row when the
`201` arrives leaves a window in which the local row is gone and the real one
has not been delivered yet — the option vanishes and comes back, which on a
wheel is a slice disappearing mid-render.

Recognising the change takes two kinds of evidence.

**Identity** is the change being visibly there: the option carries the ID the
`201` returned, the rejected row is gone, the queue row reads accepted. It is
the earliest possible signal and it can never fire too soon — a row that is
there _is_ the landing.

**Version** is the second, and it is what makes a negative answer possible.
Every mutating route reports the `updatedAt` its write stored on the wheel
document, in an `x-wheel-updated-at` response header (§6). Once a snapshot
carries an `updatedAt` at or past that value, we are looking at a document that
already includes our write — so if the thing we added is not in it, it is not on
its way, it was removed again.

| Mutation          | Retires when                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| add option        | the options contain the ID the `201` returned, **or** the version caught up                                  |
| remove option     | the options no longer contain that ID, **or** the version caught up                                          |
| patch title/flag  | the field equals what we asked for, **or** the version caught up                                             |
| submit suggestion | the queue contains the ID the `201` returned, **or** the version caught up and the queue has since delivered |
| reject suggestion | the queue no longer contains that ID, **or** the same                                                        |
| accept suggestion | an option carries `fromSuggestion` **and** the row reads accepted, **or** the same                           |

Four things about this are not obvious:

- **Accept answers `204`,** so there is no new option ID to wait for.
  `fromSuggestion` (§4) is the only key available, which makes that field
  load-bearing for the UI as well as for provenance. Accept also has to wait for
  _both_ documents — it writes the wheel and the suggestion, they arrive as two
  independent snapshots, and retiring on the first would let the queue row flip
  back to pending until the second caught up.
- **The version is the wheel's, even on the suggestion routes.** That works
  because every mutating route slides `expiresAt` on the wheel document (§8), so
  one field versions the whole wheel, subcollection included.
- **It does not speak for the queue listener,** which is a separate
  subscription. So a queue mutation that needs the version additionally requires
  a queue delivery since the write settled — without it an optimistic suggestion
  row would vanish the moment the wheel caught up and reappear when the queue
  arrived, which is the same flicker in the other panel.
- **Reject needs no version at all.** It deletes the row, so every snapshot at
  or after the commit lacks it and identity is guaranteed to arrive. Submit and
  accept each have a negative conclusion to reach — a suggestion created and
  deleted unseen, an option another editor has since removed — and reject does
  not, so it does not carry the extra evidence or its window.
- **A snapshot can beat its own HTTP response,** so identity has to come first.
  A rule phrased as "wait for something _after_ the response" waits for a change
  nobody is going to make.

**Why a version rather than counting snapshots.** Counting deliveries is the
cheap version of this and it is subtly wrong in both directions. A delivery that
arrives after our response can still be a document generated _before_ our
commit — another write landing in the window just ahead of ours, whose snapshot
is slower than a full API round trip — and a counter retires against it, showing
a stale title for a frame. In the other direction a counter can never conclude
that something is absent because it was deleted rather than because it has not
arrived, which strands an optimistic row forever: a suggestion submitted and
rejected inside one round trip may never appear in any snapshot that client
receives, since Firestore does not promise to deliver every intermediate
version.

**Consequence for the data model:** `updatedAt` is written as a real timestamp
computed by the route, not `FieldValue.serverTimestamp()`. A sentinel is
resolved during the commit, so the route would have nothing to report. The cost
is that `updatedAt` is the route's wall clock rather than Firestore's — a few
milliseconds of skew between function instances — which is the same trade
`expiresAt` and `addedAt` already make (§4). Against our own write the
comparison is exact, because it is the value we were handed.

Nothing gives up on a settled entry on a timer. A write that succeeded is a
change that exists, so the optimistic row is the correct thing to draw whether
or not the listener ever delivers it. What is bounded is the request.

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
  createdAt: timestamp,       // serverTimestamp
  updatedAt: timestamp,       // the VERSION — see below
  expiresAt: timestamp        // TTL target; slides forward on activity (§8)
}
```

**`updatedAt` is a version, not a display field**, and it is written by the route
rather than with `FieldValue.serverTimestamp()`. Every mutating route reports the
value it stored (§6), and a client compares the `updatedAt` in each snapshot
against that to decide whether it is looking at a document that already includes
its own write — which is what the optimistic layer retires on (§3). A sentinel
resolves during the commit, so a route that used one would have nothing to
report.

The cost is that this is the route's wall clock rather than Firestore's, so two
writes from two function instances are ordered by clocks that may differ by a few
milliseconds. Against a client's own write the comparison is exact, because the
value came from the response. `expiresAt` and `addedAt` already make the same
trade, and `expiresAt` is the field the TTL reaper acts on — by some distance the
more consequential of the two. `createdAt` stays a server timestamp on both
documents that have one: nothing compares it to a value we returned.

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
  status: "pending" | "accepted",
  createdAt: timestamp,
  expiresAt: timestamp        // TTL target; see §8
}
```

Separate from the wheel doc because it has a different write policy and a
different lifecycle. Accepting is a transaction: `arrayUnion` onto
`wheels.options` plus a status flip, so a double-click can't duplicate an option.

`expiresAt` is on each suggestion because **a Firestore TTL policy deletes the
document it matches and not that document's subcollections.** Without it, a
reaped wheel leaves its whole queue behind — arbitrary user-submitted text with
nothing left to reach it from, which is the indefinite ownership §8 exists to
avoid. The policy has to cover the `suggestions` collection group as well as
`wheels` and `wheelSecrets`.

**No submitter attribution** (resolved). There is no author field, the UI shows
no name, and **nothing identifying the submitter is stored at all.** v1 has no
identity anywhere, and inventing a display name only for suggestions would be
the one exception — chat in phase 2 is the feature that genuinely wants stable
per-user identity, and it should introduce it deliberately (§9) rather than have
it arrive by accident here.

**Removed: `clientHint`** (resolved, 2026-08-07). This document previously
specified a `clientHint` field — "a coarse fingerprint for dedupe/rate limiting"
— which was implemented and then taken back out. Two reasons, in order of
weight:

1. **It contradicted decision 12 in practice.** §5 makes this subcollection
   `allow get, list: if true`, and Firestore rules cannot exclude a field from a
   read. So every participant holding the share URL could read every hint, group
   the queue by it, and learn which suggestions came from the same person. That
   is attribution by the back door, however coarse the value and whether or not
   the UI ever displays it. "Never displayed" is a statement about our client,
   not about who can read the document.
2. **Nothing consumed it.** Rate limiting is deferred (decision 9) and would key
   on the live address at request time rather than on stored hints; dedupe was
   never built. So it was a fingerprint of real people carried for a feature
   nobody had committed to, which is the opposite of what §8 asks.

The cost of removing it is real and worth stating: a field can be populated at
write time and cannot be backfilled, so a dedupe feature built later will be
blind to every suggestion submitted before it. That is accepted. **If dedupe is
built, the hint must live somewhere the public read cannot reach** — a document
under `wheelSecrets`, which is `read, write: if false` — and not on the
suggestion itself.

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
  createdAt: timestamp,
  expiresAt: timestamp        // TTL target, always LATER than the wheel's (§8)
}
```

`expiresAt` is set a margin _after_ the wheel's own, not equal to it. The two
documents are written and slid together but reaped by independent per-collection
TTL jobs with no ordering guarantee between them, and only one of the two orders
is safe: a wheel reaped before its secret is inert, while a **secret reaped
before its wheel leaves a live, publicly readable, still-suggestable wheel whose
owner has permanently lost the kill switch** — with no recovery, because the
token cannot be reissued. The margin makes that order impossible rather than
unlikely.

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

Shipped as `firestore.rules`, which is this policy plus the reasoning in
comments. That file is the artifact — it is what deploys and what the tests
load; this block is the spec it has to keep matching.

### `allow list: if false` is the whole security model

Public read does **not** mean "readable if you know the ID." Rules are not
filters. With `list` permitted, anyone can call
`getDocs(collection(db, 'wheels'))` and walk the entire collection, secret IDs
included. Denying `list` is what makes the unguessable ID an actual secret.

### Collection-group queries are denied by absence (resolved)

The subcollection rules permit `list`, which is only safe because reaching them
requires already naming a `shareId` — the listing grants nothing the share URL
did not. A collection-group query has no parent path at all: it reaches every
`suggestions` collection under every wheel at once, and if it were permitted it
would be the enumeration hole `allow list: if false` exists to close, one level
down.

It is not permitted, and the reason is worth stating because there is no line
in the file that says so. Under `rules_version = '2'`, a collection-group query
is authorised **only** by a rule written with a recursive-wildcard prefix —
`match /{path=**}/suggestions/{id}` — and a rule at a fixed path, which is what
`match /wheels/{shareId}/suggestions/{suggestionId}` is, does not authorise one.
There is no such rule, so the query is denied.

Two consequences for anyone editing `firestore.rules`:

- **Do not add a catch-all `match /{document=**}` clause "for completeness."**
  A recursive wildcard anywhere in the file starts authorising collection-group
  queries for everything beneath it, and would revoke this guarantee silently —
  no error, no failing read, just a database that can now be enumerated.
- The guarantee holds because of a line nobody wrote, so it cannot be reviewed
  by reading the file. It is asserted instead, for both `suggestions` and
  `spins`, in `firestore.rules.emulator.test.ts`.

### Deploying and testing the rules

The rules live in `firestore.rules` and are wired into `firebase.json`, so the
emulator loads them too — a local browser is governed by the same policy a
deployed one is, and `npm run test:emulator` runs the suite that reads that file
off disk and asserts every clause in it.

Deploy is one command per environment, and it is not part of the Vercel deploy:

```bash
npm run rules:deploy -- --project <projectId>
```

Rules and application code ship separately, so an ordering exists and only one
order is safe. **Deploy rules before the code that depends on them.** A client
reading a path the deployed rules do not yet permit fails with
`permission-denied`, which surfaces as a wheel page that renders and then stays
empty. The reverse — rules that permit more than any client currently reads —
is inert.

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

### Every mutating response reports its version

`x-wheel-updated-at`, an ISO 8601 timestamp with milliseconds: the `updatedAt`
the write stored on `wheels/{shareId}` (§4). Present on all six mutating routes
and absent from `POST /wheels/{shareId}/duplicate`, which does not change the
wheel it names.

A **header** rather than a body, because four of the six answer `204 No Content`
on purpose — a delete is a `204` whether or not there was anything to delete,
which is what makes those endpoints safe to call twice — and moving the version
into a body would mean turning them into `200`s. It is metadata about the write
rather than a representation of the thing written, so a header is where it
belongs anyway. Not `Last-Modified`, whose HTTP-date format has one-second
resolution: two writes inside the same second would be indistinguishable, which
is exactly the case this exists to resolve.

The header and the stored field have to be the same instant, and the failure
mode if they diverge is quiet. A client waits for a snapshot to reach the
reported value, so a header running even a millisecond ahead of what was stored
would describe a version no snapshot ever carries — every optimistic row on that
wheel would wait forever, and the symptom would be rows that never clear rather
than anything resembling a timestamp bug. Asserted across all six routes in
`app/api/wheels/expiry.emulator.test.ts`.

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

Every mutating route slides both documents together, through one helper, so the
wheel and its secret can never drift apart. The one write that deliberately does
_not_ slide is `POST /wheels/{shareId}/duplicate`, which reads the source and
leaves it untouched — see _Duplicate_ below.

### The TTL policy (resolved)

**Three collection groups, not one:** `wheels`, `wheelSecrets` and
`suggestions`, all on `expiresAt`. A policy is scoped to a collection group and
covers every instance of that name in the hierarchy, so the `suggestions` entry
reaps `wheels/{any}/suggestions` without needing one policy per wheel.

Each of the three is load-bearing, and the second and third are the ones easy to
forget:

- **`wheelSecrets` without a policy** means the secret outlives its wheel
  forever. `assertEditor` authorises on the existence of `wheelSecrets/{shareId}`,
  so it keeps succeeding for a wheel that has been reaped, and the collection
  grows without bound. The secret is written to expire a margin _after_ the
  wheel so the two are never reaped in the dangerous order (see
  `SECRET_EXPIRY_MARGIN_DAYS`).
- **`suggestions` without a policy** leaves the whole queue behind, because
  **a TTL delete does not cascade to the deleted document's subcollections.**
  That orphan is arbitrary user-submitted text with nothing left to reach it
  from — precisely the indefinite ownership this section exists to prevent.

`spins` is absent on purpose: it is phase 2 (§9) and nothing writes one yet. It
joins the list in the same change that first writes a spin.

There is no `firebase-tools` command for TTL, and this is not left as a runbook
of `gcloud` invocations. It is `scripts/configure-ttl.mjs`, run once per
environment against the Firestore Admin API:

```
npm run ttl:configure -- --project spinnerly-prod    # apply
npm run ttl:check     -- --project spinnerly-prod    # verify; non-zero if not
```

Enabling is a long-running operation, so a freshly applied policy reads
`CREATING` until Firestore has processed the documents already stored.
**`ACTIVE` on all three is the verification, and `NEEDS_REPAIR` is a failure** —
it means the policy took for new documents and failed for existing ones, which a
check that merely asked "is TTL configured?" would report as success while the
entire stored backlog quietly never expired.

The policy is not applied by anything in CI or at deploy time, and deliberately
so: it is database configuration, it is idempotent but slow, and it belongs with
provisioning (TASK-27) rather than with a release.

### Suggestions expire with their wheel, and sometimes before it (resolved)

Each suggestion carries its own `expiresAt`, set equal to the wheel's **at
submit time** and never slid afterwards. The consequence is deliberate and
asymmetric:

- A suggestion can **never outlive its wheel.** That is the unrecoverable
  direction — the orphan above — and it is now impossible rather than unlikely.
- A suggestion **can be reaped under a live wheel**, 30 days after it was
  submitted, on a wheel whose own expiry has kept sliding.

The second is accepted rather than fixed. Fixing it means sliding every
suggestion whenever the wheel is touched — a fan-out of up to
`PENDING_SUGGESTIONS_MAX` subcollection writes per edit, on a wheel whose submit
path is unauthenticated and therefore attacker-drivable. What is lost instead is
a suggestion nobody accepted or rejected in a month, which is the stale text
this section wants gone anyway. A reaped _accepted_ suggestion costs even less:
its option is a copy living in the wheel document, so only the `fromSuggestion`
provenance dangles, and nothing dereferences it.

### An expired wheel that hasn't been reaped yet (resolved)

Firestore deletes "typically within 24 hours" after expiry and **expired
documents keep serving reads until the reaper runs.** In that window a wheel
behaves exactly as a live one: readable, editable, forkable, and any write
slides it back out of danger.

No route checks `expiresAt`. The alternative — refusing writes to a wheel past
its timestamp — means every route disagreeing with what Firestore itself is
doing, and a wheel that 404s on write while still serving reads is a stranger
state to explain than one that simply still works. It also matters for the
escape hatch: duplicating an expired wheel is exactly what someone reaches for
in that window, and §8's whole purpose is served by the wheel eventually going
away, not by the last day being precise.

One consequence worth naming, since it reads like a hole in the first
justification above: `POST /suggestions` is unauthenticated and it slides, so
anyone holding a leaked share URL can keep that wheel alive indefinitely by
submitting to it. The bound is the editor's kill switch — a submission refused
because `suggestionsOpen` is false writes nothing at all, and therefore slides
nothing. Closing suggestions on a wheel you have lost track of is what puts it
back on a clock.

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

| #   | Question                                       | Decision                                                                                                                               |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is the edit URL transferable?                  | **Yes** — token is a bearer capability, multiple concurrent editors supported (§2, §6)                                                 |
| 2   | Edits during spin animation?                   | **View frozen client-side**, data not locked — no server-side lock in either phase (§6)                                                |
| 3   | Can participants see the suggestion queue?     | **Yes** — public queue, reject is a hard delete (§4)                                                                                   |
| 4   | TTL length?                                    | **30 days, sliding** — refreshed on any activity (§8)                                                                                  |
| 5   | Duplicate-wheel flow?                          | **Yes** — open to anyone with the share URL (§8)                                                                                       |
| 6   | Does option order matter?                      | **No** — no reorder op; all mutations commute (§6)                                                                                     |
| 7   | Framework?                                     | **Next.js App Router** — server-rendered OG metadata is the deciding factor (§3)                                                       |
| 8   | Hosting?                                       | **Vercel** — simplicity; cross-cloud write hop is negligible at this volume (§3)                                                       |
| 9   | Rate limiting in v1?                           | **Deferred** — App Check + per-wheel caps + budget alert instead of standing up Redis (§7)                                             |
| 10  | Can option labels be edited in place?          | **No** — remove and re-add; no `PATCH` option endpoint. Keeps every mutation commutative (§6)                                          |
| 11  | How do rejected suggestions appear?            | **They don't** — reject is a hard delete, no tombstone, no "Declined" chip (§4)                                                        |
| 12  | Suggestion attribution?                        | **None** — no submitter name in v1; identity arrives deliberately with chat in phase 2 (§4, §9)                                        |
| 13  | Do participants see a spin?                    | **No in v1** — the spin is local to the spinning browser, and the copy must say so (§6)                                                |
| 14  | Mobile support?                                | **Responsive throughout, participant view mobile-first** — the share link lives in group chats (§1)                                    |
| 15  | Is the "Picked" chip persisted?                | **No — local-only**, client state in the spinning browser, gone on refresh. No schema, no endpoint (§4)                                |
| 16  | Where do the editor affordances live?          | **Title inline in the header; `suggestionsOpen` in the Suggestions panel header; duplicate in a header overflow menu** (§7)            |
| 17  | Does duplicate rename the fork?                | **No — title copied verbatim.** Renaming is one field edit away if the forker wants it (§8)                                            |
| 18  | Firestore mode and location?                   | **Native mode, `us-east1`** — pairs with Vercel's `iad1`; both choices are permanent (§3)                                              |
| 19  | Local development environment?                 | **Firebase Emulator Suite** — no cloud project, no service account on dev machines, and it makes §5 rules testable (§3)                |
| 20  | What happens to orphaned subcollections?       | **Each suggestion carries its own `expiresAt`**, set at submit and never slid. Never outlives its wheel; may die under a live one (§8) |
| 21  | How does an expired-but-unreaped wheel behave? | **As a live wheel** — no route checks `expiresAt`, and any write slides it back out of danger (§8)                                     |
| 22  | When does an optimistic entry retire?          | **On the snapshot, never on the HTTP response** — by identity, or by the version the route reports in `x-wheel-updated-at` (§3, §6)    |

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
