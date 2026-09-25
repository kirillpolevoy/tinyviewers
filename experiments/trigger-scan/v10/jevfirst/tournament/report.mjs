#!/usr/bin/env node
// Writes ../TOURNAMENT.md and CANDIDATES.md from results.json (score.mjs). Pure code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(HERE, '../../..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const R = rj(path.join(HERE, 'results.json'));
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const pr = (r) => (r ? (r.fires ? `${r.hits}/${r.fires} = ${pct(r.precision)}` : '0 fires') : '-');
const rc = (r) => (r ? (r.items ? `${r.caught}/${r.items} = ${pct(r.recall)}` : '-') : '-');
const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const SRC = { C: 'Claude', A: 'Astra', V: 'v9 wording' };
const byId = new Map(R.all_candidates.map((c) => [c.id, c]));
const words = (id) => byId.get(id)?.desc ?? id;

const S = R.share;
const md = [];
md.push('# Phrasing tournament: Jev-first rewrites vs v9 wording vs Sonnet\n');
md.push(`Generated ${R.generated_at} by \`v10/jevfirst/tournament/score.mjs\` + \`report.mjs\`. Full numbers: \`tournament/results.json\`; every candidate per concept: \`tournament/CANDIDATES.md\`.\n`);
md.push('## What ran\n');
md.push(`- Jev (jev-1.13.0) answered **every pooled phrasing on every scene of the 13 seen films** (${R.films.join(', ')}): ${R.requests} requests, ${R.input_tokens.toLocaleString()} billed input tokens, **$${R.spend_usd.toFixed(4)}** of the $2.00 cap (ledger: \`tournament/ledger.jsonl\`; every request reserved its worst case first; 0 errors, 0 over-reservations after the pilot fix).`);
md.push(`- Pool: ${R.pooled_questions} questions per scene before film instantiation: Claude's 166 scorable phrasings (all 173 minus mention / retold / imagined / film-presence), Astra's bundles split into their numbered sub-Nouls with every \`{source}\` sub asked on lines AND summary (287 questions), and the v9 wording as a control (25 questions for the 19 ids v9 gave to Sonnet; the other v9 ids reuse v9's own Jev answers: same wording, states and scenes). No identical wording occurred across sources, so dedupe removed nothing.`);
md.push('- Segmentation, verified summaries, cast and dangers: v9/out/<slug>.segments.json (unchanged). Sonnet: its stored v9 answers (v9/out/<slug>.sonnetq.r1.json), which exist only for the 43 split.json sonnet_asked ids.');
md.push(`- ${R.candidates} candidates scored (singles, Astra subs max over channels, Claude combine bundles, Astra combine bundles, OR-of-all, Claude's own prune-then-OR rule, v9 control) x thresholds 0.6 / 0.7 / 0.8.\n`);
md.push('## Headline\n');
const ids = (x) => `${x.jev}/${x.total} (${pct(x.jev / x.total)})`;
md.push(table(['', 'v9 (split.json)', 'after this tournament (owner rule as briefed)'], [
  ['Jev share, v9 ids + 3 film templates', ids(S.before_ids), ids(S.after_ids)],
  ['Jev share, 88 scored concepts', `${S.concepts_before.jev} Jev, ${S.concepts_before.mixed} mixed, ${S.concepts_before.sonnet} Sonnet`, `${S.concepts_after.jev} Jev, ${S.concepts_after.sonnet} Sonnet`],
]));
const reasons = {};
for (const r of R.rows) (reasons[r.reason] ??= []).push(r.concept);
md.push('\nWhy the 62 non-Jev concepts went to Sonnet. Most of them did not lose to Sonnet: they missed the absolute bar (precision >= 0.70 on >= 4 fires, and >= 0.60 on the magic films).\n');
md.push(table(['reason', 'concepts', 'which'], Object.entries(reasons).map(([k, v]) => [k, v.length, v.join(', ')])));
const nR = (k) => (reasons[k] ?? []).length;
md.push(`\nRead against Sonnet only (drop the absolute bar, keep the 5-point comparison): Sonnet is measurably better (>= 4 fires, beyond tolerance) on **${nR('Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance')}** concepts. Jev passes or ties Sonnet on ${nR('rule passed') + nR('Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar')}. The remaining ${nR('Sonnet never asked; Jev below the absolute bar') + nR('thin evidence: Sonnet < 4 fires; Jev below the absolute bar')} have no usable Sonnet measurement (never asked, or < 4 fires). The owner column below applies the rule as briefed. This paragraph is only a reading of it.`);
const winSrc = {};
for (const r of R.rows.filter((x) => x.owner === 'jev')) winSrc[SRC[r.best.src]] = (winSrc[SRC[r.best.src]] ?? 0) + 1;
md.push(`\nWhere the winning Jev phrasing came from (26 Jev-owned concepts): ${Object.entries(winSrc).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
const sonBar = R.rows.filter((r) => r.sonnet_meets_absolute_bar);
md.push(`Sonnet itself meets the same absolute bar on only ${sonBar.length} of the ${R.rows.filter((r) => r.sonnet).length} concepts it was ever asked (${sonBar.map((r) => r.concept).join(', ')}).\n`);

md.push('## Per-concept table\n');
md.push('Best = the Jev candidate the owner rule selects (highest recall among passing candidates); when none passes, the candidate with the highest Wilson lower bound on >= 4 fires. Precision = hits / fires, a lower bound (keys list notable moments only). Recall = key items of the concept group caught / key items in the group (all 13 films). Magic = coco + book-of-life + princess-and-the-frog. lift = precision / chance precision (circular shift); kappa = chance-corrected recall. Sonnet at 0.7 (its flag threshold).\n');
md.push(table(['concept', 'group', 'v9 -> now', 'best Jev (source @ t)', 'wording', 'Jev precision', 'Jev recall', 'magic precision', 'lift / kappa', 'Sonnet precision', 'Sonnet recall', 'why'],
  R.rows.map((r) => [r.concept, r.group, `${r.v9_owner} -> **${r.owner}**`, `${SRC[r.best.src]} ${r.best.kind} @${r.best.t}`, cut(r.best.desc, 200), pr(r.best.all), rc(r.best.all), pr(r.best.magic), `${r.best.lift?.toFixed(1) ?? '-'} / ${r.best.kappa?.toFixed(2) ?? '-'}`,
    r.sonnet ? pr(r.sonnet.at) + (r.sonnet.partial ? ' (partial ids)' : '') : 'never asked', r.sonnet ? rc(r.sonnet.at) : '-', r.owner === 'jev' ? 'passes' : `${r.reason}: ${r.best.fails.join('; ')}`])));

// did the new wording beat v9?
md.push('\n## Did the rewrites beat the v9 wording?\n');
let newBetter = 0, v9Better = 0, same = 0;
const cmpRows = [];
for (const r of R.rows) {
  const v = r.by_source.V, c = r.by_source.C, a = r.by_source.A;
  const score = (x) => (x ? [x.passes ? 1 : 0, x.all.fires >= 4 ? (x.all.precision ?? 0) : -1, x.all.recall ?? 0] : [-1, -1, -1]);
  const bestNew = [c, a].filter(Boolean).sort((x, y) => { const X = score(x), Y = score(y); return Y[0] - X[0] || Y[1] - X[1] || Y[2] - X[2]; })[0];
  const X = score(bestNew), Y = score(v);
  const d = X[0] - Y[0] || Math.sign(Math.round((X[1] - Y[1]) * 100)) || Math.sign(Math.round((X[2] - Y[2]) * 100));
  if (d > 0) newBetter += 1; else if (d < 0) v9Better += 1; else same += 1;
  cmpRows.push([r.concept, v ? `${pr(v.all)}, R ${pct(v.all.recall)} @${v.t}${v.passes ? ' pass' : ''}` : '-', c ? `${pr(c.all)}, R ${pct(c.all.recall)} @${c.t}${c.passes ? ' pass' : ''}` : '-', a ? `${pr(a.all)}, R ${pct(a.all.recall)} @${a.t}${a.passes ? ' pass' : ''}` : '-', d > 0 ? 'rewrite' : d < 0 ? 'v9' : 'tie']);
}
md.push(`Comparing each source's best candidate per concept (pass the rule first, then precision on >= 4 fires, then recall): a rewrite (Claude or Astra) is better on **${newBetter}** concepts, the v9 wording on **${v9Better}**, tie on ${same}. Many v9 wins come from the threshold: the old question at 0.8 instead of 0.7.\n`);
md.push(table(['concept', 'v9 wording best', 'Claude best', 'Astra best', 'better'], cmpRows));

// magic-film fuzzy items
md.push('\n## The four fuzzy questions on the magic/afterlife films\n');
md.push('Round 5 found these misfiring on magic or afterlife settings. Below, every candidate of the concept at each threshold: magic-film fires, and overall precision / recall.\n');
for (const cName of ['dark_magic', 'ghost_spirit', 'believed_dead', 'afraid_for_safety']) {
  const cands = R.all_candidates.filter((c) => c.concept === cName && ['v9', 'bundle', 'single', 'or_all'].includes(c.kind));
  const rowsM = [];
  for (const c of cands) for (const t of [0.7, 0.8]) { const x = c.res[t]; if (!x.all.fires) continue; rowsM.push([c.id, t, pr(x.magic), pr(x.all), pct(x.all.recall)]); }
  rowsM.sort((a, b) => a[0].localeCompare(b[0]));
  md.push(`### ${cName}\n`);
  md.push(table(['candidate', 't', 'magic films', 'all films', 'recall'], rowsM));
  md.push('');
}

// lost moments
md.push('## The 8 moments the round-5 narrow cut lost\n');
const MOM = [['book-of-life', 'S024', 'R10'], ['book-of-life', 'S040', 'R17'], ['book-of-life', 'S035', 'R37'], ['princess-and-the-frog', 'S027', 'R29'], ['princess-and-the-frog', 'S040', 'R42'], ['princess-and-the-frog', 'S011', 'R72'], ['moana', 'S016', 'R35'], ['moana', 'S024', 'R40']];
const pool = rj(path.join(HERE, 'pool.json'));
const cGroup = Object.fromEntries(pool.concepts.map((c) => [c.key, c.group]));
const momRows = [];
for (const [f, sid, rid] of MOM) {
  const key = rj(path.join(TS, 'refs', `${f}.key.json`)).items.find((i) => i.id === rid);
  const a = rj(path.join(HERE, 'out', `${f}.answers.json`)).scenes.find((s) => s.id === sid).answers;
  const hits = Object.entries(a).filter(([k, p]) => p >= 0.7 && /^[CA]:/.test(k) && !k.includes('#')).map(([k, p]) => {
    const x = pool.pool.find((y) => `${y.src}:${y.sub}@${y.state}` === k);
    return x && (key.categories ?? []).includes(cGroup[x.concept]) ? `${k.replace(/@.*/, '')} ${p.toFixed(2)}` : null;
  }).filter(Boolean).sort((x, y) => Number(y.split(' ')[1]) - Number(x.split(' ')[1]));
  // the new split: Jev-owned winners at their threshold, Sonnet at 0.7 for Sonnet-owned
  momRows.push([`${f} ${sid} ${rid}`, cut(key.text, 110), (key.categories ?? []).join(', '), hits.slice(0, 6).join(', ') || 'none >= 0.7']);
}
md.push(table(['moment', 'key text', 'key groups', 'rewrites firing >= 0.7 in that scene, in a key group'], momRows));
md.push('\nR29 (princess-and-the-frog S027) has no verified summary sentence, so every summary-channel phrasing is unasked there. From the lines, only the startle / sudden-appearance phrasings reach 0.7 (eerie). The peril, captivity, creature and ghost phrasings all stay below 0.6 (e.g. ghost_spirit.b 0.10, creature_threat.a 0.37, captured.a 0.18, afraid_for_safety.c 0.56). R37 (book-of-life S035) gets no fire in its key groups (peril, objects_hazards): afraid_for_safety.a 0.93 and transforms.b 0.90 fire there, but under other groups.\n');

md.push('## Caveats\n');
md.push('- **Selection on seen films.** All 13 films were used to write or tune earlier rounds, and the best of dozens of candidates x 3 thresholds is picked on the same data. The winners\' numbers are optimistic. This round picks candidates to freeze; it is not a held-out test.');
md.push('- **Precision is a lower bound.** A correct fire on a moment the parent guides did not list counts as wrong. This hits presence questions hardest (keys list events, not every scene a monster is on screen). The absolute 0.70 bar therefore sends most presence concepts to "Sonnet" even though Sonnet was never asked them.');
md.push('- **Group-level hits.** As in the v8 scorecard, a fire counts as a hit when it overlaps any key item in the concept\'s group (a fire question is right on a knife item). Narrow concepts get loose credit on precision and tiny recall denominators; Sonnet is scored the same way.');
md.push('- **Raw answers, no gates.** No retold / imagined / comic gate and no kind veto is applied to either model. Claude\'s bundle rules are applied inside the concept (e.g. dies uses dead_body and seriously_ill; afraid_for_safety.c uses v9\'s danger Score).');
md.push('- **Astra instantiation.** Astra\'s entity slots ({C}, {A}, {D} ...) meant code to bind them to characters. With no per-character enumeration they were written as generic referents ("a character", "a child" plus the verified children list where Astra gated on verified_child). Three relational sub-Nouls were reworded to be answerable per scene, and parent_death_learned (3) was folded into the words "their parent". See ASTRA_SUBST / ASTRA_TEXT in pool.mjs.');
md.push('- **Film templates.** Film presence was not re-asked. Claude\'s film_threatens bundle uses v9\'s fpl/fps presence answers. Claude\'s [N] name states were realised as the name (plus verified aliases) in the question text, as v9 did.');
md.push('- **Sonnet** is compared at 0.7 only (0.8 is identical for its probability map). It was asked 43 ids; a concept whose ids were only partly asked is marked "partial ids". Sonnet saw the v9 context state; Jev saw the minimal states.');
md.push('- **Lyric removal** found almost nothing to remove: these subtitle files rarely mark songs (no music sign in most SRTs).');
md.push('');
fs.writeFileSync(path.resolve(HERE, '..', 'TOURNAMENT.md'), md.join('\n') + '\n');

// ---- CANDIDATES.md: every concept, top candidates
const cm = ['# Tournament candidates per concept (top 8 by: passes the owner rule, then Wilson lower bound)\n', 'Columns: candidate id, threshold, all-film precision, recall, magic-film precision, failing clauses. Full wording of every pooled question: pool.json; every candidate at every threshold: results.json all_candidates.\n'];
for (const r of R.rows) {
  cm.push(`## ${r.concept} (${r.group}) -> ${r.owner}\n`);
  cm.push(`Best: ${r.best.id} @${r.best.t}: ${esc(r.best.desc)}\n`);
  if (r.sonnet) cm.push(`Sonnet (${r.sonnet.ids.join(', ')}) @0.7: ${pr(r.sonnet.at)}, recall ${rc(r.sonnet.at)}, magic ${pr(r.sonnet.magic)}; @0.6: ${pr(r.sonnet.at06)}\n`);
  cm.push(table(['candidate', 't', 'precision', 'recall', 'magic', 'fails', 'wording'], r.top.map((o) => [o.id, o.t, pr(o.all), rc(o.all), pr(o.magic), o.fails.join('; ') || 'passes', cut(words(o.id), 160)])));
  cm.push('');
}
fs.writeFileSync(path.join(HERE, 'CANDIDATES.md'), cm.join('\n') + '\n');
console.log('wrote TOURNAMENT.md, CANDIDATES.md');
