// Pure logic for check-claims.js: turn a segments file into claims with their OWN cited evidence,
// batch them, build the Jev requests, and fold verdicts back into the segments. No I/O.
//
// Pattern: docs.typesafe.ai/cookbooks/citation_check — one Choice (supports / contradicts /
// says_nothing) over {claim, evidence}.
//
// v6 changes (round-1 finding (c), (d)):
//   ATOMIC ROLE CLAIMS. v5 checked "<X> is a villain who works against the main characters: <note>":
//     a label plus a note that bundled several facts, so a claim the evidence backed in part failed
//     (Waternoose 0.74, Barracuda 0.37, the hyenas). Now each cast field is one fact ('<X> is a child
//     or a young one.', '<X> is a villain who works against the main characters.', '<X> looks
//     frightening.'), the note is its own claim (C05.note, shown to Jev only when verified), and a
//     danger's existence ('<D> is a danger to characters in this film.') is checked apart from its
//     note (D01.note).
//   ENTITY LINK. A cast field's evidence also carries the cites of the character's NAME claim: the
//     field evidence often describes the character without naming them (Boo: W6 'a toddler girl';
//     the name link is W11 'nicknames her Boo'), so v5 answered says_nothing.
//   ALIASES are claims ('<X> is also called <alias>.') with cites (Sonnet's, or code-found for
//     legacy v5 segments: the TMDB entry / lines that contain the alias verbatim). Aliases made only
//     of common words are refused without a check (aliases.js).
//   ACCEPTANCE RULE from policy.json claim_accept (calibrated by calibrate-claims.js on the round-1
//     verifier's judgements): verified when p(supports) >= min_supports and p(contradicts) <
//     max_contradicts; contradicted only when the verdict is 'contradicts' with p(contradicts) >=
//     contradict_min (v5 dropped any 'contradicts' answer, even at confidence 0.15).
//   PLACEMENT for every sentence that cites Wikipedia: a Wikipedia-only sentence must 'fit' the
//     scene's lines (same rule); a sentence citing lines AND Wikipedia is 'unplaced' when the lines
//     conflict with it (v5 skipped these: Nemo S020.s1 'meets Gill' on W16 in a dentist-only scene).

import { aliasList, foundAliasCites, aliasProblem } from './aliases.js';

export const MODEL = 'jev-1.13.0';
export const VERSION = 'claimcheck-v6.0';
// Default rule; check-claims.js passes policy.json claim_accept.
export const DEFAULT_RULE = { min_supports: 0.7, max_contradicts: 0.15, contradict_min: 0.5 };

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

/** The ATOMIC claim sentence for one cast field, or null when there is nothing to check. */
export function castClaim(c, field) {
  const n = c.name;
  switch (field) {
    case 'name': return `There is a character called ${n} in this film.`;
    case 'kind': return KIND_PHRASE[c.kind] ? `${n} is ${KIND_PHRASE[c.kind]}.` : null;
    case 'is_child': return c.is_child === true ? `${n} is a child or a young one.` : c.is_child === false ? `${n} is a grown-up, not a child.` : null;
    case 'looks_frightening': return c.looks_frightening === true ? `${n} looks frightening.` : c.looks_frightening === false ? `${n} looks harmless.` : null;
    case 'disposition':
      return {
        villain: `${n} is a villain who works against the main characters.`,
        threat: `${n} is a danger to other characters.`,
        ally: `${n} helps the main characters.`,
        neutral: `${n} neither helps nor harms the main characters.`,
        changes: `${n} changes sides or attitude during the film.`,
      }[c.disposition] ?? null;
    case 'note': {
      const note = String(c.disposition_note ?? '').trim().replace(/[.\s]+$/, '');
      return note && c.disposition && c.disposition !== 'unknown' ? `About ${n}: ${note}.` : null;
    }
    default: return null;
  }
}

export const aliasClaim = (c, alias) => `${c.name} is also called ${alias}.`;
export const dangerClaim = (d) => `In this film, ${d.name} is a danger to characters.`;
export const dangerNoteClaim = (d) => (d.note ? `About ${d.name} in this film: ${String(d.note).replace(/[.\s]+$/, '')}.` : null);

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
  const other = [...new Set(cites.filter((id) => id[0] !== 'L'))];
  return [...[...lines].sort((a, b) => a - b).map((k) => `L${k}`), ...other.filter((id) => id[0] === 'W'), ...other.filter((id) => id[0] === 'T')];
}

const uniq = (a) => [...new Set(a)];

/**
 * Every checkable claim in a segments file: [{ key, target, claim, cites, evidence_ids, evidence:[...] }].
 * key is stable ('S012.s2', 'S012.setting', 'C03.kind', 'C03.note', 'C03.alias1', 'D02', 'D02.note').
 * `context` = neighbouring lines per cited line. Cast field claims carry the name cites too (entity link).
 */
