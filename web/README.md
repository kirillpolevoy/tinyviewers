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
| `TMDB_API_KEY` | the scene-api loader only | no — without it `poster_url` and `overview` are null: the UI draws its placeholder and the film page shows no synopsis |
| `TINY_VIEWERS_DB=pglite` | local development only | no — ignored when `NODE_ENV=production` |

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
| `app/` | Routes: `/`, `/library`, `/film/[slug]`, `/watch`, `/watch/[slug]`, plus `not-found`, `error` and `global-error`. `/search` is gone; `next.config.mjs` redirects it to `/library`, `?q=` and all |
| `components/` | Presentation, including the inline hand-drawn SVG in `Art.tsx` |
| `lib/copy.ts` | Every parent-facing string, in one place |
| `lib/queries.ts` | Every SQL statement, each wrapped in React `cache()` |
| `lib/db.ts` | The `pg` pool (or the dev database); `lib/db-config.ts` holds the pure rules |
| `lib/scenes.ts` | Times, strength marks, filters — pure, and tested |
| `lib/search.ts` | Name matching: case, punctuation, accents, and the "open this one film" rule — pure, tested, and safe to bundle into the browser |

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

## Phase 2

`/watch` and `/watch/[slug]` are placeholders in the analysis page's dark register. They show no
numbers at all, because there is no recorded run to show yet.
