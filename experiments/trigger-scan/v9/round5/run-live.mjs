#!/usr/bin/env node
// Round-5 LIVE baseline: identical to v8/baseline/run-live.mjs (round 4) except for the held-out slugs,
// the output directory (round5/live) and per-stage invocation. The LIVE pipeline (scene-api/pipeline)
// is imported READ-ONLY as a library and run exactly as a live "Add a movie" run builds scenes/labels:
//   scenes    pipeline/scenes.js findScenes       one Sonnet pass over the cue-tagged transcript
//   presence  pipeline/presence.js labelPresence   one Sonnet call per scene
//   build     scene-api/load.js buildFilmFrom      scene and label rows (no model)
// scene-api defaults are used as they are (model, effort, $0.60 / $1.00 caps, concurrency, quote rule).
// Before each model stage its whole cap is reserved against the $3.00 phase cap (spend.mjs), counting
// in-flight reservations passed by the orchestrator in R5_PENDING.
//   node round5/run-live.mjs <slug> [scenes|presence|build|all]
import fs from 'node:fs';
import path from 'node:path';
import { findScenes, COST_CAP_USD as SCENES_CAP } from '../../../../scene-api/pipeline/scenes.js';
import { labelPresence, COST_CAP_USD as PRESENCE_CAP } from '../../../../scene-api/pipeline/presence.js';
import * as srt from '../../../../scene-api/pipeline/srt.js';
import * as taxonomy from '../../../../scene-api/pipeline/taxonomy-v3.js';
import { buildFilmFrom, buildVocabulary, buildV2Map } from '../../../../scene-api/load.js';
import { key, TS } from '../env.js';
import { reserve, HELD, LIVE_OUT as OUT } from './spend.mjs';

export { SCENES_CAP, PRESENCE_CAP };
fs.mkdirSync(OUT, { recursive: true });
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const wj = (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 2));
const PENDING = Number(process.env.R5_PENDING ?? 0);

function bank(slug, stage, usd) {
  const f = path.join(OUT, `${slug}.spend.json`);
  const l = fs.existsSync(f) ? rj(f) : { entries: [] };
  l.entries.push({ at: new Date().toISOString(), script: `round5/run-live.mjs ${stage}`, kind: 'sonnet', usd: +usd.toFixed(6) });
  l.total = +l.entries.reduce((a, e) => a + e.usd, 0).toFixed(6);
  wj(f, l);
}

const [slug, stage = 'all'] = process.argv.slice(2);
if (!HELD.includes(slug) || !['scenes', 'presence', 'build', 'all'].includes(stage)) { console.error(`usage: node round5/run-live.mjs <${HELD.join('|')}> [scenes|presence|build|all]`); process.exit(2); }
const apiKey = key('CLAUDE_API_KEY');
const meta = rj(path.join(TS, 'films.json'))[slug];
const film = { slug, title: meta.title, year: meta.year ?? null, imdb_id: meta.imdb_id ?? null };
const srtText = fs.readFileSync(path.join(TS, meta.track ?? `data/${slug}.srt`), 'utf8');
const cues = srt.parseSrt(srtText);
const want = (s) => stage === 'all' || stage === s;

const scenesFile = path.join(OUT, `${slug}.scenes.json`);
if (want('scenes') && !fs.existsSync(scenesFile)) {
  const r = reserve(SCENES_CAP, PENDING);
  if (!r.ok) { console.error(`${slug} scenes: REFUSED by phase cap (spent ${r.spent.toFixed(4)} + pending ${PENDING} + ${SCENES_CAP} > ${r.cap})`); process.exit(3); }
  const t0 = Date.now();
  const run = await findScenes({ film, cues, apiKey, onSpend: (usd) => bank(slug, 'scenes', usd) });
  wj(scenesFile, run);
  console.log(`${slug} scenes: ${run.scenes.length} scenes (returned ${run.returned_scenes}, invalid ${run.invalid_cues}, zero-sev ${run.dropped_zero_severity}, dup ${run.dropped_duplicate}, quoting title ${run.dropped_quoting_title}, redacted desc ${run.redacted_descriptions}); $${run.cost_usd.toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)} s`);
}
const presenceFile = path.join(OUT, `${slug}.presence.json`);
if (want('presence') && !fs.existsSync(presenceFile)) {
  const sceneRun = rj(scenesFile);
  const r = reserve(PRESENCE_CAP, PENDING);
  if (!r.ok) { console.error(`${slug} presence: REFUSED by phase cap (spent ${r.spent.toFixed(4)} + pending ${PENDING} + ${PRESENCE_CAP} > ${r.cap})`); process.exit(3); }
  const t0 = Date.now();
  const run = await labelPresence({ film, cues, scenes: sceneRun.scenes, apiKey, onSpend: (usd) => bank(slug, 'presence', usd) });
  wj(presenceFile, run ?? { null_run: true });
  console.log(`${slug} presence: ${run?.scenes_asked ?? 0} asked, ${run?.scenes_skipped ?? 0} skipped, stopped ${run?.stopped ?? null}; $${(run?.cost_usd ?? 0).toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)} s`);
}
if (want('build')) {
  const sceneRun = rj(scenesFile);
  const presenceRaw = rj(presenceFile);
  const presenceRun = presenceRaw.null_run ? null : presenceRaw;
  const { items } = buildVocabulary(taxonomy);
  const ctx = { srt, v2map: buildV2Map(taxonomy), vocabIds: new Set(items.map((i) => i.id)) };
  const built = buildFilmFrom({
    slug, meta: { title: film.title, year: film.year, imdb_id: film.imdb_id }, srtText, releaseLabel: null,
    sceneRun, sceneScript: 'pipeline/scenes.js', sceneSourceFile: null, r2Scenes: null,
    presenceRun, presenceScript: 'pipeline/presence.js', presenceSourceFile: null,
    jevRun: null, jevScript: 'pipeline/record.js', jevSourceFile: null,
  }, ctx);
  wj(path.join(OUT, `${slug}.built.json`), { film: built.film, scenes: built.scenes, labels: built.labels, report: built.report });
  console.log(`${slug} built: ${built.scenes.length} scenes, ${built.labels.length} labels (${built.report.counts.events} events, ${built.report.counts.asserted_presence} presence)`);
}
