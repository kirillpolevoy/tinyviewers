// Verifier helper (read-only): renders each review item with its v5 scene data and the subtitle
// lines of its cue range into verify/out/review-<film>.txt (git-ignored; holds subtitle text).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const v5 = path.resolve(here, '..');
const review = JSON.parse(fs.readFileSync(path.join(v5, 'review/review.json'), 'utf8'));
const byFilm = {};
for (const it of review.items) (byFilm[it.film] ||= []).push(it);
for (const [film, items] of Object.entries(byFilm)) {
  const cues = parseSrt(fs.readFileSync(path.resolve(v5, '..', 'data', `${film}.srt`), 'utf8'));
  const moments = JSON.parse(fs.readFileSync(path.join(v5, 'out', `${film}.moments.r1.json`), 'utf8')).scenes;
  const out = [];
  items.forEach((it, n) => {
    out.push(`\n################ ${n} ${film} ${it.kind} ${it.why}`);
    if (it.baseline) out.push(`BASELINE ${it.baseline.id} "${it.baseline.title}" ${it.baseline.start}-${it.baseline.end} cues ${it.baseline.start_cue}-${it.baseline.end_cue} sev ${JSON.stringify(it.baseline.severity)} tags ${(it.baseline.tags||[]).map((t) => t.id).join(',')}`);
    for (const k of Object.keys(it)) if (!['film','kind','why','baseline','v5_scenes','cue_range','held_out'].includes(k)) out.push(`${k}: ${JSON.stringify(it[k]).slice(0, 600)}`);
    const skipSpans = [];
    for (const s of it.v5_scenes || []) {
      out.push(`--- v5 ${s.id} ${s.start}-${s.end} cues ${s.start_cue}-${s.end_cue} FLAGGED=${s.flagged} sev=${JSON.stringify(s.severity)} setting=${s.setting}`);
      for (const se of s.sentences || []) out.push(`   sent [${se.check?.verdict} ${se.check?.confidence} ${se.check?.status}] ${se.text} {${se.cites.join(',')}}`);
      out.push(`   cast: ${(s.cast_involved||[]).map((c) => `${c.id} ${c.name} v:${c.verified.disposition}/${c.verified.kind} c:${c.claimed.disposition}`).join('; ')}`);
      out.push(`   flag_reasons: ${(s.flag_reasons||[]).map((r) => `${r.id}(${r.p},${r.source},${r.rule})`).join(' ')}`);
      out.push(`   context_reasons: ${JSON.stringify(s.context_reasons)}`);
      out.push(`   cancelled: ${JSON.stringify(s.cancelled)} kind_gate: ${JSON.stringify(s.kind_gate)} mentioned_only: ${JSON.stringify(s.mentioned_only).slice(0,300)}`);
      out.push(`   modifiers: ${JSON.stringify(s.modifiers)} kind: ${JSON.stringify(s.kind)} film_items_asked ${s.film_items_asked}`);
      out.push(`   tags: ${(s.tags||[]).filter((t) => t.p >= 0.4).map((t) => `${t.id}:${t.p}${t.level==='act'?'':'?'}${t.source?'/'+t.source[0]:''}`).join(' ')}`);
      const m = moments[s.id];
      if (m) {
        out.push(`   MOMENT method=${m.method} why=${m.why||''} dpm=${m.dialogue_per_min} skip ${Math.round(m.skip_ms/1000)}s of ${Math.round(m.scene_ms/1000)}s spans ${m.spans.map((x) => formatTime(x.start_ms)+'-'+formatTime(x.end_ms)).join(',')}`);
        for (const r of m.per_reason||[]) out.push(`     - ${r.clause} exists ${r.exists} ${r.begin?`${r.begin.line}(${r.begin.p})..${r.end.line}(${r.end.p})`:r.fallback}`);
        skipSpans.push(...m.spans);
      } else if (s.skip) { skipSpans.push(...(s.skip.spans||[])); out.push(`   skip: ${JSON.stringify(s.skip).slice(0,300)}`); }
    }
    const cr = it.cue_range || {};
    const a = Math.max(1, (cr.start_cue||1)), b = Math.min(cues.length, cr.end_cue||a);
    out.push(`--- LINES ${a}-${b} (* = inside a skip span; B = inside baseline scene)`);
    for (let i = a; i <= b; i++) {
      const c = cues[i-1];
      const inSkip = skipSpans.some((x) => c.startMs < x.end_ms && c.endMs > x.start_ms);
      const inB = it.baseline && i >= it.baseline.start_cue && i <= it.baseline.end_cue;
      out.push(`${inSkip?'*':' '}${inB?'B':' '} L${i} ${formatTime(c.startMs)} ${c.text}`);
    }
  });
  fs.writeFileSync(path.join(here, 'out', `review-${film}.txt`), out.join('\n'));
  console.log(film, items.length, out.length);
}
