#!/usr/bin/env node
// v10.3 SEEN-FILM SUMMARY (19 films, IN-SAMPLE and labelled; no model calls). Reads:
//   eval/out/variants.json   flags / spans: recall, precision, skip, wordless, rules 1/2/3 (v102, v102r, v103 = ABC, live)
//   out103/seen              v10.3's flags (tags) and parent text: why (attempt 1), why2 (attempt 2), whyfinal (merged)
//   v10_2 out102(/seen)      v10.2's flags and text
//   eval/out/judge-seen.json the blind Codex judge (same prompt as round 8), when present
// TEXT: per system, flagged scenes with no text, with the 'Flagged scene' placeholder title (title not Sonnet-verified),
// severity-3 scenes among them; FALSE TEXT = shown text that is not Jev-verified or cites nothing (audit of every
// shown sentence / title against its check record) + code-built statements (none exist: code_built_reasons false).
// Also: the round-8 blockers -- Incredibles S005 / S006, Big Hero 6 R15 / R48, Brave R12 / R13 / R76 / R95.
//   node eval/seen.mjs -> eval/out/seen.json + a table
import fs from 'node:fs';
import path from 'node:path';
import { FILMS, R8, loadFilm, v102Dir, rj, V103, union, shareInside } from './seen-lib.mjs';

