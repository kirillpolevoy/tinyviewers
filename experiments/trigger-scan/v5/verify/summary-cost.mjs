import fs from 'node:fs';
const rj = (f) => JSON.parse(fs.readFileSync(new URL(f, import.meta.url)));
const review = rj('../review/review.json');
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const seg = rj(`../out/${slug}.segments.json`);
  const tags = rj(`../out/${slug}.tags.r1.json`);
  const jev = rj(`../out/${slug}.jev.r1.json`);
  const T = new Map(tags.scenes.map((s) => [s.id, s]));
  const J = new Map(jev.scenes.map((s) => [s.id, s]));
  const tab = { empty: [0, 0], has: [0, 0] };
  let emptyMin = 0, totMin = 0, thinMin = 0;
  for (const s of seg.scenes) {
    const empty = J.get(s.id).summary_empty;
    const m = (s.end_ms - s.start_ms) / 60000; totMin += m;
    if (empty) emptyMin += m;
    const vs = s.sentences.filter((x) => x.check?.status === 'verified').length;
    if (!empty && vs < s.sentences.length) thinMin += m;
    tab[empty ? 'empty' : 'has'][T.get(s.id).flagged ? 1 : 0]++;
  }
  console.log(`\n== ${slug}: scenes empty summary ${tab.empty[0] + tab.empty[1]} (flagged ${tab.empty[1]}) | with summary ${tab.has[0] + tab.has[1]} (flagged ${tab.has[1]}) | minutes empty ${emptyMin.toFixed(1)}/${totMin.toFixed(1)}, partial ${thinMin.toFixed(1)}`);
  const miss = review.items.filter((i) => i.film === slug && i.kind === 'b_baseline_scene_not_covered');
  for (const it of miss) {
    const b = it.baseline;
    const over = seg.scenes.filter((s) => s.end_cue >= b.start_cue && s.start_cue <= b.end_cue);
    console.log(`  MISS ${b.id} ${b.title} [${b.start_cue}-${b.end_cue}] ${it.why.replace(/baseline scene \S+ has /, '')}`);
    for (const s of over) {
      const t = T.get(s.id); const a = J.get(s.id).answers;
      const ev = (k) => a.e?.[k]?.toFixed?.(2) ?? a.e?.[k];
      const fe = Object.entries(a.fe ?? {}).filter(([, v]) => v >= 0.4).map(([k, v]) => `${k}=${v}`).join(',');
      const sc = a.s?.danger; const dang = typeof sc === 'object' ? JSON.stringify(sc.probabilities ?? sc) : sc;
      console.log(`     ${s.id} cues ${s.start_cue}-${s.end_cue} summary=${J.get(s.id).summary_empty ? 'EMPTY' : 'yes'}(${s.sentences.filter((x) => x.check?.status === 'verified').length}/${s.sentences.length}) flagged=${t.flagged} reasons=${(t.flag_reasons ?? []).map((r) => r.id ?? r).join('|')} afraid=${ev('afraid_for_safety')} child_danger=${ev('child_in_danger')} chased=${ev('chased')} threat=${ev('threatens_harm')} attacked=${ev('attacked')} creature=${ev('creature_threat')} retold=${a.mod?.retold} fe:{${fe}} danger=${dang}`);
      console.log(`        sents: ${s.sentences.map((x) => `[${x.check?.status}/${x.check?.confidence}] ${x.text}`).join(' || ').slice(0, 600)}`);
    }
  }
}
