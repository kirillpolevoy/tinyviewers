#!/usr/bin/env node
// Integrity checks, read-only. Writes verify/out/leakage.json.
//  1. Rebuild every Jev request state + question set from out/<slug>.segments.json with the frozen code
//     and check it reproduces the recorded question hash, film items and per-request est_tokens
//     (so the reconstructed states are what was sent).
//  2. Lines request state = { film:{title}, scene:{lines} } only; lines == SRT cue text of the scene.
//  3. Reference-key text / live-DB titles in Sonnet output, Jev state or the question set: 5-gram
//     overlap after removing n-grams that also occur in the SRT or the verified sources.
//  4. Film entity names (all 5 films' cast + dangers) in the universal question text / policy.
//  5. Citation validity: every cite id exists; sentence line cites lie inside the scene; verified
//     cast/danger/alias fields have cites; also_called only from verified alias claims.
//  6. Stored model text: longest run of consecutive transcript words (limit 8).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V6 = path.resolve(HERE, '..');
const TS = path.resolve(V6, '..');
const OUT = path.join(V6, 'out');
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'];
const Q = await import(path.join(V6, 'questions.js'));
const C = await import(path.join(V6, 'classify.js'));
const { parseSrt } = await import(path.join(TS, 'srt.js'));
const crypto = await import('node:crypto');
const L = await import(path.join(TS, '../../scene-api/load.js'));
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));

const words = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const grams = (s, n) => { const w = words(s); const o = new Set(); for (let i = 0; i + n <= w.length; i++) o.add(w.slice(i, i + n).join(' ')); return o; };
function longestRun(text, srtWordsJoined) {
  const w = words(text); let best = 0; let bestS = '';
  for (let i = 0; i < w.length; i++) for (let j = i + best + 1; j <= w.length; j++) { const s = ` ${w.slice(i, j).join(' ')} `; if (srtWordsJoined.includes(s)) { best = j - i; bestS = s; } else break; }
  return [best, bestS.trim()];
}

const universalQ = JSON.stringify(Q.buildQuestions()) + fs.readFileSync(path.join(V6, 'policy.json'), 'utf8');
const report = { films: {}, entity_names_in_universal: [] };
const allNames = new Set();

