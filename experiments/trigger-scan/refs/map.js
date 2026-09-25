// Step 3: map every 'moment' item to film time with Codex (independent model), validate the ranges in
// code, and write <slug>.key.json.
//
//   node refs/map.js [slug...]          run Codex mapping, then build the key
//   node refs/map.js --build [slug...]  rebuild keys from saved Codex answers (no model calls)
//
// Evaluation only: the key must never reach Sonnet, Jev, the question set or the policy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { runCodex, obj, CODEX_DIR, MODEL } from './codex.js';
import { longestSharedRun } from './normalise.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '..');
const ALL = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'];
// Held out in round 2 (frankenweenie, wild-robot), round 3 (iron-giant, up; all four now dev films) and
// round 4 (tangled, coco, how-to-train-your-dragon). Old keys keep the flag they were built with; the
// round-4 pipeline builder must not open the tangled, coco and how-to-train-your-dragon keys or data.
// Round 5 held-out films: book-of-life, princess-and-the-frog, moana (the v9 builder must not open their
// keys or data; round-4 films are dev films for v9).
// Round 6 held-out films: frozen, zootopia, good-dinosaur (the v10 builder must not open their keys or data).
// Round 8 fresh films (v10.2 test): incredibles, big-hero-6, brave (the v10.2 builder must not open their keys or data).
// Round 9 fresh films (v10.3 test): kung-fu-panda, onward, croods (the v10.3 builder must not open their keys or data).
const HELD_OUT = new Set(['frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon',
  'book-of-life', 'princess-and-the-frog', 'moana', 'frozen', 'zootopia', 'good-dinosaur', 'incredibles', 'big-hero-6', 'brave',
  'kung-fu-panda', 'onward', 'croods']);
const MAX_SPAN_MS = 8 * 60_000; // a single advisory moment wider than this is marked suspicious

const pad = (n) => String(n).padStart(2, '0');

