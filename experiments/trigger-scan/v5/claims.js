// Pure logic for check-claims.js: turn a segments file into claims with their OWN cited evidence,
// batch them, build the Jev requests, and fold verdicts back into the segments. No I/O.
//
// Pattern: docs.typesafe.ai/cookbooks/citation_check — one Choice (supports / contradicts /
// says_nothing) over {claim, evidence}; a verdict stands on its own at confidence >= 0.8.
// Batching: several claims share one request as `claims[i]`, each question points at its own
// `claims[i].claim` and `claims[i].evidence` by path (primitives: "Reference specific fields").
// Claims in one batch are taken with a stride across the film, so neighbours in a request are
// unrelated and a leak between them cannot manufacture support. check-claims.js measures leakage.

export const MODEL = 'jev-1.13.0';
export const AUTO_ACCEPT = 0.8;
export const VERSION = 'claimcheck-v5.0';

// ---- evidence -------------------------------------------------------------------------------------
/** One cited id -> the evidence string Jev reads. `src` = { cues, W, T }. */
export function evidenceText(id, src) {
  const n = Number(id.slice(1));
  if (id[0] === 'L') return `${id} (subtitle line): ${src.cues[n - 1].text}`;
  if (id[0] === 'W') return `${id} (Wikipedia plot sentence): ${src.W[n - 1].text}`;
  const t = src.T[n - 1];
  return `${id} (TMDB cast list entry): character "${t.character}"${t.voice ? ', a voice role' : ''}`;
}

// ---- claims -----------------------------------------------------------------------------------------
const KIND_PHRASE = {
  person: 'a grown-up human or human-like person',
  child: 'a human child',
  animal: 'an animal',
  creature: 'a monster or fantasy creature',
  robot: 'a robot',
};

/** The claim sentence for one cast field, or null when there is nothing to check. */
export function castClaim(c, field) {
  const n = c.name;
  const withNote = (s) => (c.disposition_note ? `${s}: ${c.disposition_note.replace(/[.\s]+$/, '')}.` : `${s}.`);
  switch (field) {
    case 'name': return `There is a character called ${n} in this film.`;
    case 'kind': return KIND_PHRASE[c.kind] ? `${n} is ${KIND_PHRASE[c.kind]}.` : null;
    case 'is_child': return c.is_child === true ? `${n} is a child or a young one.` : c.is_child === false ? `${n} is a grown-up, not a child.` : null;
    case 'looks_frightening': return c.looks_frightening === true ? `${n} looks frightening.` : c.looks_frightening === false ? `${n} looks harmless.` : null;
    case 'disposition':
      return {
        villain: withNote(`${n} is a villain who works against the main characters`),
        threat: withNote(`${n} is a danger to other characters`),
        ally: withNote(`${n} helps the main characters`),
        neutral: withNote(`${n} neither helps nor harms the main characters`),
        changes: withNote(`${n} changes sides or attitude during the film`),
      }[c.disposition] ?? null;
    default: return null;
  }
}

/**
 * The evidence ids for a claim: its cites, plus up to `context` subtitle lines either side of each
 * cited line (clipped to `range`, the scene, when given). This is the cookbook's "quote in its
 * context": a line is judged with the exchange it belongs to. Lines first in film order, then W, T.
 */
export function evidenceIds(cites, { context = 0, range = null, nCues = Infinity } = {}) {
  const lines = new Set();
  for (const id of cites) {
    if (id[0] !== 'L') continue;
    const n = Number(id.slice(1));
    const lo = Math.max(range ? range[0] : 1, n - context);
    const hi = Math.min(range ? range[1] : nCues, n + context);
    for (let k = lo; k <= hi; k++) lines.add(k);
  }
  const other = cites.filter((id) => id[0] !== 'L');
  return [...[...lines].sort((a, b) => a - b).map((k) => `L${k}`), ...other.filter((id) => id[0] === 'W'), ...other.filter((id) => id[0] === 'T')];
}

/**
 * Every checkable claim in a segments file: [{ key, target, claim, cites, evidence_ids, evidence:[...] }].
 * key is stable ('S012.s2', 'S012.setting', 'C03.kind', 'D02'). `context` = neighbouring lines per cited line.
 */
