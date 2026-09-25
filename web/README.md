# Tiny Viewers — web

Scene guides for kids' movies. A parent looks up a film and sees every scary or sad scene in time
order: when it happens, what is in it, and how strong it is.

Next.js (App Router) + TypeScript + React Server Components. Styling is CSS Modules and custom
properties; no UI kit. Light theme only.

## Running it locally

```sh
npm install
npm run dev          # http://localhost:3000
```

`npm run dev` needs no database, no Neon and no network. It builds the whole scene database in
memory with [PGlite](https://github.com/electric-sql/pglite) — real Postgres 16 compiled to
WebAssembly — from the files in `experiments/trigger-scan`, using the scene-api loader. Change the
port with `PORT=4000 npm run dev`.

| Command | What it does |
| --- | --- |
| `npm run dev` | In-memory database + dev server |
| `npm run dev:neon` | Dev server against `DATABASE_URL` |
| `npm run build` | Production build (type-checked) |
| `npm start` | Production server |
| `npm test` | Pure-logic tests (`node:test`) |
| `npm run typecheck` | `tsc --noEmit` |

Two optional development switches:

- `TINY_VIEWERS_DEV_POSTERS=1 TMDB_API_KEY=…` — look posters and synopses up for real instead of
  drawing the placeholder and leaving the film header without its blurb.
- `TINY_VIEWERS_QUERY_LOG=1` — print one line per SQL statement, to keep the per-page query budget
  honest (Home issues 4, a film page 3).

## Environment

| Variable | Where | Required |
| --- | --- | --- |
| `DATABASE_URL` | the deployed app | **yes** (see below) |
| `SCENE_API_URL` | the deployed app | for the live runs on `/watch` and the add flow on `/add` — without it the app looks for `http://localhost:8787`, the status reads fail, `/watch` says it can't reach the analysis service, and the add card says "Can't tell right now". Everything else comes from the database and is unaffected |
| `ADD_FILM_PROXY_SECRET` | the deployed app **and** the scene API, same value | no, but set it — without it the add flow and the demo work and the API simply cannot tell one visitor from another, so its per-client demo limit (five runs per ten minutes) is shared by every visitor. See "Who is asking" below |
| `TMDB_API_KEY` | the scene-api loader only | no — without it `poster_url` and `overview` are null: the UI draws its placeholder and the film page shows no synopsis |
| `TINY_VIEWERS_DB=pglite` | local development only | no — ignored when `NODE_ENV=production` |

No passcode and no API key belongs in this app's environment. The passcode lives in the scene API;
this app only carries it, in the body of a request, from the browser to that API.

### DATABASE_URL must be Neon's **pooled** endpoint in production

Neon gives every database two hostnames:

```
ep-example-123456.us-east-1.aws.neon.tech          ← direct
ep-example-123456-pooler.us-east-1.aws.neon.tech   ← pooled  ✅ use this one
```

Each serverless instance opens its own pool, and instances come and go with traffic. Against the
**direct** endpoint those connections are counted individually and the database runs out of them
under load — the failure arrives as intermittent "too many connections" errors once the site is
busy, not on the first request, which is what makes it easy to deploy and miss.

The pooled host (`-pooler`) puts PgBouncer in front and is the one to use for anything serverless.
The app does not refuse to start on the direct endpoint — it works, it just falls over later — but
it logs a warning once per server process in production:

```
[db] DATABASE_URL points at a direct Neon endpoint. In production use the pooled one …
```

Only the host is inspected; the connection string is never logged. The rule lives in
`shouldWarnAboutPooling` in `lib/db-config.ts` and is covered by `test/db.test.ts`.

TLS certificates are always verified (`rejectUnauthorized: true`). Neon's certificates chain to a
public root, so the system trust store validates them with nothing extra configured, and
`sslmode=require` in the URL is fine alongside this.

### Give the function longer than the database can take

The pool's timeouts compose rather than overlap: a cold connection can take
`connectionTimeoutMillis` (5 s) and the query after it `query_timeout` (8 s), so one request can
wait **13 s** — `WORST_CASE_WAIT_MS` in `lib/db-config.ts`. Set the platform's function timeout
above that, or the function is killed before the app can render its error card.

## Headers

`next.config.mjs` sends `X-Content-Type-Options`, `Referrer-Policy`, a minimal `Permissions-Policy`
and a CSP, and disables `X-Powered-By`.

The CSP allows `'self'` plus `https://image.tmdb.org` for images. Two notes on what it permits:

- **`script-src` includes `'unsafe-inline'`.** Next's App Router streams the RSC payload and its
  bootstrap through inline `<script>` tags. Removing it needs a per-request nonce from middleware,
  which would make every page dynamic; that is the upgrade path, not a quick change.
- **`style-src` includes `'unsafe-inline'`.** A handful of real inline styles remain — marker
  positions on the timeline — all computed from database values, never from
  anything a visitor supplies.

Fonts are self-hosted by `next/font`, so nothing is fetched from Google at runtime and `font-src`
needs no external host.

## How it is put together

| Path | What lives there |
| --- | --- |
| `app/` | Routes: `/`, `/library`, `/film/[slug]`, `/watch`, `/watch/run/[id]`, the `/api/add/*` and `/api/demo/*` handlers, plus `not-found`, `error` and `global-error`. Redirects: `/search` → `/library` (`?q=` and all); `/watch/[slug]` → `/watch`; `/add?film=X` → `/library?add=1&q=X`; `/add/job/[id]` and `/watch/job/[id]` → `/library?job=[id]` |
| `components/` | Presentation, including the inline hand-drawn SVG in `Art.tsx` |
| `lib/copy.ts` | Every parent-facing string, in one place |
| `lib/queries.ts` | Every SQL statement, each wrapped in React `cache()` |
| `lib/db.ts` | The `pg` pool (or the dev database); `lib/db-config.ts` holds the pure rules |
| `lib/scenes.ts` | Times, strength marks, filters — pure, and tested |
| `lib/search.ts` | Name matching: case, punctuation, accents, and the "open this one film" rule — pure, tested, and safe to bundle into the browser |
| `lib/demo.ts` | The Watch page's live run: the contract's shapes and the pure rules the board is drawn from — tested |
| `lib/taxonomy-labels.ts` | Taxonomy v3 ids → the words a person reads. A copy, on purpose; see the file |
| `lib/scene-api.ts` | The forwarder the `/api/add/*` and `/api/demo/*` handlers are made of — pure enough to test with a fake fetch |
| `lib/job.ts`, `lib/job-lookup.ts` | Job types, the sentence every refusal gets (`addRefusal`), and the server-side read of one job |

### One page for the library, the search and adding a film

There is no search page. `/library` holds every film, and `components/LibraryShelf.tsx` filters the
rows as a parent types, using the same `lib/search.ts` rules the server uses. Three behaviours
follow from one place:

- **`?q=` naming exactly one film redirects to it**, which is what Home's form relies on: a parent
  who types a whole title lands on the scene guide, not on a list with one row in it.
- **Anything else renders the library pre-filtered**, so the page works with no JavaScript at all —
  the form is a plain GET back to `/library`.
- **With JavaScript, nothing is fetched.** Six films are already on the page; the filter is an
  array filter, the URL is kept in step with `history.replaceState`, and Enter opens the one film
  when the query names one.

**Adding a film happens here too.** A search that matches nothing turns into the passcoded ask
(`components/AddMovie.tsx`), prefilled with what was typed. Submitting starts the real add run and
the card becomes live: it polls the job (`usePolledJob`, with the loop in `lib/poll.ts`) and lists the
run's steps with the elapsed time the API measured on the last poll. Before a step is reported the card
says the film is next and waiting — it does not claim to be reading it.

**Only the steps that build the film page are listed** (`parentSteps` in `lib/job.ts`, labels in
`ADD.stepRows`/`ADD.stepLabels`). Two pipelines report here:

- **Live** (`ADD_PIPELINE=live`, the default): finding the subtitles, reading them for scenes,
  labelling what is in each scene, saving the scene guide. Its beat screening and evidence lines do
  not build the guide, so they are not listed.
- **Jev-first** (`ADD_PIPELINE=jevfirst`): every stage is listed, naming who does it — "Sonnet reads
  the film", "Jev checks the cut", "Jev checks what Sonnet wrote", "Jev answers the concrete
  questions", "Sonnet answers the rest", "Jev finds the exact moments", "Sonnet describes, Jev checks"
  (the `describe` and `check_describe` stages, shown as one row), then "Saving the scene guide".

The card is honest about pace: the running row says how long that step usually takes (`ADD.stepPace`
— Sonnet's reading is the slow part, a couple of minutes; Jev's stages take seconds), a finished row
shows how long it took by the API's own `started_ms`/`ended_ms`, and the lead changes once Sonnet's
reading is done (`addPhase`). A step id this app does not know is hidden until someone decides it
belongs there.

**The poll never pretends.** One request at a time, the next scheduled when the last settles (an
interval let a slow answer land after a newer one). Failed polls back off (1.5 s doubling to 15 s);
after three misses in a row the card says "Updates interrupted", shows when the last answer came, and
offers "Ask again now" — which only polls, it never restarts the run. A 404 means the run is gone.
When the job is done the page refreshes its film list and the new row leads it with a "Just added"
chip, remembered in `sessionStorage` for the session. `?job=<id>` keeps the card across a reload. A
reload that finds the run already done goes through the same arrival as a live finish
(`lib/add-flow.ts`): the list is refreshed until the film is in it, and if it still is not after three
tries, a visible "See its scene guide →" link stays. The finish is announced in a status region outside
the card, and if focus was in the card it moves to the new row.

Three details that are easy to undo by accident:

- **A run starts on the parent's say-so.** A title is a search: even one match comes back as a
  "Which one?" row with "Check this one". Only an IMDb link or id (`namesOneFilm` in `lib/job.ts`)
  starts straight away, because only that names one film for certain.
- **The refresh is not in the same tick as `history.replaceState`.** Next patches `replaceState` to
  dispatch a router "restore", and a restore dispatched alongside `router.refresh()` discards the
  refresh — the request goes out, the answer has the new film, and the list never changes. The
  library refreshes from an effect after the commit, and asks again (at most three times) if the
  film is still missing.
- **The ask's inputs have no `name`.** Submitted before hydration, the form falls back to a plain
  browser submit, and a named passcode would land in the address bar.
- **`LibraryShelf` is not keyed by `?job=`.** Finishing a run replaces the URL with `/library` and
  refreshes; a key that changed with it remounted the list mid-arrival and forgot the film it was
  waiting for. A link to another run arrives as a new `initialJob` prop instead.

Two rules the code enforces rather than trusts:

1. **Nothing about the machinery reaches a parent page.** `lib/queries.ts` selects only `asserted`
   labels and never selects model names, probabilities, confidence or review status.
2. **A missing rating is "Not checked", never a zero.** The two mean different things, and the
   design keeps them apart.

## Watch it work

The one corner of the site where the engines are named: parent pages say "scenes"; these say Jev,
Sonnet and cents. Built from the Claude Design boards (pick a film, the live run, one scene up close,
finished). Light page, one dark instrument panel for the board. Written for a parent who has never
heard of Jev: one line on what they will see, Jev's three jobs in one sentence each (between what
Sonnet did earlier and what the rules do after), and a plain note that this is **the step that
builds each film's page**, run again live — not a showcase — and that a run changes nothing on it.

