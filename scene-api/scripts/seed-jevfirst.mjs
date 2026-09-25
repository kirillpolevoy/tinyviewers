#!/usr/bin/env node
// Seed the Jev-first artifact tables from the experiment's own outputs, so the live demo has films to
// run on. LOCAL POSTGRES ONLY: it refuses any DATABASE_URL whose host is not this machine.
//
//   DATABASE_URL=postgres://postgres@localhost:5544/jevship \
//     node scripts/seed-jevfirst.mjs --experiment ../experiments/trigger-scan [--films frozen,coco] [--dry-run]
//
// For each film it takes the newest complete set of outputs, in this order:
//   v10_4/out104   v10.4 runs
//   v10_3/out103   v10.3 runs (round 9: croods, onward, kung-fu-panda) -- same Sonnet steps as v10.4
//   v10_2/out102   v10.2 runs
//   v10_1/out101   the v10.1 runs (frozen, good-dinosaur, zootopia)
//   v10/out10      v10's re-runs
//   v10/out        the thirteen dev films through v10
// A film whose stored descriptions are an older describe version is skipped (the demo would refuse it).
// Library films normally need no seeding: a rebuild (POST /api/admin/rebuild) writes their artifacts.
// and writes, per film: its subtitle track into subtitle_tracks (the exact file its segmentation used,
// found by sha256 among data/<slug>*.srt), and its documents into jevfirst_films / jevfirst_artifacts /
// jevfirst_ledger. It NEVER touches films, tracks, scenes or scene_labels: a library film seeded here
// keeps its live guide exactly as it was (test/jevfirst.test.js checks that).
//
// A film is skipped, and says why, when its stored Sonnet answers were asked a question list or prompt
// that differs from the pack's (select.js would refuse them, and so does the demo), or when its track
// cannot be matched by sha256.
//
// --backfill-sonnetq (SPENDS MONEY; needs CLAUDE_API_KEY in the environment): for a film whose only
// incompatible document is its Sonnet answers (the thirteen v10 dev films carry v9's sonnetq), ask
// Sonnet the pack's ten concepts once, with the real sonnetq stage (stages/answers.js: the same
// prompt, batching, reserve-before-dispatch and $0.30-per-film cap as an add), over the film's stored
// checked scenes, and store that instead. About $0.10-0.15 a film. Its spend goes in the film's ledger.
// Without the flag nothing is ever sent anywhere.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../pipeline/srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORDER = ['v10_4/out104', 'v10_3/out103', 'v10_2/out102', 'v10_1/out101', 'v10/out10', 'v10/out'];
const SOURCES = ['v10_4/sources', 'v10_3/sources', 'v10_2/sources', 'v10_1/sources', 'v10/sources'];
const REQUIRED = { segments: 'segments.json', segments_precheck: 'segments.precheck.json', segments_raw: 'segments.raw.json', sonnetq: 'sonnetq.r1.json', describe: 'describe.r1.json' };
const OPTIONAL = { fill: 'fill.json', claims: 'claims.json', jev: 'jev.r1.json', childcry: 'childcry.r1.json', resolve: 'resolve.r1.json', mortal: 'mortal.r1.json', moments: 'moments.r1.json', why: 'why.r1.json', describe2: 'describe2.r1.json', why2: 'why2.r1.json', describe3: 'describe3.r1.json', why3: 'why3.r1.json', whyfinal: 'whyfinal.r1.json', tags: 'tags.r1.json' };
const LEDGER_STAGE = { 'segment.js': 'segment', 'check-split.js': 'split_check', 'check-claims.js': 'claims', 'fill.js': 'fill', 'classify.js': 'classify', 'sonnetq.js': 'sonnetq', 'childcry.js': 'childcry', 'resolve.js': 'resolve', 'mortal.js': 'mortal', 'moments.js': 'moments', 'describe.js': 'describe', 'check-describe.js': 'check_describe', 'describe2.js': 'describe2', 'describe2.js --titles': 'titles', 'reasons.js': 'reasons' };

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(u.hostname);
  } catch { return false; }
}

