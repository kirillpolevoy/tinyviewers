// Pure citation checks for segment.js and check-claims.js. No I/O, no model calls.
//
// Cite ids:  L<n>  subtitle cue n (1-based index in the parsed SRT)
//            W<n>  Wikipedia plot sentence n
//            T<n>  TMDB cast entry n

export const CITE_RE = /^([LWT])([1-9]\d*)$/;

export const CAST_KINDS = ['person', 'child', 'animal', 'creature', 'robot', 'other', 'unknown'];
export const TRI = ['true', 'false', 'unknown'];
export const DISPOSITIONS = ['villain', 'threat', 'ally', 'neutral', 'changes', 'unknown'];
export const DANGER_KINDS = ['machine', 'place', 'object', 'creature_group', 'situation'];
// The 13 universal parent-facing groups (taxonomy-v3 GROUPS), plus 'none'. A cast member's or
// danger's group is the universal group its film-specific questions map back to.
export const GROUPS = ['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable', 'none'];
// Cast fields that are claims and need their own cites; `name` is the claim that the character exists.
export const CAST_CLAIM_FIELDS = ['name', 'kind', 'is_child', 'looks_frightening', 'disposition'];

/**
 * Normalise and check one list of cite ids against what exists.
 *   ctx = { nCues, wCount, tCount, range?: [startCue, endCue] }
 * With `range`, an L id outside it is rejected as 'outside_scene' (a scene sentence may only cite
 * lines of its own scene). Returns { ok: [...unique valid ids in order], rejected: [{id, why}] }.
 */
export function checkCites(cites, ctx) {
  const ok = [];
  const rejected = [];
  for (const raw of Array.isArray(cites) ? cites : []) {
    const id = String(raw).trim().toUpperCase();
    const m = id.match(CITE_RE);
    if (!m) { rejected.push({ id: String(raw), why: 'malformed' }); continue; }
    const n = Number(m[2]);
    const max = m[1] === 'L' ? ctx.nCues : m[1] === 'W' ? ctx.wCount : ctx.tCount;
    if (n > max) { rejected.push({ id, why: 'unknown' }); continue; }
    if (m[1] === 'L' && ctx.range && (n < ctx.range[0] || n > ctx.range[1])) { rejected.push({ id, why: 'outside_scene' }); continue; }
    if (!ok.includes(id)) ok.push(id);
  }
  return { ok, rejected };
}

/** Which of the three sources a list of valid cite ids draws on. */
export function sourcesOf(ids) {
  const s = new Set();
  for (const id of ids) s.add(id[0] === 'L' ? 'lines' : id[0] === 'W' ? 'wikipedia' : 'tmdb');
  return ['lines', 'wikipedia', 'tmdb'].filter((x) => s.has(x));
}

/**
 * The cast rule: a field value other than 'unknown' needs at least one valid cite, else it becomes
 * 'unknown'. A cast member with no valid cite for the name AND no TMDB entry is dropped.
 * `raw` is the model's cast row; returns { member|null, demoted: [field], rejected: [{field,id,why}] }.
 */
export function gateCastMember(raw, ctx) {
  const rejected = [];
  const cites = {};
  for (const f of CAST_CLAIM_FIELDS) {
    const r = checkCites(raw.cites?.[f] ?? [], ctx);
    r.rejected.forEach((x) => rejected.push({ field: f, ...x }));
    cites[f] = r.ok;
  }
  const tmdb = typeof raw.tmdb === 'string' && /^T[1-9]\d*$/.test(raw.tmdb) && Number(raw.tmdb.slice(1)) <= ctx.tCount ? raw.tmdb : null;
  if (tmdb && !cites.name.includes(tmdb)) cites.name.push(tmdb);
  if (!cites.name.length) return { member: null, demoted: [], rejected };
  const demoted = [];
  const val = (f, allowed) => {
    const v = allowed.includes(String(raw[f])) ? String(raw[f]) : 'unknown';
    if (v !== 'unknown' && !cites[f].length) { demoted.push(f); return 'unknown'; }
    return v;
  };
  const tri = (v) => (v === 'true' ? true : v === 'false' ? false : 'unknown');
  const member = {
    name: String(raw.name).trim(),
    tmdb,
    aliases: gateAliases(raw.aliases, ctx, rejected),
    kind: val('kind', CAST_KINDS),
    is_child: tri(val('is_child', TRI)),
    looks_frightening: tri(val('looks_frightening', TRI)),
    disposition: val('disposition', DISPOSITIONS),
    disposition_note: String(raw.disposition_note ?? '').trim(),
    group: GROUPS.includes(raw.group) ? raw.group : 'none',
    cites,
  };
  for (const f of ['kind', 'is_child', 'looks_frightening', 'disposition']) if (member[f] === 'unknown') cites[f] = [];
  if (member.disposition === 'unknown') member.disposition_note = '';
  return { member, demoted, rejected };
}

/**
 * v6 aliases: [{name, cites}] from the model; an alias keeps only its valid cites and is dropped when
 * none is left (an uncited alias is never used). Legacy plain-string aliases pass through unchanged
 * (they get code-found cites or are refused at the claim check).
 */
export function gateAliases(aliases, ctx, rejected = []) {
  const out = [];
  for (const a of aliases ?? []) {
    if (typeof a === 'string') { if (a.trim()) out.push(a.trim()); continue; }
    const name = String(a?.name ?? '').trim();
    if (!name) continue;
    const r = checkCites(a.cites ?? [], ctx);
    r.rejected.forEach((x) => rejected.push({ field: `alias:${name}`, ...x }));
    if (!r.ok.length) { rejected.push({ field: `alias:${name}`, id: null, why: 'uncited_alias_dropped' }); continue; }
    out.push({ name, cites: r.ok });
  }
  return out;
}

/** How many distinct scenes cite each W id. Returns { perW: {W7: 3, ...}, uncited: [ids], max, spread: [{id, scenes}] (>1 scene, most first) }. */
export function wikiSpread(scenes, wCount) {
  const perW = {};
  for (const s of scenes) {
    const ws = new Set(s.sentences.flatMap((x) => x.cites).filter((id) => id[0] === 'W'));
    for (const w of ws) perW[w] = (perW[w] ?? 0) + 1;
  }
  const all = Array.from({ length: wCount }, (_, i) => `W${i + 1}`);
  const spread = Object.entries(perW).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, scenes: n }));
  return { perW, uncited: all.filter((w) => !perW[w]), max: Math.max(0, ...Object.values(perW)), spread };
}
