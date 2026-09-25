#!/usr/bin/env node
// v10.2 fix 3 DEV CHOICE of the resolution-guard rule (16 seen films, IN-SAMPLE; stored answers + the guard answers
// resolve.js --guard wrote to out102/dev; no model calls). Every variant = v10.2 select (tier-A gate + rule 2) with
// policy.flag.resolution_guard set to one candidate rule. The candidates and the choice rule were written down
// before this script was first run:
//   none   no guard
//   A      arrest    cancels Sonnet captured / cage_net_trap / restraints
//   AC     A + celebrate cancels captured / cage_net_trap / restraints / weapon_used / crying
//   ACR    AC + reunion cancels crying
//   AR     A + reunion cancels crying
// POST HOC (added after the first run showed celebrate costing Frozen S003's hit only through crying, and reunion
// costing Frankenweenie S056 / Tangled S055): AW = A + celebrate cancels weapon_used; ACW = AC without crying.
// thresholds 0.5 (the Noul's even point, a priori) and 0.7 (the act threshold) as a sensitivity check.
// CHOICE: among variants that lose NO conservative recall and NO should_flag hit scene against 'none' (pooled, 16
// films), the one that unflags the most scenes with no should_flag item in their skip; ties -> the simpler rule.
//   node dev/guard.mjs -> dev/out/guard.json + a table
import fs from 'node:fs';
import path from 'node:path';
import * as S102 from '../select.js';
import { loadSplit } from '../split.js';
import { FILMS, loadFilm, runSystem, sys, pool, sceneHit, resolveFile, rj, V102 } from '../eval/seen-lib.mjs';

const SPLIT = loadSplit();
const BASE = S102.loadPolicy(path.join(V102, 'policy.json'));
const CAPT = ['captured', 'cage_net_trap', 'restraints'];
const RULES = {
  none: null,
  A: Object.fromEntries(CAPT.map((id) => [id, ['arrest']])),
  AC: { ...Object.fromEntries(CAPT.map((id) => [id, ['arrest', 'celebrate']])), weapon_used: ['celebrate'], crying: ['celebrate'] },
  ACR: { ...Object.fromEntries(CAPT.map((id) => [id, ['arrest', 'celebrate']])), weapon_used: ['celebrate'], crying: ['celebrate', 'reunion'] },
  AR: { ...Object.fromEntries(CAPT.map((id) => [id, ['arrest']])), crying: ['reunion'] },
  AW: { ...Object.fromEntries(CAPT.map((id) => [id, ['arrest']])), weapon_used: ['celebrate'] },
  ACW: { ...Object.fromEntries(CAPT.map((id) => [id, ['arrest', 'celebrate']])), weapon_used: ['celebrate'] },
};
const variants = [];
for (const [name, cancels] of Object.entries(RULES)) for (const t of name === 'none' ? [null] : [0.5, 0.7]) variants.push({ name: t ? `${name}@${t}` : name, guard: cancels ? { cancels, min_p: t } : null });

const films = FILMS.map((slug) => ({ ...loadFilm(slug), resolve: rj(resolveFile(slug)), skip: {}, flagged: {} }));
for (const F of films) for (const v of variants) {
  const cfg = structuredClone(BASE); delete cfg.flag.resolution_guard; if (v.guard) cfg.flag.resolution_guard = v.guard;
  const r = runSystem(F, S102, cfg, { used: SPLIT.sonnet_used, resolve: F.resolve, split: SPLIT });
  F.skip[v.name] = r.skip; F.flagged[v.name] = r.flagged.map((s) => ({ id: s.id, ...sceneHit(F.key, s), reasons: s.flag_reasons.map((x) => `${x.id}/${x.by}`), guard: (s.guard_cancelled ?? []).map((x) => `${x.id}(${x.by_guard.join('+')})`) }));
  F[`guarded_${v.name}`] = r.tags.scenes.filter((s) => (s.guard_cancelled ?? []).length).map((s) => ({ id: s.id, still_flagged: s.flagged, ...(s.flagged ? {} : sceneHit(F.key, { skip: { spans: [{ start_ms: s.start_ms, end_ms: s.end_ms }] } })), cancelled: s.guard_cancelled.map((x) => `${x.id}(${x.by_guard.join('+')})`) }));
}
const P = pool(films, variants.map((v) => v.name));
const rows = variants.map((v) => {
  const s = sys(P.key, P.skips[v.name]);
  const fl = films.flatMap((F) => F.flagged[v.name].map((x) => ({ slug: F.slug, ...x })));
  const base = films.flatMap((F) => F.flagged.none.map((x) => ({ slug: F.slug, ...x })));
  const ids = new Set(fl.map((x) => `${x.slug}:${x.id}`));
  const lost = base.filter((x) => !ids.has(`${x.slug}:${x.id}`));
  return { variant: v.name, flagged: fl.length, conservative_recall: s.conservative_recall, of: s.of, precision_strict: s.precision_strict, precision_gap: s.precision_gap, skip_minutes: s.skip_minutes, tag_only_skipped: s.tag_only_skipped, unflagged_vs_none: lost.map((x) => `${x.slug}:${x.id}${x.hit ? ' HIT' : ''}${x.tag_only ? ' (tag_only)' : ''}`), unflagged_hits: lost.filter((x) => x.hit).length, unflagged_misses: lost.filter((x) => !x.hit).length };
});
const none = rows.find((r) => r.variant === 'none');
const ok = rows.filter((r) => r.variant !== 'none' && r.conservative_recall >= none.conservative_recall && r.unflagged_hits === 0);
const order = Object.keys(RULES);
ok.sort((a, b) => b.unflagged_misses - a.unflagged_misses || order.indexOf(a.variant.split('@')[0]) - order.indexOf(b.variant.split('@')[0]) || Number(a.variant.split('@')[1]) - Number(b.variant.split('@')[1]));
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (16 seen films). Resolution-guard rule choice. AW and ACW were added post hoc (after the first run).', rule: 'no conservative recall lost and no should_flag hit scene unflagged vs none; then most miss scenes unflagged; ties -> simpler rule, then lower threshold', chosen: ok[0]?.variant ?? 'none', rows, guarded_scenes: Object.fromEntries(variants.filter((v) => v.guard).map((v) => [v.name, films.flatMap((F) => F[`guarded_${v.name}`].map((x) => ({ slug: F.slug, ...x })))])) };
fs.mkdirSync(path.join(V102, 'dev', 'out'), { recursive: true });
fs.writeFileSync(path.join(V102, 'dev', 'out', 'guard.json'), JSON.stringify(out, null, 2));
for (const r of rows) console.log(`${r.variant.padEnd(8)} flagged ${r.flagged} cons.recall ${r.conservative_recall}/${r.of} prec ${r.precision_strict}/${r.precision_gap} skip ${r.skip_minutes} tag-only ${r.tag_only_skipped} | unflagged hits ${r.unflagged_hits} misses ${r.unflagged_misses}: ${r.unflagged_vs_none.join(', ')}`);
console.log(`CHOSEN: ${out.chosen}`);
for (const [k, list] of Object.entries(out.guarded_scenes)) if (k.endsWith('@0.5')) console.log(`${k}: ${list.map((x) => `${x.slug}:${x.id}${x.still_flagged ? '(still flagged)' : x.hit ? '(UNFLAGGED HIT)' : '(unflagged)'} ${x.cancelled.join(' ')}`).join(' | ')}`);
