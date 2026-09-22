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
| `SCENE_API_URL` | the deployed app | only for the add flow on `/watch` — without it the app looks for `http://localhost:8787`, the status read fails, and the form is replaced by "Can't tell right now". Everything else on `/watch` comes from the database and is unaffected |
| `ADD_FILM_PROXY_SECRET` | the deployed app **and** the scene API, same value | no — without it the add flow works and the API simply cannot tell one visitor from another. See "Who is asking" below |
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
  positions on the timeline, the shelf's tilts — all computed from database values, never from
  anything a visitor supplies.

Fonts are self-hosted by `next/font`, so nothing is fetched from Google at runtime and `font-src`
needs no external host.

## How it is put together

| Path | What lives there |
| --- | --- |
| `app/` | Routes: `/`, `/library`, `/film/[slug]`, `/watch`, `/watch/[slug]`, `/watch/job/[id]`, the `/api/add/*` handlers, `/api/films/[slug]/recording`, plus `not-found`, `error` and `global-error`. `/search` is gone; `next.config.mjs` redirects it to `/library`, `?q=` and all |
| `components/` | Presentation, including the inline hand-drawn SVG in `Art.tsx` |
| `lib/copy.ts` | Every parent-facing string, in one place |
| `lib/queries.ts` | Every SQL statement, each wrapped in React `cache()` |
| `lib/db.ts` | The `pg` pool (or the dev database); `lib/db-config.ts` holds the pure rules |
| `lib/scenes.ts` | Times, strength marks, filters — pure, and tested |
| `lib/search.ts` | Name matching: case, punctuation, accents, and the "open this one film" rule — pure, tested, and safe to bundle into the browser |
| `lib/replay.ts` | A recorded Jev run reduced to what a browser replays, and the clock that reads it — pure, and tested |
| `lib/taxonomy-labels.ts` | Taxonomy v3 ids → the words a person reads. A copy, on purpose; see the file |
| `lib/scene-api.ts` | The forwarder the `/api/add/*` handlers are made of — pure enough to test with a fake fetch |

### One page for the shelf and the search

There is no search page. `/library` holds every film, and `components/LibraryShelf.tsx` filters the
cards as a parent types, using the same `lib/search.ts` rules the server uses. Three behaviours
follow from one place:

- **`?q=` naming exactly one film redirects to it**, which is what Home's form relies on: a parent
  who types a whole title lands on the scene guide, not on a shelf with one card on it.
- **Anything else renders the shelf pre-filtered**, so the page works with no JavaScript at all —
  the form is a plain GET back to `/library`.
- **With JavaScript, nothing is fetched.** Six films are already on the page; the filter is an
  array filter, the URL is kept in step with `history.replaceState`, and Enter opens the one film
  when the query names one.

Two rules the code enforces rather than trusts:

1. **Nothing about the machinery reaches a parent page.** `lib/queries.ts` selects only `asserted`
   labels and never selects model names, probabilities, confidence or review status.
2. **A missing rating is "Not checked", never a zero.** The two mean different things, and the
   design keeps them apart.

## Watch it work

Three pages in the dark instrument register, and the only corner of the site where the engines are
named. Parent pages say "scenes"; these say Jev, Sonnet, tokens and cents.

| Route | What it is |
| --- | --- |
| `/watch` | The add form, the spend for today, and the films that have a recording |
| `/watch/[slug]` | One recorded run, replayed, then that film's scene list |
| `/watch/job/[id]` | One live run: six steps, then the replay as soon as Jev is done |

The live job page fetches its recording from the scene API the moment Jev's pass ends — which is
minutes before the excerpts are written, so every flagged beat in it has no lines, and the job's own
copy of them is nulled out when the run reaches `done`. By then the film is in this app's own
database with both, so the page asks `/api/films/[slug]/recording` once and merges the lines into
the payload it is already holding (`withLines`). Merged rather than swapped: the replay may be
playing, and handing `RunReplay` a new object mid-run is the one thing that page must not do.

Neither that fetch nor the recording fetch rides the poll any more. The poll stops when the job
stops moving, and anything riding it inherited that: a recording that failed to load at the moment
the run finished was never asked for again. They back off on their own clock and give up on their
own terms.