**Linked.** `WATCH_LINKED` in `lib/copy.ts` is the one switch: it puts "Watch it work" in the header
navigation and Home's footer links together.

| Route | What it is |
| --- | --- |
| `/watch` | The films whose Sonnet reading is stored (`GET /api/demo/films`) and today's budget (`GET /api/demo/status`); "Run it live" posts `{slug}` to `/api/demo/runs` |
| `/watch/run/[id]?film=<slug>` | One live run, polled from `GET /api/demo/runs/{id}`; `&scene=<id>` is one scene up close |
| `/watch/[slug]` | Retired (it was a recorded replay); redirects to `/watch` |

**Every run is live, and only Jev runs.** Sonnet's reading (the cut, the questions about meaning,
the descriptions) was done when the film was added, and the page says so.

**Nothing is animated that did not happen.** The board is drawn from the polled run and nothing
else: the counters are the stages' own `done/total`, a tile fills when that scene's `state` says its
answers landed and is coloured only once the rules have run (`flagged` stops being null), the
elapsed time and the cost are the API's measurements, and there is no timer of the page's own. The
poll is the add card's loop (`startPoll` in `lib/poll.ts`): one request at a time, backing off when
polls fail, "Updates interrupted" after three misses, aborted on unmount. Only an answered scene is a
control. Transitions are CSS only and are switched off under `prefers-reduced-motion`.