export function buildClaims(seg, src, { context = 0 } = {}) {
  const out = [];
  const refused = [];
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
    const nameCites = c.cites?.name ?? [];
    add(`${c.id}.name`, { type: 'cast', id: c.id, field: 'name' }, castClaim(c, 'name'), nameCites);
    for (const f of ['kind', 'is_child', 'looks_frightening', 'disposition']) {
      const own = c.cites?.[f] ?? [];
      if (own.length) add(`${c.id}.${f}`, { type: 'cast', id: c.id, field: f }, castClaim(c, f), uniq([...own, ...nameCites]));
    }
    // the note rests on the disposition's cites
    const dc = c.cites?.disposition ?? [];
    if (dc.length) add(`${c.id}.note`, { type: 'cast', id: c.id, field: 'note' }, castClaim(c, 'note'), uniq([...dc, ...nameCites]));
    aliasList(c).forEach((a, i) => {
      const key = `${c.id}.alias${i + 1}`;
      if (a.problem) { refused.push({ key, alias: a.name, why: a.problem }); return; }
      const cites = a.cites?.length ? a.cites : foundAliasCites(c, a.name, { cues: src.cues.map((q, k) => ({ index: k + 1, text: q.text })), T: src.T });
      if (!cites.length) { refused.push({ key, alias: a.name, why: 'no_cite' }); return; }
      add(key, { type: 'alias', id: c.id, index: i, alias: a.name, cites_found_by_code: !a.cites?.length }, aliasClaim(c, a.name), uniq([...cites, ...nameCites]));
    });
  }
  for (const d of seg.dangers) {
    add(d.id, { type: 'danger', id: d.id }, dangerClaim(d), d.cites);
    add(`${d.id}.note`, { type: 'danger_note', id: d.id }, dangerNoteClaim(d), d.cites);
  }
  out.refused_aliases = refused;
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

// Placement: a sentence that cites Wikipedia is checked separately against the scene's own lines, in
// its own request, so the lines can never be read as support for the claim.
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
const P = (probs, k) => Number(probs?.[k]) || 0;

/** Status of one answer under a rule: 'verified' | 'contradicted' | 'unverified'. */
export function statusOf({ verdict, confidence, probabilities }, rule = DEFAULT_RULE) {
  const has = probabilities && Object.keys(probabilities).length;
  const ps = has ? P(probabilities, 'supports') : verdict === 'supports' ? Number(confidence) : 0;
  const pc = has ? P(probabilities, 'contradicts') : verdict === 'contradicts' ? Number(confidence) : 0;
  if (ps >= rule.min_supports && pc < rule.max_contradicts) return 'verified';
  if (verdict === 'contradicts' && pc >= rule.contradict_min) return 'contradicted';
  return 'unverified';
}

/** Jev Choice answer -> { verdict, confidence, probabilities, status } under `rule`. */
export function verdictOf(ans, rule = DEFAULT_RULE) {
  const verdict = ans.choice ?? ans.verdict;
  const confidence = +Number(ans.confidence).toFixed(4);
  const probabilities = Object.fromEntries(Object.entries(ans.probabilities ?? {}).map(([k, v]) => [k, +Number(v).toFixed(4)]));
  return { verdict, confidence, probabilities, status: statusOf({ verdict, confidence, probabilities }, rule) };
}

/**
 * Placement outcome for a sentence: 'placed' or 'unplaced'.
 *   Wikipedia-only sentence: needs p(fits) >= rule.min_supports and p(conflicts) < rule.max_contradicts.
 *   Lines + Wikipedia: unplaced only when p(conflicts) >= rule.contradict_min.
 */
export function placementOutcome(p, wikiOnly, rule = DEFAULT_RULE) {
  if (!p || p.choice === 'not_checked') return wikiOnly ? 'unplaced' : 'placed';
  const probs = p.probabilities ?? {};
  const has = Object.keys(probs).length;
  const fits = has ? P(probs, 'fits') : p.choice === 'fits' ? Number(p.confidence) : 0;
  const conf = has ? P(probs, 'conflicts') : p.choice === 'conflicts' ? Number(p.confidence) : 0;
  if (wikiOnly) return fits >= rule.min_supports && conf < rule.max_contradicts ? 'placed' : 'unplaced';
  return conf >= rule.contradict_min ? 'unplaced' : 'placed';
}

const slim = (c) => ({ verdict: c.verdict, confidence: c.confidence, ...(c.probabilities && Object.keys(c.probabilities).length ? { probabilities: c.probabilities } : {}), status: c.status, ...(c.code_verified ? { code_verified: c.code_verified } : {}) });

/**
 * Fold checks into a copy of the segments file.
 *   checks:     { key -> verdictOf(...) }
 *   placements: { key -> { choice, confidence, probabilities } } for sentences that cite Wikipedia
 * Rules:
 *   sentence   check stored on it; summary = verified, placed sentences with no judgement words
 *   setting    contradicted -> 'unknown'; check stored as setting_check
 *   cast field contradicted -> field 'unknown' (disposition also clears the note); check per field;
 *              note / alias checks stored as check.note and aliases[i].check
 *   danger     contradicted -> removed; note check stored as note_check
 */