export function buildClaims(seg, src, { context = 0 } = {}) {
  const out = [];
  const add = (key, target, claim, cites, range = null) => {
    if (!claim || !cites?.length) return;
    const ids = evidenceIds(cites, { context, range, nCues: src.cues.length });
    out.push({ key, target, claim, cites, evidence_ids: ids, evidence: ids.map((id) => evidenceText(id, src)) });
  };
  for (const s of seg.scenes) {
    const range = [s.start_cue, s.end_cue];
    s.sentences.forEach((x, i) => add(`${s.id}.s${i + 1}`, { type: 'sentence', scene: s.id, index: i }, x.text, x.cites, range));
    if (s.setting && s.setting !== 'unknown') add(`${s.id}.setting`, { type: 'setting', scene: s.id }, `This scene takes place here: ${s.setting}.`, s.setting_cites, range);
  }
  for (const c of seg.cast) {
    for (const f of ['name', 'kind', 'is_child', 'looks_frightening', 'disposition']) add(`${c.id}.${f}`, { type: 'cast', id: c.id, field: f }, castClaim(c, f), c.cites[f]);
  }
  for (const d of seg.dangers) add(d.id, { type: 'danger', id: d.id }, `In this film, ${d.name} is a danger: ${d.note.replace(/[.\s]+$/, '')}.`, d.cites);
  return out;
}

/** Split n items into ceil(n/size) batches by stride, so each batch's members are far apart. */
export function strideBatches(items, size) {
  const k = Math.max(1, Math.ceil(items.length / size));
  const batches = Array.from({ length: k }, () => []);
  items.forEach((it, i) => batches[i % k].push(it));
  return batches.filter((b) => b.length);
}

// ---- requests ---------------------------------------------------------------------------------------
export const RELATION_CRITERIA = {
  supports: 'The evidence states the claim, or the claim follows directly from it. Every part of the claim (who, what happens, to whom, and any detail such as age, species, cause or outcome) is backed by the evidence.',
  contradicts: 'The evidence states something that makes the claim false: a different character, a different outcome, the opposite action, or a detail that cannot be true together with the evidence.',
  says_nothing: 'The evidence does not settle the claim either way: it is about something else, or it backs only part of the claim and is silent on the rest (the claim adds a detail, cause, feeling or outcome the evidence never mentions).',
};
const EVIDENCE_NOTE = 'Evidence items are subtitle lines (dialogue or sound captions; the speaker is usually not named), sentences from the Wikipedia plot summary, or TMDB cast list entries.';

export function relationQuestion(i) {
  return {
    type: 'choice',
    instructions: `How does \`claims[${i}].evidence\` relate to \`claims[${i}].claim\`? Judge only from \`claims[${i}].evidence\`, not from any other claim or evidence and not from outside knowledge. ${EVIDENCE_NOTE}`,
    criteria: RELATION_CRITERIA,
  };
}

/** The request body for one batch; question ids r0..rk map to batch positions. */
export function batchBody(batch) {
  const state = { claims: batch.map((c) => ({ claim: c.claim, evidence: c.evidence })) };
  const questions = Object.fromEntries(batch.map((_, i) => [`r${i}`, relationQuestion(i)]));
  return { model: MODEL, state, questions };
}

// Placement: a sentence that cites only Wikipedia (film-level) is checked separately against the
// scene's own lines, in its own request, so the lines can never be read as support for the claim.
export const PLACEMENT_CRITERIA = {
  fits: 'The lines show this event happening here: they include dialogue or sound captions that belong to this event.',
  conflicts: 'The lines show something that cannot be this event, such as other characters in another place doing something unrelated.',
  cannot_tell: 'The lines neither show the event nor rule it out (for example there are few lines, or only music).',
};
export function placementBody(event, sceneLines) {
  return {
    model: MODEL,
    state: { event, scene_lines: sceneLines },
    questions: {
      placement: {
        type: 'choice',
        instructions: 'Do the subtitle lines in `scene_lines` show that the event in `event` happens during these lines? Sound captions describe what is heard.',
        criteria: PLACEMENT_CRITERIA,
      },
    },
  };
}