**Now, first.** The board opens with one line on what Jev is doing at this moment — "Checking scene
breaks · 15 of 38 checked", "Checking descriptions · 127 sentences checked", "Checking danger and
fear · 9 of 39 scenes complete" — from the run's `stage` and the API's own counts (`runActivity` in
`lib/demo.ts`). The first ten-odd seconds of a real run are the scene breaks and the descriptions,
which sit below the scene strip; on a phone this line is the only part of them in the first screen.

**The finish, in plain numbers:** time, cost, scenes to know about ("13 of 45"), and "Same as the
film page?" — yes only when every scene of each list is in the other (`sameness` in `lib/demo.ts`);
"Not in the library" or "Didn't come back" otherwise, never a "no".

**One scene up close** shows the reasons the scene is on the list as a parent would say them,
overlapping checks grouped (`groupReasons` in `lib/reasons.ts`: "The Giant and Hogarth in danger"
holds "The Iron Giant in danger", "Hogarth Hughes in danger", "Child in danger" and "Afraid for
safety"). Each reason's "How this was checked" keeps every check inside it: the question as it was
asked, Jev's answer against its line (or Sonnet's yes, answered earlier), and the rule that let it
count (`ruleSentence` in `lib/copy.ts`, one plain sentence per `select.js` rule code). A character's
name is shortened only to a word the run's own checked titles and descriptions use. The film page's
open row groups the same way, with the checks behind each reason one tap away.