export function applyChecks(seg, checks, placements = {}, rule = DEFAULT_RULE) {
  const out = structuredClone(seg);
  const dropped = [];
  for (const s of out.scenes) {
    s.sentences.forEach((x, i) => {
      const key = `${s.id}.s${i + 1}`;
      const c = checks[key];
      if (!c) { x.check = { status: 'unchecked' }; return; }
      x.check = slim(c);
      const wCites = x.cites.some((id) => id[0] === 'W');
      if (!wCites) return;
      const wOnly = !x.cites.some((id) => id[0] === 'L');
      const p = placements[key];
      x.check.placement = p ? { choice: p.choice, confidence: p.confidence, ...(p.probabilities ? { probabilities: p.probabilities } : {}) } : { choice: 'not_checked' };
      if (x.check.status === 'verified' && placementOutcome(p, wOnly, rule) === 'unplaced') x.check.status = 'unplaced';
    });
    s.summary = s.sentences.filter((x) => x.check.status === 'verified' && !x.judgement_words).map((x) => x.text).join(' ');
    s.summary_sentences = { verified: s.sentences.filter((x) => x.check.status === 'verified').length, total: s.sentences.length };
    const sc = checks[`${s.id}.setting`];
    if (sc) {
      s.setting_check = slim(sc);
      if (sc.status === 'contradicted') { dropped.push({ key: `${s.id}.setting`, was: s.setting }); s.setting = 'unknown'; }
    }
  }
  for (const c of out.cast) {
    c.check = {};
    for (const f of ['name', 'kind', 'is_child', 'looks_frightening', 'disposition', 'note']) {
      const k = checks[`${c.id}.${f}`];
      if (!k) continue;
      c.check[f] = slim(k);
      if (k.status === 'contradicted' && f !== 'name' && f !== 'note') {
        dropped.push({ key: `${c.id}.${f}`, was: c[f] });
        c[f] = 'unknown';
        c.cites[f] = [];
        if (f === 'disposition') c.disposition_note = '';
      }
    }
    if (Array.isArray(c.aliases)) {
      c.aliases = c.aliases.map((a, i) => {
        const o = typeof a === 'string' ? { name: a, cites: [] } : { ...a };
        const k = checks[`${c.id}.alias${i + 1}`];
        return k ? { ...o, check: slim(k) } : { ...o, check: { status: 'unchecked' } };
      });
    }
  }
  const keep = [];
  for (const d of out.dangers) {
    const k = checks[d.id];
    if (k) d.check = slim(k);
    const n = checks[`${d.id}.note`];
    if (n) d.note_check = slim(n);
    if (k?.status === 'contradicted') dropped.push({ key: d.id, was: d.name });
    else keep.push(d);
  }
  out.dangers = keep;
  return { seg: out, dropped };
}

/**
 * Run-phase fix (found on the dev films' claim check, before the freeze and before any scoring).
 * A cast member whose NAME claim was not verified but who cites their own TMDB entry for the name
 * takes the TMDB character string as their name, and the name counts as verified by code: the
 * verified source states that name. Cause: Sonnet wrote fuller names from memory that no source
 * gives (MI 'Henry J. Waternoose' and 'Randall Boggs' where TMDB says 'Waternoose' / 'Randall'); the
 * check correctly refused those strings, but an unverified name removes the character (here both
 * verified villains) from every Jev state and from the film-specific questions. The model's string
 * is kept as name_unverified and is never shown or matched. A TMDB string made only of common words
 * (aliases.js) is not adopted. Mutates `seg` cast rows and `checks`; returns [{key, from, to}].
 */
export function adoptTmdbNames(seg, src, checks) {
  const done = [];
  for (const c of seg.cast ?? []) {
    const key = `${c.id}.name`;
    const k = checks[key];
    if (!k || k.status === 'verified' || !c.tmdb || !/^T\d+$/.test(c.tmdb)) continue;
    if (!(c.cites?.name ?? []).includes(c.tmdb)) continue;
    const t = src.T[Number(c.tmdb.slice(1)) - 1];
    const tname = String(t?.character ?? '').trim();
    if (!tname || aliasProblem(tname) ) continue;
    const from = c.name;
    if (tname !== from) { c.name_unverified = from; c.name = tname; }
    checks[key] = { ...k, status: 'verified', code_verified: 'tmdb_name' };
    done.push({ key, from, to: tname });
  }
  return done;
}

export function tally(checks) {
  const t = { supports: 0, contradicts: 0, says_nothing: 0, verified: 0, unverified: 0, contradicted: 0, supports_not_verified: 0 };
  // statuses here are the claim-level ones (before placement)
  for (const c of Object.values(checks)) {
    t[c.verdict] = (t[c.verdict] ?? 0) + 1;
    t[c.status]++;
    if (c.verdict === 'supports' && c.status !== 'verified') t.supports_not_verified++;
  }
  return t;
}