### The replay never lies about how fast it was

`recordings.recording` is the exact `<slug>.jev.json` the recorder writes: every request that went
out, when it went out, when it came back. `lib/replay.ts` reduces it to a payload of about 150 KB
for Nemo (the file is 1 MB) by keeping every request whole, keeping the six highest answers and the
four scores per beat, and dropping the rest — including `timeline[]`, which is only a running total
of what `requests[]` already says.

`RunReplay` then reads `performance.now()` each frame and asks `replayStateAt` what had landed by
then. Three consequences, all deliberate:

- **No speed control but Replay.** If the run took 5.2 s, the replay takes 5.2 s. There is no
  easing, no fixed interval and no "skip the boring part", because the one claim the page makes is
  that this is how fast it actually was.
- **Counters are derived, never accumulated.** A backgrounded tab or a dropped frame costs a frame,
  not a number, and the totals arrive exactly at `meta` — to the last token and the last microdollar.
- **The finished run is the initial state.** The server renders the summary, the counters and the
  scene list; the animation starts in an effect. So the page works with no JavaScript, and
  `prefers-reduced-motion` needs no special path: it simply never starts.

Beats resolve when the request carrying them lands, which is not film order and is not tidied into
it. A rate-limited window fills a hole behind the sweep, and that is the truth about the run.

That rule binds the keyboard too: only a flagged beat whose request has landed is a control. The
squares are all in the DOM from the first frame so the board does not reflow, but the unlanded ones
are `disabled` and the roving tab stop steps over them — otherwise Tab and the arrow keys would walk
a reader onto a beat the run did not know about yet, on a page whose entire claim is that nothing is
shown before it arrived.

### The add flow, and why it goes through this app

The CSP is `connect-src 'self'`: a page here may only fetch this app. So the browser posts to
`/api/add/{status,resolve,jobs,jobs/[id]}` and `lib/scene-api.ts` forwards each call to
`SCENE_API_URL` server-side, passing status codes and JSON straight through with a 10 s timeout and
no caching anywhere. An upstream answer that is not JSON is **not** relayed — a proxy's HTML error
page would be the one body this app must not pass on — it becomes a 502 with a code.

The passcode travels in the POST body of the two calls that need it, is held in React state while
the form is on screen, and is written nowhere else: no localStorage, no query string, no log line.
Nothing in the forwarder reads a body; its error lines name the endpoint and the failure only.

The body is read off the request stream with a **byte** limit (`MAX_BODY_BYTES`, 8 KB) counted as it
arrives, and the read is abandoned the moment it is passed — a 413, not a fully buffered rejection.

`/api/add/resolve` is the one path with a longer deadline: 30 s rather than 10, because behind it
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

`lib/scene-api.ts` also keeps its own counter on POSTs to `/api/add/*`: ten 401s from one address
inside ten minutes and the next request is a 429 `too_many_attempts` without touching the API — the
same window and ceiling as the API's, so two limiters cannot produce a refusal neither can explain.
`unknown` is never throttled: it is not an address, it is the absence of one, shared by every caller
this app cannot tell apart, and throttling that bucket would be the bug the limiter exists to fix.

Two honest limitations. The map is per-instance, so an attacker spread across cold starts is not
slowed by it — it stops the dumb case for free, and that is all it claims. And off Vercel it does
nothing at all, because there is no trustworthy client address to key it on. **The real answer is a
Vercel firewall rate-limit rule on `/api/add/*`**, which runs before the function and survives
scaling; this is the floor under it, not a substitute for it.

### Running the add flow locally

`npm run dev` alone is enough for `/watch` and `/watch/[slug]` — the recordings are in the in-memory
database. The add form needs the scene API as well:

```sh
cd ../scene-api && node server.js --pglite      # http://localhost:8787
cd ../web && SCENE_API_URL=http://localhost:8787 npm run dev
```

Without it the status read fails and the page says "Can't tell right now" — which is deliberately
**not** what it says when the API answers and reports no passcode ("Adding is switched off"). One is
news about the service, the other is news about the deployment's configuration, and the page that
conflated them sent the owner hunting for a missing environment variable during an outage.
