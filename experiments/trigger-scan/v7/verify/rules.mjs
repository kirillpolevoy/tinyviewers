#!/usr/bin/env node
// Verifier: rules 1/2 on held-out films, own code. No model calls. Prints numbers and ids only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../scene-api/load.js';

const V7 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS = path.resolve(V7, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const merge = (sp) => { const s = sp.filter((x) => x[1] > x[0]).map((x) => [...x]).sort((a, b) => a[0] - b[0]); const o = []; for (const x of s) { if (o.length && x[0] <= o.at(-1)[1]) o.at(-1)[1] = Math.max(o.at(-1)[1], x[1]); else o.push(x); } return o; };
const cov = (u, a, b) => { if (b <= a) return u.some(([x, y]) => a >= x && a <= y) ? 1 : 0; let t = 0; for (const [x, y] of u) t += Math.max(0, Math.min(y, b) - Math.max(x, a)); return t / (b - a); };
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));

const policy = rj(path.join(V7, 'policy.json'));
for (const slug of ['iron-giant', 'up']) {
  const key = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const items = key.items.filter((i) => i.source === 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const auditFalse = (key.audit ?? []).filter?.((a) => /false/i.test(JSON.stringify(a.verdict ?? a))).map((a) => a.id) ?? [];
  const tags = rj(path.join(V7, 'out', `${slug}.tags.r1.json`));
  const fl = tags.scenes.filter((s) => s.flagged);
  const reasonIds = [...new Set(fl.flatMap((s) => s.flag_reasons.map((r) => `${r.id}|${r.rule}`)))];
  console.log(`\n== ${slug}: codex rule items ${items.length} (laughs ${items.filter((i) => i.played_for_laughs).length}); audit-false ids per key.audit: ${auditFalse.join(',') || '(none parsed)'}`);
  console.log(' distinct flag reason id|rule:', reasonIds.join(' '));
  const R1 = (id) => ['threatens_harm', 'plots_harm'].includes(id) || /_threatens$/.test(id);
  const R2 = (id) => id === 'child_frightened';
  const only = fl.filter((s) => s.flag_reasons.length && s.flag_reasons.every((r) => R1(r.id) || R2(r.id)));
  for (const s of only) {
    const sk = merge((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const inSkip = items.filter((i) => cov(sk, i.start_ms, i.end_ms) >= 0.5);
    const inScene = items.filter((i) => cov([[s.start_ms, s.end_ms]], i.start_ms, i.end_ms) >= 0.5);
    console.log(`  rule-only ${s.id} cues ${s.start_cue}-${s.end_cue} reasons ${s.flag_reasons.map((r) => r.id + ':' + r.p).join(',')} comic_peril p=${s.modifiers?.comic_peril?.p} laughs=${s.modifiers?.comic_peril?.laughs} on=${s.modifiers?.comic_peril?.on} | skip items: ${inSkip.map((i) => i.id + (i.played_for_laughs ? '(laughs)' : '')).join(',') || '-'} | scene items: ${inScene.map((i) => i.id + (i.played_for_laughs ? '(laughs)' : '')).join(',') || '-'}`);
  }
  const skipU = merge(fl.flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
  const flagU = merge(fl.map((s) => [s.start_ms, s.end_ms]));
  let db = null; try { db = merge(L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds }).scenes.map((s) => [s.start_ms, s.end_ms])); } catch {}
  const count = (pool, u) => pool.filter((i) => cov(u, i.start_ms, i.end_ms) >= 0.5).length;
  const bad = new Set(slug === 'iron-giant' ? ['C02'] : ['C07']);
  const clean = items.filter((i) => !i.played_for_laughs && !bad.has(i.id));
  console.log(` recall all: v7 skip ${count(items, skipU)}/${items.length}, flagged scenes ${count(items, flagU)}/${items.length}, live DB ${db ? count(items, db) : '-'}/${items.length}`);
  console.log(` recall clean: v7 skip ${count(clean, skipU)}/${clean.length}, flagged scenes ${count(clean, flagU)}/${clean.length}, live DB ${db ? count(clean, db) : '-'}/${clean.length}`);
  console.log(' items missed by v7 skip:', items.filter((i) => cov(skipU, i.start_ms, i.end_ms) < 0.5).map((i) => `${i.id}${i.played_for_laughs ? '(laughs)' : ''}`).join(','), db ? ' | missed by DB: ' + items.filter((i) => cov(db, i.start_ms, i.end_ms) < 0.5).map((i) => i.id).join(',') : '');
}