function loadFilm(slug) {
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'raw', `${slug}.json`), 'utf8'));
  const norm = JSON.parse(fs.readFileSync(path.join(CODEX_DIR, `${slug}.items.json`), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  // Stable ids in Codex's output order: R01.. for advisory items (moment and film-level alike).
  const items = norm.items.map((it, i) => ({ ...it, id: `R${pad(i + 1)}` }));
  return { raw, norm, cues, items };
}

const MAP_SCHEMA = obj({
  mappings: {
    type: 'array',
    items: obj({
      id: { type: 'string' },
      mappable: { type: 'boolean' },
      cue_start: { type: 'integer' },
      cue_end: { type: 'integer' },
      confidence: { type: 'number' },
      wordless: { type: 'boolean' },
      note: { type: 'string' },
    }),
  },
});

function mapPrompt(raw, cues, moments) {
  return `You are locating moments from human-written parent advisories for the film "${raw.title}" (${raw.year}) in the film's subtitle track, to build an evaluation answer key.
Do not run any shell commands and do not open any files: everything you need is in this prompt.

For EVERY item below return one mapping:
- id: the item id.
- mappable: true only when the subtitle cues themselves let you locate where the moment happens.
- cue_start, cue_end: the cue numbers (the first number on each subtitle line) of the first and last cue that belong to the moment. Cover the moment itself (the attack, the chase, the death, the scream), not the whole surrounding sequence and not later scenes that only talk about it. Use 0 for both when mappable is false.
- confidence: 0 to 1. 0.9 or more when the cues plainly show the moment happening; 0.6 to 0.9 when the surrounding dialogue, reactions or sound captions strongly imply it; below 0.6 you should set mappable to false instead.
- wordless: true when the moment itself is mostly visual action with little or no dialogue, so that the range brackets it using the nearest cues (reactions, screams, sound captions, the lines just before and after).
- note: at most 20 words in your own words on what in the cues supports the range. Do not quote the subtitles.

Rules:
- Never guess. You may use your understanding of the story to interpret the cues, but every range must be supported by the cue text. If the subtitles cannot locate the moment (for example a wordless visual moment with no nearby reaction), set mappable to false.
- Several items can map to the same cues (different advisories often describe the same moment).
- An item that describes something happening more than once: map the first clear occurrence and say so in the note.

ITEMS (id | paraphrase | advisory wording):
${moments.map((m) => `${m.id} | ${m.text} | ${m.source_quote}`).join('\n')}

SUBTITLE CUES (cue number, start time h:mm:ss, text):
${cues.map((c) => `${c.index} ${formatTime(c.startMs)} ${c.text}`).join('\n')}
`;
}

function validate(mappings, moments, cues) {
  const byId = new Map(mappings.map((m) => [m.id, m]));
  const N = cues.length;
  const cueText = cues.map((c) => c.text).join(' ');
  const out = new Map();
  const problems = [];
  for (const it of moments) {
    const m = byId.get(it.id);
    if (!m) { problems.push(`${it.id}: no mapping returned`); out.set(it.id, { mappable: false, reason: 'no mapping returned' }); continue; }
    const v = { mappable: m.mappable, confidence: m.confidence, wordless: m.wordless, note: m.note, checks: [] };
    if (m.mappable) {
      const ok = Number.isInteger(m.cue_start) && Number.isInteger(m.cue_end) && m.cue_start >= 1 && m.cue_end <= N && m.cue_start <= m.cue_end;
      if (!ok) { v.mappable = false; v.checks.push(`invalid cue range ${m.cue_start}-${m.cue_end}`); }
      else {
        const a = cues[m.cue_start - 1]; const b = cues[m.cue_end - 1];
        Object.assign(v, {
          cue_range: [m.cue_start, m.cue_end], start_ms: a.startMs, end_ms: b.endMs,
          // Wordless action can run into the silent gaps on either side of the bracketing cues.
          gap_start_ms: m.cue_start > 1 ? cues[m.cue_start - 2].endMs : 0,
          gap_end_ms: m.cue_end < N ? cues[m.cue_end].startMs : b.endMs,
        });
        if (b.endMs - a.startMs > MAX_SPAN_MS) v.checks.push(`wide span ${Math.round((b.endMs - a.startMs) / 1000)} s`);
        if (!(m.confidence >= 0.6)) { v.mappable = false; v.checks.push(`confidence ${m.confidence} below 0.6 -> unmappable`); }
      }
    }
    if (!(m.confidence >= 0 && m.confidence <= 1)) v.checks.push(`confidence out of range ${m.confidence}`);
    const quoted = longestSharedRun(m.note ?? '', cueText);
    if (quoted > 8) { v.note = '[note removed: quoted subtitles]'; v.checks.push(`note quoted ${quoted} subtitle words`); }
    if (v.checks.length) problems.push(`${it.id}: ${v.checks.join(', ')}`);
    out.set(it.id, v);
  }
  const extra = mappings.filter((m) => !moments.some((it) => it.id === m.id)).map((m) => m.id);
  if (extra.length) problems.push(`unknown ids returned: ${extra.join(', ')}`);
  return { mapped: out, problems };
}


// Round-3 rule items (refs/rules.js): model-written from the subtitles, NOT from a human advisory.
// Validated in code and appended to items with source 'codex-rules' and human_written false.
const RULE_MAX_SPAN_MS = 3 * 60_000;
const RULE_CATEGORIES = { villain_threat: ['hostility', 'violence'], child_terrified: ['distress'] };
function ruleItems(slug, cues) {
  const p = path.join(CODEX_DIR, `${slug}.rules.answer.json`);
  if (!fs.existsSync(p)) return { items: [], problems: [] };
  const { moments } = JSON.parse(fs.readFileSync(p, 'utf8'));
  const N = cues.length;
  const cueText = cues.map((c) => c.text).join(' ');
  const problems = [];
  const sorted = [...moments].sort((a, b) => a.cue_start - b.cue_start || a.marker.localeCompare(b.marker));
  const items = sorted.map((m, i) => {
    const id = `C${pad(i + 1)}`;
    const checks = [];
    const ok = Number.isInteger(m.cue_start) && Number.isInteger(m.cue_end) && m.cue_start >= 1 && m.cue_end <= N && m.cue_start <= m.cue_end;
    if (!ok) checks.push(`invalid cue range ${m.cue_start}-${m.cue_end}`);
    let mappable = ok && m.confidence >= 0.6;
    if (ok && !(m.confidence >= 0.6)) checks.push(`confidence ${m.confidence} below 0.6 -> unmappable`);
    const a = ok ? cues[m.cue_start - 1] : null; const b = ok ? cues[m.cue_end - 1] : null;
    if (ok && b.endMs - a.startMs > RULE_MAX_SPAN_MS) checks.push(`wide span ${Math.round((b.endMs - a.startMs) / 1000)} s`);
    let { text, note } = m;
    const tq = longestSharedRun(text, cueText); const nq = longestSharedRun(note, cueText);
    if (tq > 8) { text = '[text removed: quoted subtitles]'; checks.push(`text quoted ${tq} subtitle words`); }
    if (nq > 8) { note = '[note removed: quoted subtitles]'; checks.push(`note quoted ${nq} subtitle words`); }
    if (text.split(/\s+/).length > 30) checks.push('text over 25 words');
    if (checks.length) problems.push(`${id}: ${checks.join(', ')}`);
    return {
      id, source: 'codex-rules', human_written: false, text, who: m.who, categories: RULE_CATEGORIES[m.marker],
      policy: { villain_threat: m.marker === 'villain_threat', child_terrified: m.marker === 'child_terrified', comic_peril: m.played_for_laughs },
      marker: m.marker, played_for_laughs: m.played_for_laughs,
      should_flag: true, flag_reason: `policy rule ${m.marker === 'villain_threat' ? 1 : 2} (${m.marker}), found by Codex in the subtitles`,
      same_moment_as: [], mappable,
      start_ms: mappable ? a.startMs : null, end_ms: mappable ? b.endMs : null,
      gap_start_ms: mappable ? (m.cue_start > 1 ? cues[m.cue_start - 2].endMs : 0) : null,
      gap_end_ms: mappable ? (m.cue_end < N ? cues[m.cue_end].startMs : b.endMs) : null,
      cue_range: mappable ? [m.cue_start, m.cue_end] : null,
      time: mappable ? `${formatTime(a.startMs)}-${formatTime(b.endMs)}` : null,
      map_confidence: m.confidence, wordless: false, map_note: note, map_checks: checks,
    };
  });
  return { items, problems };
}

// Round 4: an item whose Codex paraphrase copied more than 8 consecutive advisory words gets a
// paraphrase written by the key builder (Claude) instead; the item's meaning and labels are unchanged.
const TEXT_OVERRIDES = {
  tangled: { R68: 'A loose hook swings into a bystander, who bumps a helmet down over a woman; slapstick, nobody is hurt.' },
  moana: { R06: 'A man takes the shape of a big bird and flies off toward an island.' },
};

const flagValue = (s) => (s === 'true' ? true : s === 'tag_only' ? 'tag_only' : false);
const policyOf = (x) => ({ villain_threat: x.villain_threat, child_terrified: x.child_terrified, comic_peril: x.comic_peril });

function buildKey(slug, film, mappingAnswer) {
  const { raw, cues, items } = film;
  const moments = items.filter((i) => i.kind === 'moment');
  const { mapped, problems } = validate(mappingAnswer.mappings, moments, cues);
  const idOf = (idx) => items[idx]?.id;
  const topics = JSON.parse(fs.readFileSync(path.join(CODEX_DIR, 'dtdd-topics.json'), 'utf8')).topics;
  const dtdd = raw.sources.find((s) => s.source === 'doesthedogdie');

  const keyItems = moments.map((it) => {
    const m = mapped.get(it.id) ?? { mappable: false };
    const override = TEXT_OVERRIDES[slug]?.[it.id];
    return {
      id: it.id, source: it.source, text: override ?? it.text,
      ...(override ? { text_rewritten: `by the key builder: Codex text copied ${it.copied_run} consecutive advisory words` } : {}),
      categories: it.categories, policy: policyOf(it),
      should_flag: flagValue(it.should_flag), flag_reason: it.flag_reason,
      same_moment_as: it.same_moment_as.map(idOf),
      mappable: !!m.mappable,
      start_ms: m.mappable ? m.start_ms : null, end_ms: m.mappable ? m.end_ms : null,
      gap_start_ms: m.mappable ? m.gap_start_ms : null, gap_end_ms: m.mappable ? m.gap_end_ms : null,
      cue_range: m.mappable ? m.cue_range : null,
      time: m.mappable ? `${formatTime(m.start_ms)}-${formatTime(m.end_ms)}` : null,
      map_confidence: m.confidence ?? null, wordless: m.wordless ?? null, map_note: m.note ?? null,
      map_checks: m.checks ?? [],
    };
  });

  const filmLevel = items.filter((i) => i.kind === 'film_level').map((it) => ({
    id: it.id, source: it.source, text: it.text, categories: it.categories, policy: policyOf(it),
    should_flag: flagValue(it.should_flag), flag_reason: it.flag_reason,
  }));
  // DoesTheDogDie: one film-level item per fear-relevant topic that has votes or a verified answer.
  let d = 0;
  for (const t of dtdd?.topics ?? []) {
    const map = topics[t.topic_id];
    if (!map?.relevant) continue;
    const answer = t.verified ?? (t.yes > t.no ? 'yes' : t.no > t.yes ? 'no' : 'tie');
    if (answer === 'tie') continue;
    d += 1;
    filmLevel.push({
      id: `D${pad(d)}`, source: 'doesthedogdie', text: t.question, answer,
      votes: { yes: t.yes, no: t.no, margin: t.yes - t.no, verified: t.verified !== null },
      when: t.when_teaser, categories: map.categories, policy: policyOf(map),
      should_flag: answer === 'yes' ? flagValue(map.should_flag_if_yes) : false,
    });
  }

  const rules = ruleItems(slug, cues);
  const used = raw.sources.map((s) => ({ source: s.source, url: s.url, fetched_at: s.fetched_at }));
  const refused = raw.attempts.filter((a) => a.blocked || (a.status && a.status !== 200)).map((a) => ({ source: a.source, url: a.url, status: a.status, why: a.blocked ?? a.note ?? `HTTP ${a.status}` }));
  const key = {
    film: slug, title: raw.title, year: raw.year,
    built_at: new Date().toISOString(),
    purpose: 'EVALUATION ONLY. Never feed to Sonnet, Jev, question generation or policy.',
    held_out: HELD_OUT.has(slug),
    sources_used: used, sources_refused: refused,
    subtitles: { file: `data/${slug}.srt`, cues: cues.length },
    mapper: { tool: 'codex exec', model: MODEL, reasoning: 'high', sandbox: 'read-only' },
    counts: {
      moments: keyItems.length, mappable: keyItems.filter((x) => x.mappable).length,
      film_level: filmLevel.length,
      by_source: Object.fromEntries([...new Set([...keyItems, ...filmLevel].map((x) => x.source))].map((s) => [s, {
        moments: keyItems.filter((x) => x.source === s).length,
        mappable: keyItems.filter((x) => x.source === s && x.mappable).length,
        film_level: filmLevel.filter((x) => x.source === s).length,
      }])),
      should_flag: {
        true: keyItems.filter((x) => x.should_flag === true).length,
        tag_only: keyItems.filter((x) => x.should_flag === 'tag_only').length,
        false: keyItems.filter((x) => x.should_flag === false).length,
      },
    },
    // Rule items are model-written (Codex over the subtitles). They are NOT in counts.moments/mappable/
    // by_source/should_flag above, which stay human-written only; filter items by human_written.
    codex_rules: rules.items.length ? {
      what: 'Codex (gpt-6-astra, high) listed rule-1 villain_threat and rule-2 child_terrified moments from the subtitle cues only. Model-written, not human-written.',
      items: rules.items.length, mappable: rules.items.filter((x) => x.mappable).length,
      villain_threat: rules.items.filter((x) => x.marker === 'villain_threat').length,
      child_terrified: rules.items.filter((x) => x.marker === 'child_terrified').length,
      played_for_laughs: rules.items.filter((x) => x.played_for_laughs).length,
    } : null,
    audit: (() => { const p = path.join(here, 'audits.json'); return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8'))[slug] ?? null) : null; })(),
    validation_problems: [...problems, ...rules.problems],
    items: [...keyItems.map((x) => ({ ...x, human_written: true })), ...rules.items], film_level: filmLevel,
  };
  fs.writeFileSync(path.join(here, `${slug}.key.json`), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${slug}: ${key.counts.moments} moments, ${key.counts.mappable} mappable, ${filmLevel.length} film-level; problems: ${problems.length}`);
}

async function mapFilm(slug, { build }) {
  const film = loadFilm(slug);
  const moments = film.items.filter((i) => i.kind === 'moment');
  let answer;
  const saved = path.join(CODEX_DIR, `${slug}.map.answer.json`);
  if (build) answer = JSON.parse(fs.readFileSync(saved, 'utf8'));
  else answer = (await runCodex(`${slug}.map`, mapPrompt(film.raw, film.cues, moments), MAP_SCHEMA)).answer;
  buildKey(slug, film, answer);
}

const args = process.argv.slice(2);
const build = args[0] === '--build';
const slugs = args.filter((a) => !a.startsWith('--'));
await Promise.all((slugs.length ? slugs : ALL).map((s) => mapFilm(s, { build }).catch((e) => console.error(s, e.stack))));
