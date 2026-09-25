// extra checks: per-film narrow(respan) vs v9 verdicts, film-level context changes, specific Sonnet answers
import fs from 'node:fs'; import path from 'node:path';
import { parseSrt } from '../../../srt.js';
import { selectRun, loadPolicy } from '../../select.js';
import { respanScenes } from '../../moments.js';
import { loadSplit } from '../../split.js';
import { scoreKey, sensitivity, compareSystems } from '../../refscore.js';
const V9 = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const TS = path.resolve(V9, '..'); const OUT = path.join(V9, 'out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const v = rj(path.join(V9, 'narrow/verify/out/verify.json'));
const split = loadSplit(); const pol = loadPolicy();
const R = v.routing.ge4; const cfg = structuredClone(pol);
const keep = (q) => !R.dropped.includes(q);
cfg.flag.strong_events = cfg.flag.strong_events.filter(keep); for (const t of ['always','with_danger','with_creature_threat']) cfg.flag.presence[t] = cfg.flag.presence[t].filter(keep); cfg.flag.film_specific_types = [];
for (const slug of ['book-of-life','princess-and-the-frog','moana']) {
  const run = rj(path.join(OUT, `${slug}.jev.r1.json`)), sonnet = rj(path.join(OUT, `${slug}.sonnetq.r1.json`)), moments = rj(path.join(OUT, `${slug}.moments.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const a = selectRun(run, cfg, { moments, cues, sonnet, used: R.used }); const b = selectRun(run, pol, { moments, cues, sonnet, used: split.sonnet_used });
  const sp = respanScenes({ tags: a, saved: moments, cues, items: run.film_items ?? [], cfg });
  const aSkip = a.scenes.filter((s) => s.flagged).flatMap((s) => sp[s.id].spans.map((x) => [x.start_ms, x.end_ms]));
  const bSkip = b.scenes.filter((s) => s.flagged).flatMap((s) => s.skip.spans.map((x) => [x.start_ms, x.end_ms]));
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`)); const key = { ...k, items: k.items.filter((i) => i.source !== 'codex-rules') };
  const vv = compareSystems({ aStrict: scoreKey(key, aSkip), aGap: scoreKey(key, aSkip, { window: 'gap' }), bStrict: scoreKey(key, bSkip), bGap: scoreKey(key, bSkip, { window: 'gap' }), sens: sensitivity(key, aSkip, bSkip) });
  console.log(slug, 'narrow vs v9: recall', vv.recall, 'precision', vv.precision, 'overall', vv.overall);
  console.log('  context v9', b.summary.film_level_notes.map((n) => n.id).join(','), '| narrow', a.summary.film_level_notes.map((n) => n.id).join(','));
}
const q = (slug, sid, qq) => { const s = rj(path.join(OUT, `${slug}.sonnetq.r1.json`)).scenes[sid]; return JSON.stringify(s?.[qq] ?? 'unlisted'); };
console.log('moana S016 loved_one_dies sonnet', q('moana','S016','loved_one_dies'), '| S024 threatens_harm sonnet', q('moana','S024','threatens_harm'));
const t = rj(path.join(OUT, 'moana.tags.r1.json')); for (const id of ['S016','S024']) { const s = t.scenes.find((x) => x.id === id); console.log('  v9 moana', id, s.flag_reasons.map((r) => `${r.id}:${r.by}:${r.p}`).join(' ')); }
