#!/usr/bin/env node
// Round-4 HEAD-TO-HEAD baseline: the LIVE pipeline (scene-api/pipeline), imported READ-ONLY as a
// library and run exactly as a live "Add a movie" run builds a film's scenes and labels:
//
//   scenes    pipeline/scenes.js findScenes     one Sonnet pass over the whole cue-tagged transcript
//                                               (the Sonnet-alone arm the live DB was built with)
//   presence  pipeline/presence.js labelPresence one Sonnet call per scene (6 context lines each side)
//   build     scene-api/load.js buildFilmFrom   the single function that turns both runs into the
//                                               scene and label rows (ingest.js's context, rebuilt
//                                               here without ingest.js's database imports)
//
// Nothing in scene-api is modified; its defaults (model, effort, 16k output ceiling, $0.60 / $1.00
// caps, concurrency 5, quotation rule) are used as they are. The Jev screening recording is not run:
// buildFilmFrom never asserts a label from it (Jev beats are a second opinion only), so it cannot
// change a scene, a span or an asserted tag.
//
// Input: the same stored SRT the v8 run reads (experiments/trigger-scan/data/<slug>.srt) and the
// films.json entry. Keys are parsed in Node from the two .env.local files (env.js key()); never printed.
// Spend: each priced response is appended to baseline/out/<slug>.spend.json as it lands (onSpend);
// before each stage its whole cap is reserved against the $3.00 head-to-head cap (spend.mjs).
// Outputs (git-ignored, they hold model text about the film): baseline/out/<slug>.scenes.json,
// <slug>.presence.json, <slug>.built.json. A stage whose output exists is not re-run.
//
//   node baseline/run-live.mjs <slug> [<slug>...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findScenes, COST_CAP_USD as SCENES_CAP } from '../../../../scene-api/pipeline/scenes.js';
import { labelPresence, COST_CAP_USD as PRESENCE_CAP } from '../../../../scene-api/pipeline/presence.js';
import * as srt from '../../../../scene-api/pipeline/srt.js';
import * as taxonomy from '../../../../scene-api/pipeline/taxonomy-v3.js';
import { buildFilmFrom, buildVocabulary, buildV2Map } from '../../../../scene-api/load.js';
import { key, TS } from '../env.js';
import { reserve, HELD } from './spend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');
fs.mkdirSync(OUT, { recursive: true });
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const wj = (f, x) => fs.writeFileSync(f, JSON.stringify(x, null, 2));

const ledgerFile = (slug) => path.join(OUT, `${slug}.spend.json`);
function bank(slug, stage, usd) {
  const f = ledgerFile(slug);
  const l = fs.existsSync(f) ? rj(f) : { entries: [] };
  l.entries.push({ at: new Date().toISOString(), script: `baseline/run-live.mjs ${stage}`, kind: 'sonnet', usd: +usd.toFixed(6) });
  l.total = +l.entries.reduce((a, e) => a + e.usd, 0).toFixed(6);
  wj(f, l);
}

const slugs = process.argv.slice(2);
if (!slugs.length || slugs.some((s) => !HELD.includes(s))) { console.error(`usage: node baseline/run-live.mjs <${HELD.join('|')}>...`); process.exit(2); }
const apiKey = key('CLAUDE_API_KEY');
const films = rj(path.join(TS, 'films.json'));

for (const slug of slugs) {
  const meta = films[slug];
  const film = { slug, title: meta.title, year: meta.year ?? null, imdb_id: meta.imdb_id ?? null };
  const srtText = fs.readFileSync(path.join(TS, meta.track ?? `data/${slug}.srt`), 'utf8');
  const cues = srt.parseSrt(srtText);

  const scenesFile = path.join(OUT, `${slug}.scenes.json`);
  if (!fs.existsSync(scenesFile)) {
    const r = reserve(SCENES_CAP);
    if (!r.ok) { console.error(`${slug} scenes: REFUSED by head-to-head cap (spent ${r.spent.toFixed(4)} + ${SCENES_CAP} > ${r.cap})`); process.exit(3); }
    const t0 = Date.now();
    const run = await findScenes({ film, cues, apiKey, onSpend: (usd) => bank(slug, 'scenes', usd) });
    wj(scenesFile, run);
    console.log(`${slug} scenes: ${run.scenes.length} scenes (returned ${run.returned_scenes}, invalid ${run.invalid_cues}, zero-sev ${run.dropped_zero_severity}, dup ${run.dropped_duplicate}, quoting title ${run.dropped_quoting_title}, redacted desc ${run.redacted_descriptions}); $${run.cost_usd.toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const sceneRun = rj(scenesFile);

  const presenceFile = path.join(OUT, `${slug}.presence.json`);
  if (!fs.existsSync(presenceFile)) {
    const r = reserve(PRESENCE_CAP);
    if (!r.ok) { console.error(`${slug} presence: REFUSED by head-to-head cap (spent ${r.spent.toFixed(4)} + ${PRESENCE_CAP} > ${r.cap})`); process.exit(3); }
    const t0 = Date.now();
    const run = await labelPresence({ film, cues, scenes: sceneRun.scenes, apiKey, onSpend: (usd) => bank(slug, 'presence', usd) });
    wj(presenceFile, run ?? { null_run: true });
    console.log(`${slug} presence: ${run?.scenes_asked ?? 0} asked, ${run?.scenes_skipped ?? 0} skipped, stopped ${run?.stopped ?? null}; $${(run?.cost_usd ?? 0).toFixed(4)}; ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  const presenceRaw = rj(presenceFile);
  const presenceRun = presenceRaw.null_run ? null : presenceRaw;

  // ingest.js ingestContext(), without ingest.js's database imports
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