const SEEN = path.join(V103, 'out103', 'seen');
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
function textOf(tags, whyScenes, checkedFor) {
  const fl = tags.scenes.filter((s) => s.flagged);
  const rows = fl.map((s) => {
    const w = whyScenes[s.id]; const why = w && w.reasons.join() === s.flag_reasons.map((r) => r.id).join() ? w.why : null;
    // audit: every shown sentence / title is a verified check record with cites
    const recs = checkedFor(s.id);
    const shownKeys = [...(why?.sentences ?? [])];
    const bad = [];
    for (const k of shownKeys) { const rec = recs.find((c) => c.key === k); if (!rec || rec.final !== 'verified' || !(rec.cites ?? []).length) bad.push(k); }
    if (why?.title_source === 'sonnet_verified') { const t = recs.find((c) => c.key.endsWith('.title') && c.text === why.title); if (!t || t.final !== 'verified' || !(t.cites ?? []).length) bad.push('title'); }
    if (why?.title_source === 'plain' || /Flagged because/.test(why?.text ?? '')) bad.push('code_built');
    return { id: s.id, sev: s.severity?.['5-7']?.level ?? null, text: !!why?.text, title: why?.title_source === 'sonnet_verified', bad, text_attempt: why?.text_attempt ?? (why?.text ? 1 : null), title_attempt: why?.title_attempt ?? (why?.title_source === 'sonnet_verified' ? 1 : null) };
  });
  return rows;
}
const tally = (rows) => { const n = rows.length; const byT = (k) => rows.filter((r) => r.title_attempt === k).length; const nt = rows.filter((r) => !r.text); const ph = rows.filter((r) => !r.title); return { flagged: n, no_text: nt.length, no_text_share: n ? r3(nt.length / n) : null, placeholder: ph.length, placeholder_share: n ? r3(ph.length / n) : null, sev3: rows.filter((r) => r.sev === 3).length, sev3_no_text: nt.filter((r) => r.sev === 3).length, sev3_placeholder: ph.filter((r) => r.sev === 3).length, false_text: rows.reduce((a, r) => a + r.bad.length, 0), text_from_attempt2: rows.filter((r) => r.text_attempt === 2).length, title_from_attempt2: byT(2), title_from_attempt3: byT(3) }; };
const per = []; const all = { v103: [], v103_attempt1: [], v102: [] };
for (const slug of FILMS) {
  const t3 = rj(path.join(SEEN, `${slug}.tags.r1.json`));
  const w1 = rj(path.join(SEEN, `${slug}.why.r1.json`)); const w2f = path.join(SEEN, `${slug}.why2.r1.json`); const w2 = fs.existsSync(w2f) ? rj(w2f) : { scenes: {} };
  const wf = rj(path.join(SEEN, `${slug}.whyfinal.r1.json`));
  const w3f = path.join(SEEN, `${slug}.why3.r1.json`); const w3 = fs.existsSync(w3f) ? rj(w3f) : { scenes: {} };
  // every check record a shown text could come from: attempt 1, attempt 2 (sentence keys prefixed a2:), titles of 2 and 3
  const rec3 = (id) => [...(w1.scenes[id]?.checked ?? []), ...(w2.scenes[id]?.checked ?? []).map((c) => ({ ...c, key: `a2:${c.key}` })), ...(w2.scenes[id]?.checked ?? []).filter((c) => c.key.endsWith('.title')), ...(w3.scenes[id]?.checked ?? []).filter((c) => c.key.endsWith('.title'))];
  const v103 = textOf(t3, wf.scenes, rec3);
  const v103a1 = textOf(t3, w1.scenes, (id) => w1.scenes[id]?.checked ?? []);
  const t2 = rj(path.join(v102Dir(slug), `${slug}.tags.r1.json`)); const wv2 = rj(path.join(v102Dir(slug), `${slug}.why.r1.json`));
  const v102 = textOf(t2, wv2.scenes, (id) => wv2.scenes[id]?.checked ?? []);
  all.v103.push(...v103); all.v103_attempt1.push(...v103a1); all.v102.push(...v102);
  per.push({ slug, v103: tally(v103), v103_attempt1: tally(v103a1), v102: tally(v102), false_text_ids: v103.filter((r) => r.bad.length).map((r) => `${r.id}:${r.bad.join('+')}`) });
}
const text = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, tally(v)]));
// round-8 subset tallies from the per-film rows
const sumT = (list, k) => { const t = list.map((p) => p[k]); const s = (f) => t.reduce((a, x) => a + x[f], 0); const n = s('flagged'); return { flagged: n, no_text: s('no_text'), no_text_share: r3(s('no_text') / n), placeholder: s('placeholder'), placeholder_share: r3(s('placeholder') / n), sev3_no_text: s('sev3_no_text'), sev3_placeholder: s('sev3_placeholder'), false_text: s('false_text') }; };
const r8 = { v103: sumT(per.filter((p) => R8.includes(p.slug)), 'v103'), v102: sumT(per.filter((p) => R8.includes(p.slug)), 'v102') };
// round-8 blockers
const blockers = {};
{
  const chk = (slug, ids) => {
    const F = loadFilm(slug); const t3 = rj(path.join(SEEN, `${slug}.tags.r1.json`));
    const U = union(t3.scenes.filter((s) => s.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
    return Object.fromEntries(ids.map((id) => { const it = F.key.items.find((x) => x.id === id); return [id, { covered: r3(shareInside(it.start_ms, it.end_ms, U)), found: shareInside(it.start_ms, it.end_ms, U) >= 0.5 }]; }));
  };
  const t = rj(path.join(SEEN, 'incredibles.tags.r1.json'));
  const sc = (id) => { const s = t.scenes.find((x) => x.id === id); return { flagged: s.flagged, reasons: s.flag_reasons.map((r) => `${r.id}${r.rule === 'mortal_question' ? '(mortal)' : ''}${r.cooccur ? '(cooccur)' : ''}`), skip: (s.skip?.spans ?? []).map((x) => `${(x.start_ms / 1000).toFixed(0)}-${(x.end_ms / 1000).toFixed(0)}s`), tags: s.tags.filter((x) => x.level === 'act').map((x) => x.id) }; };
  blockers.incredibles = { S005: sc('S005'), S006: sc('S006'), items: chk('incredibles', ['R21', 'R116', 'R133', 'R139', 'R26', 'R27', 'R28']) };
  blockers['big-hero-6'] = chk('big-hero-6', ['R15', 'R48']);
  blockers.brave = chk('brave', ['R12', 'R13', 'R76', 'R95']);
}
const vf = path.join(V103, 'eval', 'out', 'variants.json'); const variants = fs.existsSync(vf) ? rj(vf) : null;
const jf = path.join(V103, 'eval', 'out', 'judge-seen.json'); const judge = fs.existsSync(jf) ? rj(jf).summary : null;
const out = { generated_at: new Date().toISOString(), label: 'DEV-ONLY, IN-SAMPLE (19 seen films; v10.3 was designed on them). Not a test.', text, text_round8: r8, per_film: per, blockers, flags: variants ? variants.pooled.map((p) => ({ label: p.label, v102: p.rows.v102, v102r: p.rows.v102r, v103: p.rows.ABC, live: p.rows.live, v103_vs_live: p.verdicts.ABC.vs_live, v103_vs_v102r: p.verdicts.ABC.vs_v102r, v102_vs_live: p.verdicts.v102.vs_live })) : null, judge };
fs.writeFileSync(path.join(V103, 'eval', 'out', 'seen.json'), JSON.stringify(out, null, 2));
console.log(out.label);
for (const [k, v] of Object.entries(text)) console.log(`text ${k.padEnd(14)} ${JSON.stringify(v)}`);
console.log(`round-8 films text: ${JSON.stringify(r8)}`);
for (const p of per) console.log(`  ${p.slug.padEnd(24)} v103 no-text ${p.v103.no_text}/${p.v103.flagged} placeholder ${p.v103.placeholder} | attempt1 ${p.v103_attempt1.no_text}/${p.v103_attempt1.placeholder} | v102 ${p.v102.no_text}/${p.v102.placeholder} of ${p.v102.flagged}${p.false_text_ids.length ? ` FALSE ${p.false_text_ids.join(' ')}` : ''}`);
console.log(`blockers ${JSON.stringify(blockers, null, 1)}`);
if (out.flags) for (const f of out.flags) console.log(`flags ${f.label}: v103 ${JSON.stringify(f.v103)} | live ${JSON.stringify(f.live)} | v103 vs live ${JSON.stringify(f.v103_vs_live)}`);
if (judge) for (const [g, o] of Object.entries(judge)) console.log(`judge ${g}: v103 text ${JSON.stringify(o.v103_text)} title ${JSON.stringify(o.v103_title)} | v102 text ${JSON.stringify(o.v102_text)} title ${JSON.stringify(o.v102_title)} | live text ${JSON.stringify(o.live_text)} title ${JSON.stringify(o.live_title)} | attempt-2 text ${JSON.stringify(o.v103_text_attempt2)} title ${JSON.stringify(o.v103_title_attempt2)}`);