for (const slug of FILMS) {
  const r = {};
  const seg = J(path.join(OUT, `${slug}.segments.json`));
  const src = J(path.join(V6, 'sources', `${slug}.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const jev = J(path.join(OUT, `${slug}.jev.r1.json`));
  const key = J(path.join(TS, 'refs', `${slug}.key.json`));

  // 1. reconstruct
  const items = Q.filmItems(seg);
  const universal = Q.buildQuestions(); const generated = Q.filmQuestions(items);
  const qHash = crypto.createHash('sha256').update(JSON.stringify({ universal, generated })).digest('hex').slice(0, 12);
  r.question_hash_match = qHash === jev.question_set.sha256_12;
  r.film_items_match = JSON.stringify(items) === JSON.stringify(jev.film_items);
  let estMismatch = 0; let linesOnlyBad = 0; let linesTextBad = 0;
  const states = [];
  for (const scene of seg.scenes) {
    const sc = cues.slice(scene.start_cue - 1, scene.end_cue);
    const plan = C.planScene({ seg, scene, cues: sc, items });
    const rec = jev.scenes.find((s) => s.id === scene.id);
    for (const req of plan.reqs) {
      const got = rec?.requests?.find((x) => x.part === req.part);
      if (!got || got.est_tokens !== req.est) estMismatch++;
      states.push(req.body);
    }
    const ls = plan.reqs[0].body.state;
    const keys = JSON.stringify(Object.keys(ls)) + JSON.stringify(Object.keys(ls.film)) + JSON.stringify(Object.keys(ls.scene));
    if (keys !== '["film","scene"]["title"]["lines"]') linesOnlyBad++;
    if (ls.scene.lines.some((l, i) => l !== `L${sc[i].index}| ${sc[i].text}`)) linesTextBad++;
  }
  r.est_token_mismatches = estMismatch; r.lines_state_extra_fields = linesOnlyBad; r.lines_text_mismatch = linesTextBad;

  // 3. leakage n-grams
  const allowedText = [cues.map((c) => c.text).join(' \n '), src.wikipedia.sentences.map((s) => s.text).join(' \n '), JSON.stringify(src.tmdb.cast)];
  const allowed = new Set(allowedText.flatMap((t) => [...grams(t, 5), ...grams(t, 4)]));
  const modelText = [
    ...seg.scenes.flatMap((s) => [s.setting, ...(s.sentences ?? []).map((x) => x.text)]),
    ...seg.cast.flatMap((c) => [c.name, c.disposition_note, ...(c.aliases ?? []).map((a) => (typeof a === 'string' ? a : a.name))]),
    ...seg.dangers.flatMap((d) => [d.name, d.note]),
  ].filter(Boolean).join(' \n ');
  const stateText = states.map((b) => JSON.stringify({ ...b.state, scene: { ...b.state.scene, lines: undefined } }) + JSON.stringify(b.questions)).join('\n');
  const refTexts = [...key.items.flatMap((i) => [i.text, i.flag_reason, i.map_note]), ...key.film_level.filter((x) => x.source !== 'doesthedogdie').map((x) => x.text)].filter(Boolean);
  const refG = new Set(); for (const t of refTexts) for (const g of grams(t, 5)) if (!allowed.has(g)) refG.add(g);
  const mg = grams(modelText, 5); const sg = grams(stateText, 5);
  r.ref_5grams_in_sonnet_output = [...refG].filter((g) => mg.has(g));
  r.ref_5grams_in_jev_state = [...refG].filter((g) => sg.has(g));
  // DTDD questions are generic ('does the dog die') — check 6-gram against universal question text only
  // live DB content
  let db = [];
  try {
    const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
    db = built.scenes.map((s) => [s.title, s.description, s.summary].filter(Boolean).join(' '));
  } catch (e) { r.live_db_error = e.message; }
  const dbG = new Set(); for (const t of db) for (const g of grams(t, 4)) if (!allowed.has(g)) dbG.add(g);
  const mg4 = grams(modelText, 4); const sg4 = grams(stateText, 4);
  r.live_db_titles = db.length;
  r.live_db_4grams_in_sonnet_output = [...dbG].filter((g) => mg4.has(g));
  r.live_db_4grams_in_jev_state = [...dbG].filter((g) => sg4.has(g));
  const qg = grams(universalQ, 5);
  r.ref_5grams_in_universal_questions = [...refG].filter((g) => qg.has(g));

  // 4. names
  for (const c of seg.cast) { allNames.add(c.name); for (const a of c.aliases ?? []) allNames.add(typeof a === 'string' ? a : a.name); }
  for (const t of src.tmdb.cast) for (const n of String(t.character).split('/')) allNames.add(n.trim());

  // 5. citations
  const lineIds = new Set(cues.map((c) => `L${c.index}`));
  const wIds = new Set(src.wikipedia.sentences.map((s) => s.id));
  const tIds = new Set(src.tmdb.cast.map((t) => t.id));
  const known = (id) => lineIds.has(id) || wIds.has(id) || tIds.has(id);
  const bad = []; let verifiedNoCite = 0; let lineOutside = 0; let verifiedSent = 0; let verifiedSentLinesOnlyOutside = 0;
  for (const s of seg.scenes) {
    for (const x of s.sentences ?? []) {
      for (const c of x.cites ?? []) { if (!known(c)) bad.push(`${s.id}:${c}`); if (/^L\d+$/.test(c)) { const n = +c.slice(1); if (n < s.start_cue || n > s.end_cue) lineOutside++; } }
      if (x.check?.status === 'verified') { verifiedSent++; if (!(x.cites ?? []).length) verifiedNoCite++; }
    }
  }
  const aliasRows = [];
  for (const c of seg.cast) {
    for (const [f, ids] of Object.entries(c.cites ?? {})) for (const id of ids) if (!known(id)) bad.push(`${c.id}.${f}:${id}`);
    for (const f of ['kind', 'is_child', 'disposition', 'looks_frightening']) if (c.check?.[f]?.status === 'verified' && !(c.cites?.[f] ?? []).length) verifiedNoCite++;
    const shown = Q.castView(c).also_called ?? [];
    for (const a of c.aliases ?? []) {
      const name = typeof a === 'string' ? a : a.name;
      const st = typeof a === 'object' ? (a.check?.status ?? a.status ?? null) : null;
      aliasRows.push({ cast: c.name, alias: name, status: st, shown: shown.includes(name), cites: typeof a === 'object' ? a.cites ?? [] : [] });
      if (typeof a === 'object') for (const id of a.cites ?? []) if (!known(id)) bad.push(`${c.id}.alias:${id}`);
    }
    for (const s of shown) if (!aliasRows.some((x) => x.cast === c.name && x.alias === s && x.status === 'verified')) aliasRows.push({ cast: c.name, alias: s, status: 'SHOWN_BUT_NOT_VERIFIED' });
    if (!Q.nameVerified(c) && Q.filmItems({ ...seg, dangers: [], cast: [c] }).length) bad.push(`${c.id}: unverified name got film items`);
    if (!c.check || !('name' in c.check)) bad.push(`${c.id}: no name check (nameVerified passes by default)`);
  }
  for (const d of seg.dangers) for (const id of d.cites ?? []) if (!known(id)) bad.push(`${d.id}:${id}`);
  r.citations = { unknown_ids: bad, sentence_line_cites_outside_scene: lineOutside, verified_without_cites: verifiedNoCite, verified_sentences: verifiedSent };
  r.aliases = aliasRows;
  // 6. quoting
  const srtJoined = ` ${words(cues.map((c) => c.text).join(' ')).join(' ')} `;
  let worst = [0, '']; const over = [];
  for (const s of seg.scenes) for (const x of s.sentences ?? []) { const lr = longestRun(x.text, srtJoined); if (lr[0] > worst[0]) worst = lr; if (lr[0] > 8) over.push(`${s.id} ${lr[0]}`); }
  for (const c of seg.cast) { const lr = longestRun(c.disposition_note ?? '', srtJoined); if (lr[0] > worst[0]) worst = lr; if (lr[0] > 8) over.push(`${c.id} note ${lr[0]}`); }
  r.quote = { longest_run_words: worst[0], over_8: over };
  report.films[slug] = r;
}
// 4. names in universal questions
const uq = JSON.stringify(Q.buildQuestions()) + fs.readFileSync(path.join(V6, 'policy.json'), 'utf8');
for (const n of allNames) {
  if (!n || n.length < 3) continue;
  const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (re.test(uq) && /^[A-Z]/.test(n)) report.entity_names_in_universal.push(n);
}
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'out', 'leakage.json'), JSON.stringify(report, null, 2));
for (const [s, r] of Object.entries(report.films)) {
  console.log(`== ${s}: qhash ${r.question_hash_match} items ${r.film_items_match} estMismatch ${r.est_token_mismatches} linesExtra ${r.lines_state_extra_fields} linesText ${r.lines_text_mismatch}`);
  console.log(`   ref5g sonnet ${r.ref_5grams_in_sonnet_output.length} ${JSON.stringify(r.ref_5grams_in_sonnet_output.slice(0, 8))} jev ${r.ref_5grams_in_jev_state.length} ${JSON.stringify(r.ref_5grams_in_jev_state.slice(0, 8))} univQ ${r.ref_5grams_in_universal_questions.length}`);
  console.log(`   liveDB(${r.live_db_titles}) 4g sonnet ${JSON.stringify(r.live_db_4grams_in_sonnet_output)} jev ${JSON.stringify(r.live_db_4grams_in_jev_state.slice(0, 10))} ${r.live_db_error ?? ''}`);
  console.log(`   cites ${JSON.stringify(r.citations)}`);
  console.log(`   aliases ${JSON.stringify(r.aliases)}`);
  console.log(`   quote ${JSON.stringify(r.quote)}`);
}
console.log('entity names in universal questions/policy:', report.entity_names_in_universal);