/** Every film with a complete set, newest set first. */
export function findFilms(exp) {
  const out = new Map();
  for (const dir of ORDER) {
    const abs = path.join(exp, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      const m = f.match(/^(.+)\.segments\.json$/);
      if (!m || out.has(m[1])) continue;
      const slug = m[1];
      const files = Object.fromEntries(Object.entries(REQUIRED).map(([k, suffix]) => [k, path.join(abs, `${slug}.${suffix}`)]));
      if (Object.values(files).some((p) => !fs.existsSync(p))) continue;
      for (const [k, suffix] of Object.entries(OPTIONAL)) { const p = path.join(abs, `${slug}.${suffix}`); if (fs.existsSync(p)) files[k] = p; }
      const spend = path.join(abs, `${slug}.spend.json`);
      const src = SOURCES.map((d) => path.join(exp, d, `${slug}.json`)).find((p) => fs.existsSync(p));
      if (!src) continue;
      out.set(slug, { slug, dir, files, spend: fs.existsSync(spend) ? spend : null, sources: src });
    }
  }
  return [...out.values()];
}

/** The SRT whose sha256 the segmentation recorded. */
export function matchTrack(exp, slug, sha) {
  const dataDir = path.join(exp, 'data');
  const candidates = fs.readdirSync(dataDir).filter((f) => f === `${slug}.srt` || (f.startsWith(`${slug}.`) && f.endsWith('.srt')));
  for (const f of candidates) {
    const buf = fs.readFileSync(path.join(dataDir, f));
    if (sha256(buf) === sha) return { file: f, text: buf.toString('utf8') };
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const exp = path.resolve(opt('experiment', path.join(here, '..', '..', 'experiments', 'trigger-scan')));
  const dry = argv.includes('--dry-run');
  const only = opt('films', null)?.split(',');
  const backfill = argv.includes('--backfill-sonnetq');
  if (backfill && !dry && !process.env.CLAUDE_API_KEY) { console.error('--backfill-sonnetq needs CLAUDE_API_KEY in the environment (node --env-file=../.env.local ...).'); process.exit(2); }
  const url = process.env.DATABASE_URL;
  if (!dry) {
    if (!url) { console.error('DATABASE_URL is not set (a LOCAL Postgres).'); process.exit(2); }
    if (!isLocalUrl(url)) { console.error('Refusing: DATABASE_URL does not point at this machine. The seed runs against a local Postgres only.'); process.exit(2); }
  }
  const { applySchema, pgAdapter, guardPool } = await import('../lib/db.js');
  const { storeTrack, writeArtifacts, imdbKey } = await import('../pipeline-jevfirst/store.js');
  const { loadSplit } = await import('../pipeline-jevfirst/pack/split.js');
  const { SONNET_Q_VERSION, promptHash } = await import('../pipeline-jevfirst/pack/sonnet-questions.js');
  const { DESCRIBE_VERSION } = await import('../pipeline-jevfirst/pack/describe.js');
  const { demoReserveFor } = await import('../pipeline-jevfirst/demo.js');
  const { PIPELINE_VERSION } = await import('../pipeline-jevfirst/stages/ingest.js');
  const split = loadSplit();

  let db = null;
  if (!dry) {
    const { default: pg } = await import('pg');
    db = pgAdapter(guardPool(new pg.Pool({ connectionString: url }), 'seed'));
    await applySchema(db);
  }
  const films = findFilms(exp).filter((f) => !only || only.includes(f.slug));
  let seeded = 0;
  for (const f of films) {
    const docs = Object.fromEntries(Object.entries(f.files).map(([k, p]) => [k, readJson(p)]));
    const src = readJson(f.sources);
    docs.sources = src;
    const sq = docs.sonnetq;
    const sqOk = sq.version === SONNET_Q_VERSION && JSON.stringify(sq.split?.sonnet_asked ?? []) === JSON.stringify(split.sonnet_asked) && (!sq.prompt_sha256_12 || sq.prompt_sha256_12 === promptHash(split.sonnet_asked));
    if (!sqOk && !backfill) { console.log(`skip ${f.slug}: its Sonnet answers (${sq.version}) were asked a different question list or prompt than the pack's (--backfill-sonnetq asks again, ~$0.10-0.15)`); continue; }
    if (docs.describe.version !== DESCRIBE_VERSION) { console.log(`skip ${f.slug}: describe ${docs.describe.version} is not ${DESCRIBE_VERSION}`); continue; }
    const sha = docs.segments.sources?.srt?.sha256;
    const track = sha ? matchTrack(exp, f.slug, sha) : null;
    if (!track) { console.log(`skip ${f.slug}: no data/${f.slug}*.srt matches the segmentation's sha256`); continue; }
    const backfillLedger = [];
    if (!sqOk) {
      if (dry) { console.log(`would ask Sonnet the pack's questions again for ${f.slug} (its stored answers are ${sq.version})`); }
      else {
        const done = await backfillSonnetq({ docs, cues: parseSrt(track.text) });
        docs.sonnetq = done.sonnetq;
        backfillLedger.push({ stage: 'sonnetq', model: 'sonnet', usd: done.sonnetq.cost_usd, note: `backfilled for the demo: the stored ${sq.version} answers were asked a different question list` });
        console.log(`  asked Sonnet again for ${f.slug}: ${done.sonnetq.calls.length} calls, $${done.sonnetq.cost_usd}${done.sonnetq.complete ? '' : ' (INCOMPLETE)'}`);
        if (!done.sonnetq.complete) { console.log(`  skip ${f.slug}: Sonnet did not answer every scene`); continue; }
      }
    }
    const film = { slug: f.slug, imdb_id: src.film.imdb_id, title: src.film.title, year: src.film.year ?? null, poster_url: null };
    const ledgerSeed = f.spend ? (readJson(f.spend).entries ?? []).filter((e) => e.usd > 0).map((e) => ({ stage: LEDGER_STAGE[e.script] ?? e.script, model: e.kind === 'sonnet' ? 'sonnet' : 'jev', usd: e.usd, note: `${f.dir}: ${e.note ?? ''}`.slice(0, 300), at: e.at })) : [];
    const ledger = [...ledgerSeed, ...backfillLedger];
    const total = ledger.reduce((a, e) => a + e.usd, 0);
    console.log(`${dry ? 'would seed' : 'seed'} ${f.slug} from ${f.dir}: ${docs.segments_precheck.scenes.length} scenes, track ${track.file}, ${Object.keys(docs).length} documents, recorded spend $${total.toFixed(4)}`);
    if (dry) continue;
    await storeTrack(db, film.imdb_id, { srtText: track.text, release: null, hearingImpaired: /\(|\[/.test(track.text.slice(0, 20000)), source: `experiment:data/${track.file}` });
    const { rows } = await db.query('select sha256 from subtitle_tracks where imdb_id = $1', [imdbKey(film.imdb_id)]);
    if (rows[0]?.sha256 !== sha) { console.log(`  WARNING ${f.slug}: subtitle_tracks already holds a different file for ${film.imdb_id}; artifacts not written`); continue; }
    await db.withTransaction((tx) => writeArtifacts(tx, film, docs, { origin: 'seed', pipelineVersion: `${PIPELINE_VERSION} (seeded from ${f.dir})`, demoReserveUsd: demoReserveFor(), ledger }));
    seeded++;
  }
  console.log(`${dry ? 'dry run: ' : ''}${seeded} of ${films.length} films seeded${dry ? ' (nothing written)' : ''}`);
  if (db) await db.end();
}

/** The real sonnetq stage over a stored film, with a Claude key from the environment. */
async function backfillSonnetq({ docs, cues }) {
  const { sonnetqStage } = await import('../pipeline-jevfirst/stages/answers.js');
  const { withRun, runCtx } = await import('../pipeline-jevfirst/context.js');
  const { budget } = await import('../pipeline-jevfirst/pack/budget.js');
  const S = {
    mode: 'add', cues,
    out: (id) => (id === 'refold' ? { segments: docs.segments } : null),
    wallet: (name, cap) => { const b = budget(cap); return { budget: b, cap, run: (fn) => withRun({ ...runCtx() }, fn) }; },
    detail: () => {},
  };
  const sonnetq = await withRun({ keys: { claude: process.env.CLAUDE_API_KEY } }, () => sonnetqStage(S));
  return { sonnetq };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