// ---- verdicts ---------------------------------------------------------------------------------------
/** Jev Choice answer -> { verdict, confidence, probabilities, status }. */
export function verdictOf(ans) {
  const verdict = ans.choice;
  const confidence = +Number(ans.confidence).toFixed(4);
  let status;
  if (verdict === 'supports') status = confidence >= AUTO_ACCEPT ? 'verified' : 'unverified';
  else if (verdict === 'contradicts') status = 'contradicted';
  else status = 'unverified';
  const probabilities = Object.fromEntries(Object.entries(ans.probabilities ?? {}).map(([k, v]) => [k, +Number(v).toFixed(4)]));
  return { verdict, confidence, probabilities, status };
}

/**
 * Fold checks into a copy of the segments file.
 *   checks:     { key -> verdictOf(...) }
 *   placements: { key -> { choice, confidence } } for Wikipedia-only sentences
 * Rules:
 *   sentence   check stored on it; summary = verified sentences with no judgement words, and a
 *              Wikipedia-only sentence also needs placement 'fits' at >= AUTO_ACCEPT (else 'unplaced')
 *   setting    contradicted -> 'unknown'; check stored as setting_check
 *   cast field contradicted -> field 'unknown' (and note cleared for disposition); check per field
 *   danger     contradicted -> removed (recorded in dropped_by_check)
 */
export function applyChecks(seg, checks, placements = {}) {
  const out = structuredClone(seg);
  const dropped = [];
  for (const s of out.scenes) {
    s.sentences.forEach((x, i) => {
      const key = `${s.id}.s${i + 1}`;
      const c = checks[key];
      if (!c) { x.check = { status: 'unchecked' }; return; }
      x.check = { verdict: c.verdict, confidence: c.confidence, status: c.status };
      const wOnly = !x.cites.some((id) => id[0] === 'L');
      if (wOnly) {
        const p = placements[key];
        x.check.placement = p ? { choice: p.choice, confidence: p.confidence } : { choice: 'not_checked' };
        // placement is held to the same bar as the claim: 'fits' at confidence >= AUTO_ACCEPT
        if (x.check.status === 'verified' && !(p?.choice === 'fits' && p.confidence >= AUTO_ACCEPT)) x.check.status = 'unplaced';
      }
    });
    s.summary = s.sentences.filter((x) => x.check.status === 'verified' && !x.judgement_words).map((x) => x.text).join(' ');
    s.summary_sentences = { verified: s.sentences.filter((x) => x.check.status === 'verified').length, total: s.sentences.length };
    const sc = checks[`${s.id}.setting`];
    if (sc) {
      s.setting_check = { verdict: sc.verdict, confidence: sc.confidence, status: sc.status };
      if (sc.status === 'contradicted') { dropped.push({ key: `${s.id}.setting`, was: s.setting }); s.setting = 'unknown'; }
    }
  }
  for (const c of out.cast) {
    c.check = {};
    for (const f of ['name', 'kind', 'is_child', 'looks_frightening', 'disposition']) {
      const k = checks[`${c.id}.${f}`];
      if (!k) continue;
      c.check[f] = { verdict: k.verdict, confidence: k.confidence, status: k.status };
      if (k.status === 'contradicted' && f !== 'name') {
        dropped.push({ key: `${c.id}.${f}`, was: c[f] });
        c[f] = 'unknown';
        c.cites[f] = [];
        if (f === 'disposition') c.disposition_note = '';
      }
    }
  }
  const keep = [];
  for (const d of out.dangers) {
    const k = checks[d.id];
    if (k) d.check = { verdict: k.verdict, confidence: k.confidence, status: k.status };
    if (k?.status === 'contradicted') dropped.push({ key: d.id, was: d.name });
    else keep.push(d);
  }
  out.dangers = keep;
  return { seg: out, dropped };
}

export function tally(checks) {
  const t = { supports: 0, contradicts: 0, says_nothing: 0, verified: 0, unverified: 0, contradicted: 0, supports_below_0_8: 0 };
  // statuses here are the claim-level ones (before placement)
  for (const c of Object.values(checks)) {
    t[c.verdict]++;
    t[c.status]++;
    if (c.verdict === 'supports' && c.status !== 'verified') t.supports_below_0_8++;
  }
  return t;
}