**Plain states, kept apart** (`pickState` in `lib/demo.ts`): the budget is spent, the service is not
answering, no film is ready yet, a film the API says is not ready, a run that failed (with the API's
reason), and a run the page cannot find. A flagged scene without a strength for the chosen band is
"Not checked", never a zero.

### The contract this page reads

The shapes are in `lib/demo.ts` (`normalizeRun` fills what an early poll leaves out: `stages: null`
before the first write reads as 0 of 0 everywhere, drawn as dashes). Beyond `GET /api/demo/runs/{id}`
as the scene API sends it today, the page reads these **when present**, and does without them:

| Field | Used for | Without it |
| --- | --- | --- |
| `result.flagged[].why = { line, tags: [{ label, by: ['jev'\|'sonnet'], p, rule, question?, act?, with? }] }` | the list's reason chips; one scene up close (question, Jev's answer against `act`, the rule) | reasons read from `result.flagged[].reasons`, with no question, line or rule sentence |
| `result.flagged[].strength` as `{ '5_7', '8_10' }` or a number | a flagged scene's strength when its scene row is missing | "Not checked" |
| `result.compare.guide_scenes` | "9 of the page's 11 match" | read as `both + only_guide` |
| `feed[].scene` | which cut a feed item rules on (the red ticks) | the scene id in the item's text ("Cut before S012 …") |
| `error` on a failed run | the reason, in the API's sentence | the generic failed line |

`feed[].at_ms` is when the item landed (ms into the run), never a place in the film.

### Film pages: why a scene is on the list

A flagged scene shows its reasons as plain chips under "Why it's on the list", with or without a
description, read from `scenes.why_tags` (jsonb, `{ line, tags: [{ label, by }] }`, the pipeline's
`why_tags`) through `to_jsonb(s) -> 'why_tags'`, so a database without the column yet answers null
rather than failing the page. A row whose title is the pipeline's placeholder ("Flagged scene") is
called by its first two reasons instead (`sceneHeading` in `lib/scenes.ts`). No engine is named.

### The add flow and the demo, and why they go through this app

The CSP is `connect-src 'self'`: a page here may only fetch this app. So the browser posts to
`/api/add/{status,resolve,jobs,jobs/[id]}` and `/api/demo/{status,films,runs,runs/[id]}`, and
`lib/scene-api.ts` forwards each call to
`SCENE_API_URL` server-side, passing status codes and JSON straight through with a 10 s timeout and
no caching anywhere. An upstream answer that is not JSON is **not** relayed — a proxy's HTML error
page would be the one body this app must not pass on — it becomes a 502 with a code.

The passcode travels in the POST body of the two calls that need it (resolve, jobs), is held in React state while
the form is on screen, and is written nowhere else: no localStorage, no query string, no log line.
Nothing in the forwarder reads a body; its error lines name the endpoint and the failure only.

The body is read off the request stream with a **byte** limit (`MAX_BODY_BYTES`, 8 KB) counted as it
arrives, and the read is abandoned the moment it is passed — a 413, not a fully buffered rejection.

