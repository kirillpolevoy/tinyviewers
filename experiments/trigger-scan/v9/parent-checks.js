// v8 PARENT CHECKS (scoring only; never read by the pipeline). Pure code.
//
//   (i)   wordless-peak coverage: every mapped should_flag key item marked wordless that lies inside a
//         FLAGGED scene (>= 50% of its span inside the scene's bounds): is >= 80% of its span inside the
//         skip spans?
//   (ii)  wordless-scene detection: every mapped should_flag key item with >= 50% of its span inside a
//         WORDLESS scene (< 3 dialogue cues per minute over the scene's extended bounds; fill.js
//         wordlessScenes with the round-4 threshold): found (>= 50% inside the skip, refscore's rule)?
//   (iii) why: every flagged scene has parent text that states WHY. Per flagged scene, from reasons.js
//         (the same Jev question for before and after): 'stated' = a verified summary sentence Jev says
//         states a flag reason's event (p >= reasons.min_p); 'generated' = no such sentence, a plain
//         line from the reason label; 'unrelated_only' = the scene shows parents verified sentences but
//         none states the event and no generated line replaces them (v7 had no generated line);
//         'nothing' = no verified sentence and no line.
import { union, shareInside } from './refscore.js';

export const WORDLESS_SHARE = 0.8;

export function checkWordlessPeaks(key, flaggedScenes, skip) {
  const U = union(skip);
  const rows = [];
  for (const it of key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true && i.wordless)) {
    const sc = flaggedScenes.find((s) => shareInside(it.start_ms, it.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    if (!sc) continue;
    rows.push({ id: it.id, scene: sc.id, share: Math.round(shareInside(it.start_ms, it.end_ms, U) * 1000) / 1000 });
  }
  return { n: rows.length, covered: rows.filter((r) => r.share >= WORDLESS_SHARE).length, missed: rows.filter((r) => r.share < WORDLESS_SHARE).map((r) => `${r.id}@${r.scene}:${r.share}`) };
}

/** wordless = [{id, start_ms, end_ms}] (fill.js wordlessScenes on the film's segments). */
export function checkWordlessScenes(key, wordless, skip) {
  const U = union(skip);
  const rows = [];
  for (const it of key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true)) {
    const sc = wordless.find((s) => shareInside(it.start_ms, it.end_ms, [[s.start_ms, s.end_ms]]) >= 0.5);
    if (!sc) continue;
    rows.push({ id: it.id, scene: sc.id, share: Math.round(shareInside(it.start_ms, it.end_ms, U) * 1000) / 1000 });
  }
  return { n: rows.length, found: rows.filter((r) => r.share >= 0.5).length, missed: rows.filter((r) => r.share < 0.5).map((r) => `${r.id}@${r.scene}:${r.share}`) };
}

/**
 * reasonsRun = a reasons.js output ({scenes: {id: {sentences, why, matrix}}}); flagged = the run's
 * flagged scene ids; generatedCounts = false for a run whose product had no generated line (v7).
 */
export function checkWhy(reasonsRun, flagged, { generatedCounts = true } = {}) {
  const out = { flagged: flagged.length, stated: 0, generated: 0, unrelated_only: 0, nothing: 0, stated_ids: [], unrelated_only_ids: [], nothing_ids: [] };
  for (const id of flagged) {
    const r = reasonsRun?.scenes?.[id];
    if (r?.why?.source === 'verified_sentence') { out.stated++; out.stated_ids.push(id); continue; }
    if (generatedCounts && r?.why?.source === 'generated') { out.generated++; if (r.sentences) out.unrelated_replaced = (out.unrelated_replaced ?? 0) + 1; continue; }
    if (r?.sentences) { out.unrelated_only++; out.unrelated_only_ids.push(id); } else { out.nothing++; out.nothing_ids.push(id); }
  }
  out.parent_text_states_why = `${out.stated + out.generated}/${out.flagged}`;
  return out;
}