`/api/add/resolve` is the path with a longer deadline: 30 s rather than 10, because behind it
the API runs a TMDB search plus up to three sequential detail lookups at 8 s each, and four honest
three-second answers already pass ten. Its route raises `maxDuration` to match.

#### Who is asking

The scene API counts wrong passcodes, but every guess that reaches it arrives from this proxy — one
warm instance, one egress address, one counter shared by every visitor on earth. Ten anonymous
failures would refuse a stranger's correct passcode.

So the proxy carries the visitor's identity, and counts alongside:

| Header | What it is |
| --- | --- |
| `x-tinyviewers-proxy` | `ADD_FILM_PROXY_SECRET`, so the API can tell this proxy from an anonymous caller |
| `x-tinyviewers-client` | the visitor's address, or `unknown` |

Both are sent only when `ADD_FILM_PROXY_SECRET` is set. An unsigned client header is worth nothing
to the API, so with no secret configured neither header is sent at all and the API falls back to
the address it can see for itself. Set the same value on both sides; the API must ignore
`x-tinyviewers-client` from any caller that did not present the matching secret.

The address comes from `x-real-ip`, or the first entry of `x-forwarded-for`, and **only on Vercel**
(`VERCEL=1`), because those headers are whatever the previous hop wrote and anywhere else the
previous hop may be the attacker. Off Vercel the address is `unknown`.

The demo POSTs (`forwardDemoPost`) carry no passcode and are forwarded with the same byte limit and
the same identity headers. `/api/demo/runs` is also counted here: five runs that the API accepted
(202) from one visitor inside ten minutes, and the next is a 429 `too_many_runs` without touching the
API — the API's own ceiling, so the two limiters cannot disagree. The API additionally limits runs
that need a subtitle download, which only it can know about.

`lib/scene-api.ts` also keeps its own counter on the passcoded POSTs to `/api/add/*`: ten 401s from one address
inside ten minutes and the next request is a 429 `too_many_attempts` without touching the API — the
same window and ceiling as the API's, so two limiters cannot produce a refusal neither can explain.
`unknown` is never throttled: it is not an address, it is the absence of one, shared by every caller
this app cannot tell apart, and throttling that bucket would be the bug the limiter exists to fix.

Two honest limitations. The map is per-instance, so an attacker spread across cold starts is not
slowed by it — it stops the dumb case for free, and that is all it claims. And off Vercel it does
nothing at all, because there is no trustworthy client address to key it on. **The real answer is a
Vercel firewall rate-limit rule on `/api/add/*`**, which runs before the function and survives
scaling; this is the floor under it, not a substitute for it.

### Developing against a mock of the contract

`scripts/mock-scene-api.mjs` answers `/api/demo/*` and `/api/add/*` with real v10.4 output for three
films (`scripts/mock-scene-api.fixture.json`: v10.4's merge and select re-run on round 9's stored
outputs, with each reason's question and Jev's line) and **simulated progress** — it is a mock, and the one
place a clock drives the numbers. Development only; nothing in the app imports it.

```sh
node scripts/mock-scene-api.mjs                         # http://localhost:8788
SCENE_API_URL=http://localhost:8788 npm run dev
```

A mock run goes through the real API's stages one at a time, in its order (scene breaks, descriptions,
questions per scene, where to skip), and names the one running in `stage`.
`GET /__mock/mode?set=cap|down|empty|notready|flaky|differs|normal` switches state (`differs`: a finished run's list differs from the page's); run ids
`fixed-<slug>-t<ms>`, `fixed-<slug>-done`, `fixed-<slug>-fail` and job ids `fixed-addjob-t<ms>` are
frozen at one moment, for screenshots (`/library?job=fixed-addjob-t010000` is the film being read, `…t050000` the questions).

### Running the live runs and the add flow locally

`npm run dev` alone is enough for the library and the film pages. Live runs and the add form need the
scene API as well, with the keys in its environment:

```sh
cd ../scene-api && node server.js --pglite      # http://localhost:8787
cd ../web && SCENE_API_URL=http://localhost:8787 npm run dev
```

Without it the status read fails and the page says "Can't tell right now" — which is deliberately
**not** what it says when the API answers and reports no passcode ("Adding is switched off"). One is
news about the service, the other is news about the deployment's configuration, and the page that
conflated them sent the owner hunting for a missing environment variable during an outage.
