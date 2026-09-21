// Builds a single self-contained HTML page for human review of a drafted reference scene list.
//
//   node build-review.js --film monsters-inc [--gold gold/monsters-inc.json] [--taxonomy ./taxonomy-v3.js]
//
// Output: review/<slug>.html -- inline CSS and JS, no network requests, opens from file://.
// review/ is git-ignored because the page embeds subtitle text.
//
// The taxonomy module path is a parameter and defaults to taxonomy-v3.js (the presence/event split,
// which is the vocabulary that matters now); ids / group / label / question / layer are read
// generically and extra fields are tolerated, so --taxonomy ./taxonomy-v2.js still works. When the
// chosen taxonomy declares the older ids each item replaces, a draft written against the older
// vocabulary is carried over: events are pre-ticked, presence is left for the reviewer to judge.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseSrt, formatTime } from './srt.js';
import { parseArgs, here } from './common.js';

// ---------------------------------------------------------------- taxonomy

const prettify = (id) => String(id).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// An attribute is an object with an id that also carries a question or a parent group;
// this deliberately excludes a GROUPS array, whose entries are only { id, label }.
const looksAttr = (x) => x && typeof x === 'object' && typeof x.id === 'string' && !!(x.question || x.prompt || x.text || x.group || x.layer);
const isAttrArray = (v) => Array.isArray(v) && v.length && v.every(looksAttr);

function pickAttributes(mod) {
  if (Array.isArray(mod.ATTRIBUTES)) return mod.ATTRIBUTES;
  if (isAttrArray(mod.ALL_ITEMS)) return mod.ALL_ITEMS; // v3: every layer, in layer order
  const candidates = Object.entries(mod).filter(([k]) => !/groups?$/i.test(k));
  for (const [, value] of candidates) if (isAttrArray(value)) return value;
  // A v3 module may export layers: { presence: [...], event: [...] } or a map id -> attribute.
  for (const [, value] of candidates) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const parts = Object.values(value);
    if (parts.length && parts.every(isAttrArray)) {
      return Object.entries(value).flatMap(([layer, list]) => list.map((a) => ({ layer, ...a })));
    }
    if (parts.length && parts.every((x) => x && typeof x === 'object' && !Array.isArray(x) && (x.question || x.label || x.group))) {
      return Object.entries(value).map(([id, a]) => ({ id, ...a }));
    }
  }
  return [];
}

function pickGroups(mod, attributes) {
  const out = new Map();
  const g = mod.GROUPS ?? Object.entries(mod).find(([k]) => /group/i.test(k))?.[1];
  if (Array.isArray(g)) for (const x of g) { if (x && x.id) out.set(x.id, x.label ?? x.title ?? x.name ?? prettify(x.id)); }
  else if (g && typeof g === 'object') for (const [id, label] of Object.entries(g)) out.set(id, typeof label === 'string' ? label : label?.label ?? prettify(id));
  for (const a of attributes) {
    const id = a.group ?? 'other';
    if (!out.has(id)) out.set(id, prettify(id));
  }
  return [...out].map(([id, label]) => ({ id, label }));
}

// The questions are written for the model, with `P` standing for the beat's lines. On this page a
// human reads them, so the placeholder is spelled out. Display only: nothing is sent anywhere.
function humanize(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bIn\s+`?P`?\b/g, 'In these lines')
    .replace(/\bin\s+`?P`?\b/g, 'in these lines')
    .replace(/`P`/g, 'these lines')
    .replace(/(^|[^\w`])P(?=[^\w`]|$)/g, '$1these lines');
}

// A presence question is built as `In P, is <noun> there in the scene?`, and a noun that carries a
// gloss ("a monster: a frightening creature that is not ...") makes it unreadable. Move the gloss out.
function readableQuestion(a) {
  const q = a.question ?? a.prompt ?? a.text ?? '';
  const noun = typeof a.noun === 'string' ? a.noun : '';
  const colon = noun.indexOf(':');
  if (!q || !noun || colon === -1 || !q.includes(noun)) return q;
  return `${q.replace(noun, noun.slice(0, colon).trim())} (${noun.slice(colon + 1).trim()})`;
}

const asList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : typeof v === 'string' ? [v] : []);

async function loadTaxonomy(taxPath) {
  const abs = path.resolve(here, taxPath);
  const mod = await import(pathToFileURL(abs).href);
  const raw = pickAttributes(mod);
  if (!raw.length) throw new Error(`no attributes found in ${abs}`);
  const attributes = raw.map((a) => ({
    id: a.id,
    group: a.group ?? 'other',
    label: a.label ?? a.name ?? a.title ?? prettify(a.id),
    question: humanize(readableQuestion(a)),
    no: humanize(a.no ?? a.boundary ?? ''),
    layer: a.layer ?? a.kind ?? null,
    textBlind: !!(a.textBlind ?? a.text_blind),
    // Ids in an older taxonomy that this item replaces, so a draft written against it can be carried
    // over. NOT `legacy`, which in taxonomy-v2.js points the other way (at v1 category names).
    v2: asList(a.v2 ?? a.replaces ?? a.maps_from),
  }));
  const used = new Set(attributes.map((a) => a.group));
  const groups = pickGroups(mod, attributes).filter((g) => used.has(g.id));
  const layers = [...new Set(attributes.map((a) => a.layer))];

  // A false-boundary repeated across a whole layer (v3's PRESENT_NO, v2/v3's RETOLD) is boilerplate:
  // say it once above the layer instead of 29 times, and keep only each item's own exception.
  const boilerplate = {};
  for (const layer of layers) {
    const inLayer = attributes.filter((a) => a.layer === layer && a.no);
    const counts = new Map();
    for (const a of inLayer) counts.set(a.no, (counts.get(a.no) || 0) + 1);
    const [common, n] = [...counts].sort((x, y) => y[1] - x[1])[0] || [null, 0];
    if (!common || n < 3) continue;
    boilerplate[layer ?? ''] = common;
    for (const a of inLayer) {
      if (a.no === common) a.no = '';
      else if (a.no.startsWith(common)) a.no = a.no.slice(common.length).trim();
    }
  }
  return {
    attributes,
    groups,
    layers,
    boilerplate,
    hasLegacyMap: attributes.some((a) => a.v2.length),
    name: path.basename(abs).replace(/\.m?js$/, ''),
    source: path.relative(here, abs),
  };
}

// ---------------------------------------------------------------- rubric

const RUBRIC = {
  levels: [
    { n: 0, label: 'none', text: 'nothing here for this age band' },
    { n: 1, label: 'mild', text: 'mild and brief' },
    { n: 2, label: 'needs a parent', text: 'sustained fear or sadness a sensitive child would need a parent for' },
    { n: 3, label: 'intense', text: 'intense threat to life, a death, or deep grief' },
  ],
  bands: {
    severity_5_7: 'Ages 5-7: most affected by frightening creatures and looks, the dark, loud sudden events, separation from a parent. NOT reassured by comedy, fantasy, or a later happy ending.',
    severity_8_10: 'Ages 8-10: most affected by what could really happen (death, injury, abduction, guns, harm to family, humiliation). Reassured by comic tone and a quick rescue.',
  },
};

// ---------------------------------------------------------------- page

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const jsonForScript = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .split(LS).join('\\u2028')
  .split(PS).join('\\u2029');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f6f4; --panel: #ffffff; --ink: #16181d; --muted: #666b75; --faint: #9aa0aa;
  --line: #d9dbe0; --line-soft: #ebecef; --accent: #1f5fd0; --accent-ink: #ffffff;
  --scene: #fff8e6; --scene-line: #e0b84a; --control: #eef6ff; --control-line: #5b8fd6;
  --ok: #1d7a44; --changed: #a8620a; --reject: #a32222; --added: #6b2fb5;
  --chip: #eceef2;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a; --panel: #1b1e24; --ink: #e8eaee; --muted: #a2a9b4; --faint: #767d88;
    --line: #333844; --line-soft: #262b33; --accent: #6d9dff; --accent-ink: #0d1016;
    --scene: #2a2415; --scene-line: #b08b2a; --control: #16222f; --control-line: #3f6fa8;
    --ok: #6cd39a; --changed: #f0ad4e; --reject: #ff8080; --added: #c39bf5;
    --chip: #272c35;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
.btn {
  background: var(--panel); color: var(--ink); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 10px;
}
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.primary:disabled { background: var(--chip); color: var(--muted); border-color: var(--line); }
.btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btn.tiny { padding: 1px 6px; font-size: 11px; border-radius: 4px; }
kbd {
  font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--chip);
  border: 1px solid var(--line); border-radius: 3px; padding: 2px 4px;
}
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

/* ---------- shell ---------- */
#app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
header {
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  padding: 6px 10px; background: var(--panel); border-bottom: 1px solid var(--line);
}
header .btn { padding: 4px 8px; }
header h1 { font-size: 15px; margin: 0 8px 0 0; font-weight: 650; }
header .spacer { flex: 1 1 auto; }
#progress { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
#bar { width: 130px; height: 7px; border-radius: 4px; background: var(--chip); overflow: hidden; }
#bar > i { display: block; height: 100%; background: var(--ok); width: 0; }
#warn { width: 100%; color: var(--reject); font-size: 12px; }
main { display: grid; grid-template-columns: minmax(250px, 24%) 1fr; min-height: 0; }

/* ---------- list ---------- */
#list { overflow-y: auto; border-right: 1px solid var(--line); background: var(--panel); }
.row {
  display: block; width: 100%; text-align: left; background: none; border: 0;
  border-bottom: 1px solid var(--line-soft); border-left: 4px solid var(--scene-line);
  padding: 6px 8px;
}
.row.control { border-left-color: var(--control-line); background: color-mix(in srgb, var(--control) 45%, transparent); }
.row[aria-current="true"] { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.row:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); }
.row .r1 { display: flex; gap: 6px; align-items: baseline; font-size: 11px; color: var(--muted); }
.row .r2 { font-size: 13px; margin-top: 1px; line-height: 1.3; }
.row.rejected .r2 { text-decoration: line-through; opacity: .6; }
.sev { margin-left: auto; font-variant-numeric: tabular-nums; }
.st { font-weight: 700; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; }
.st-unreviewed { color: var(--faint); }
.st-confirmed { color: var(--ok); }
.st-changed { color: var(--changed); }
.st-rejected { color: var(--reject); }
.st-added { color: var(--added); }

/* ---------- detail ---------- */
#detail { overflow-y: auto; padding: 12px 16px 60px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.panel > h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 0 0 8px; }
#dhead { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
#dhead .badge { font-size: 11px; border: 1px solid var(--line); border-radius: 999px; padding: 1px 8px; color: var(--muted); }
#titleInput { width: 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
label { display: block; }
.fieldlabel { font-size: 12px; color: var(--muted); margin-bottom: 3px; }

.lines { position: relative; max-height: 46vh; overflow-y: auto; border: 1px solid var(--line-soft); border-radius: 6px; }
.line { display: flex; gap: 8px; align-items: baseline; padding: 2px 6px; border-bottom: 1px solid var(--line-soft); }
.line.ctx { opacity: .45; }
.line.in { background: var(--scene); }
.line.in.ctrl { background: var(--control); }
.line .cid { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--muted); width: 52px; flex: none; }
.line .ct { font-size: 11px; color: var(--muted); width: 62px; flex: none; font-variant-numeric: tabular-nums; }
.line .tx { flex: 1 1 auto; }
/* kept in the tab order (opacity, not visibility) so the boundary buttons are keyboard-reachable */
.line .lb { display: flex; gap: 4px; flex: none; opacity: .35; }
.line:hover .lb, .line:focus-within .lb { opacity: 1; }
.edge { font-size: 10px; color: var(--muted); flex: none; min-width: 34px; text-align: right; }

.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; }
.group > h3 { font-size: 12px; margin: 0 0 4px; }
.attr { display: grid; grid-template-columns: auto 1fr; gap: 0 6px; padding: 3px 0; border-top: 1px solid var(--line-soft); }
.attr .q {
  grid-column: 2; font-size: 11px; color: var(--muted);
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden;
}
body.qfull .attr .q { display: block; }
.attr .vo { grid-column: 2; font-size: 11px; color: var(--muted); display: none; gap: 4px; align-items: center; margin-top: 2px; }
.attr.on .vo { display: flex; }
.attr.on { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.attr .nm { font-size: 13px; }
.attr .blind { grid-column: 2; font-size: 10px; color: var(--faint); }
.attr .implied { grid-column: 2; font-size: 10px; color: var(--changed); }
.layerhead { font-size: 13px; margin: 14px 0 2px; }
.layerhead:first-child { margin-top: 2px; }
.layerrule {
  margin: 0 0 8px; padding: 5px 8px; font-size: 12px; color: var(--muted);
  background: var(--chip); border-radius: 6px;
}

.sevrow { display: flex; gap: 16px; flex-wrap: wrap; }
.sevbox { flex: 1 1 320px; }
.sevopts { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
.sevopts label { display: flex; gap: 6px; align-items: baseline; }
.sevopts .lv { font-size: 12px; color: var(--muted); }
.hint { font-size: 11px; color: var(--muted); }
textarea { width: 100%; min-height: 60px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); resize: vertical; }
.draftbox { font-size: 12px; color: var(--muted); }
.draftbox b { color: var(--ink); }

/* ---------- overlay ---------- */
dialog {
  width: min(1000px, 94vw); height: 86vh; padding: 0; border: 1px solid var(--line);
  border-radius: 10px; background: var(--panel); color: var(--ink);
}
dialog::backdrop { background: rgba(0,0,0,.45); }
.dlg { display: grid; grid-template-rows: auto auto 1fr auto; height: 100%; }
.dlg > .bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.dlg h2 { font-size: 14px; margin: 0; }
#tlist { overflow-y: auto; padding: 0 6px; }
#tlist .line.hit { background: color-mix(in srgb, var(--accent) 22%, transparent); }
#tlist .line.cover { background: var(--scene); }
#tlist .line.cover.ctrl { background: var(--control); }
#tlist .line.selstart { box-shadow: inset 3px 0 0 var(--ok); }
#tlist .line.selend { box-shadow: inset -3px 0 0 var(--reject); }
#tlist .line .lb { opacity: .5; }
#tlist .line:hover .lb, #tlist .line:focus-within .lb { opacity: 1; }
#tlist .owner { font-size: 10px; color: var(--muted); width: 74px; flex: none; }
input[type="search"], input[type="text"] { padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); }
#sumlist { overflow-y: auto; padding: 10px 14px; }
#sumlist li { margin-bottom: 5px; }
@media (max-width: 900px) {
  main { grid-template-columns: minmax(200px, 32%) 1fr; }
  .groups { grid-template-columns: 1fr; }
}
`;

function clientMain() {
  const D = window.__REVIEW__;
  const CUES = D.cues;
  const GOLD = D.gold;
  const ATTRS = D.taxonomy.attributes;
  const GROUPS = D.taxonomy.groups;
  const LAYERS = D.taxonomy.layers && D.taxonomy.layers.length ? D.taxonomy.layers : [null];
  const prettifyClient = (id) => String(id).replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const RUBRIC = D.rubric;
  const ATTR_BY_ID = new Map(ATTRS.map((a) => [a.id, a]));
  const CUE_POS = new Map(CUES.map((c, i) => [c.id, i]));
  // The taxonomy is part of the key: attribute ids from a v2 session must never be loaded into a
  // v3 page, where they would look like leftovers and lose the carry-over mapping.
  const STORE_KEY = 'trigger-review:' + D.film.slug + ':' + D.taxonomy.name + ':' + D.goldHash;
  const EDITABLE = ['title', 'start_cue', 'end_cue', 'attributes', 'visual_only', 'severity_5_7', 'severity_8_10', 'text_visibility'];

  const $ = (sel, root) => (root || document).querySelector(sel);
  const el = (tag, props, kids) => {
    const n = Object.assign(document.createElement(tag), props || {});
    for (const k of kids || []) n.append(k);
    return n;
  };
  const fmt = (ms) => {
    const t = Math.floor(ms / 1000);
    const p = (x) => String(x).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
  };
  const cueAt = (id) => CUES[CUE_POS.get(id)];
  const sameSet = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

  // ---------------- carrying a draft written against an older taxonomy
  // Each item may declare the old ids it replaces (`v2`). Events map straight through and are
  // pre-checked; presence is left for the reviewer to judge, because that unanchored judgement is
  // the point of this pass -- those boxes only get a "draft implied this" hint.
  const MAPS_FROM = new Map(); // old id -> { event: [...ids], presence: [...ids], any: [...ids] }
  for (const a of ATTRS) {
    for (const old of a.v2 || []) {
      const e = MAPS_FROM.get(old) || { event: [], presence: [], any: [] };
      (a.layer === 'presence' ? e.presence : e.event).push(a.id);
      e.any.push(a.id);
      MAPS_FROM.set(old, e);
    }
  }
  const mappedFor = (draftIds, which) => {
    const out = [];
    for (const old of draftIds || []) for (const id of (MAPS_FROM.get(old) || {})[which] || []) out.push(id);
    return [...new Set(out)];
  };
  // Old ids this taxonomy knows nothing about: kept verbatim so the reviewer can see and drop them.
  const unmappedOf = (draftIds) => (draftIds || []).filter((id) => !ATTR_BY_ID.has(id) && !MAPS_FROM.has(id));
  // Presence items the draft implies, shown as a hint only.
  const impliedPresence = (draftIds) => new Set(mappedFor(draftIds, 'presence'));

  function carryOver(draftIds) {
    if (!D.taxonomy.hasLegacyMap) return (draftIds || []).slice();
    const kept = (draftIds || []).filter((id) => ATTR_BY_ID.has(id) && ATTR_BY_ID.get(id).layer !== 'presence');
    return [...new Set([...kept, ...mappedFor(draftIds, 'event'), ...unmappedOf(draftIds)])];
  }

  // ---------------- state
  const fromGold = (g) => ({
    id: g.id,
    origin: 'draft',
    control: !!g.control,
    title: g.title || '',
    start_cue: g.start_cue,
    end_cue: g.end_cue,
    attributes: carryOver(g.attributes),
    visual_only: carryOver(g.visual_only).filter((id) => carryOver(g.attributes).includes(id)),
    severity_5_7: g.severity_5_7 ?? 0,
    severity_8_10: g.severity_8_10 ?? 0,
    text_visibility: g.text_visibility || 'medium',
    decision: null,
    reviewer_note: '',
  });
  const ORIGINAL = new Map(GOLD.map((g) => [g.id, fromGold(g)]));
  const DRAFT = new Map(GOLD.map((g) => [g.id, g]));

  let state = { film: D.film.slug, goldHash: D.goldHash, items: GOLD.map(fromGold), selected: null, savedAt: null };
  let storageOk = true;

  function load() {
    let raw = null;
    try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { storageOk = false; }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (!saved || saved.goldHash !== D.goldHash || !Array.isArray(saved.items)) return;
      const byId = new Map(saved.items.map((i) => [i.id, i]));
      const merged = [];
      for (const g of GOLD) merged.push(Object.assign(fromGold(g), byId.get(g.id) || {}, { origin: 'draft', id: g.id }));
      for (const i of saved.items) if (!DRAFT.has(i.id)) merged.push(Object.assign({ origin: 'added' }, i));
      state.items = merged;
      state.selected = saved.selected || null;
      state.savedAt = saved.savedAt || null;
    } catch (e) { /* corrupt save: start from the draft */ }
  }

  // Written synchronously on every change: a debounce can starve under a burst of edits and lose
  // everything if the tab is closed right after. The payload is small (tens of KB).
  function save() {
    state.savedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      showWarn('Autosave to this browser failed (' + e.name + '). Your work is only in this tab -- export often and do not close it.');
    }
  }
  function showWarn(msg) {
    const w = $('#warn');
    w.textContent = msg;
    w.hidden = false;
  }

  // ---------------- derived
  const byId = (id) => state.items.find((i) => i.id === id);
  const startMs = (i) => (cueAt(i.start_cue) ? cueAt(i.start_cue).s : 0);
  const ordered = () => state.items.slice().sort((a, b) => startMs(a) - startMs(b) || a.id.localeCompare(b.id));

  function changedFields(item) {
    const o = ORIGINAL.get(item.id);
    if (!o) return [];
    const out = [];
    for (const f of EDITABLE) {
      const a = item[f];
      const b = o[f];
      if (Array.isArray(a) ? !sameSet(a, b || []) : a !== b) out.push(f);
    }
    return out;
  }
  function statusOf(item) {
    if (item.decision === 'rejected') return 'rejected';
    if (item.origin === 'added') return 'added';
    if (changedFields(item).length) return 'changed';
    if (item.decision === 'confirmed') return 'confirmed';
    return 'unreviewed';
  }
  const isReviewed = (i) => statusOf(i) !== 'unreviewed';

  // ---------------- list
  function renderList() {
    const list = $('#list');
    list.textContent = '';
    for (const item of ordered()) {
      const st = statusOf(item);
      const s = cueAt(item.start_cue);
      const e = cueAt(item.end_cue);
      const row = el('button', { className: 'row' + (item.control ? ' control' : '') + (st === 'rejected' ? ' rejected' : ''), type: 'button' });
      row.dataset.id = item.id;
      row.setAttribute('aria-current', String(item.id === state.selected));
      const r1 = el('div', { className: 'r1' }, [
        el('span', { className: 'mono', textContent: item.id }),
        el('span', { textContent: (s ? fmt(s.s) : '??') + '-' + (e ? fmt(e.e) : '??') }),
        el('span', { className: 'sev', textContent: item.severity_5_7 + '/' + item.severity_8_10 }),
      ]);
      if (item.control) r1.insertBefore(el('span', { textContent: 'CALM', title: 'calm control range' }), r1.children[1]);
      r1.append(el('span', { className: 'st st-' + st, textContent: st }));
      row.append(r1, el('div', { className: 'r2', textContent: item.title || '(untitled)' }));
      row.addEventListener('click', () => select(item.id));
      list.append(row);
    }
    const cur = $('#list .row[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function renderProgress() {
    const n = state.items.length;
    const done = state.items.filter(isReviewed).length;
    const count = (s) => state.items.filter((i) => statusOf(i) === s).length;
    $('#bar').firstElementChild.style.width = (n ? (done / n) * 100 : 0) + '%';
    $('#ptext').textContent = done + ' / ' + n + ' reviewed · ' + count('confirmed') + ' confirmed, ' + count('changed') + ' changed, ' + count('rejected') + ' rejected, ' + count('added') + ' added';
    $('#saved').textContent = storageOk ? (state.savedAt ? 'saved ' + state.savedAt.slice(11, 19) : '') : 'NOT SAVED';
  }

  const refreshChrome = () => { renderList(); renderProgress(); };

  // ---------------- detail
  function select(id) {
    state.selected = id;
    save();
    renderList();
    renderDetail();
    renderProgress();
  }

  function renderDetail() {
    const host = $('#detail');
    host.textContent = '';
    const item = byId(state.selected);
    if (!item) {
      host.append(el('p', { className: 'hint', textContent: 'Pick a scene on the left (or press j). Keys: j/k move, c confirm, x reject, n add a missed scene, t full transcript.' }));
      return;
    }
    const st = statusOf(item);
    const s = cueAt(item.start_cue);
    const e = cueAt(item.end_cue);

    // header
    const head = el('div', { className: 'panel', id: 'dhead' });
    head.append(
      el('strong', { className: 'mono', textContent: item.id }),
      el('span', { className: 'st st-' + st, id: 'stchip', textContent: st }),
      el('span', { className: 'badge', textContent: item.control ? 'calm control' : 'flagged scene' }),
      el('span', { className: 'badge mono', textContent: (s ? fmt(s.s) : '??') + ' - ' + (e ? fmt(e.e) : '??') + '  (' + item.start_cue + '-' + item.end_cue + ')' }),
    );
    head.append(el('span', { className: 'spacer', style: 'flex:1 1 auto' }));
    const bConfirm = el('button', { className: 'btn primary', type: 'button', textContent: 'Confirm as-is (c)' });
    bConfirm.onclick = () => confirmItem(item);
    const bReject = el('button', { className: 'btn', type: 'button', textContent: st === 'rejected' ? 'Un-reject (x)' : 'Reject: not a real flag (x)' });
    bReject.onclick = () => rejectItem(item);
    head.append(bConfirm, bReject);
    host.append(head);

    // title
    const tp = el('div', { className: 'panel' });
    const tl = el('label', { className: 'fieldlabel', htmlFor: 'titleInput', textContent: 'Title (what a parent would read)' });
    const ti = el('input', { id: 'titleInput', type: 'text', value: item.title });
    ti.addEventListener('input', () => { item.title = ti.value; save(); refreshChrome(); syncChip(item); });
    tp.append(tl, ti);
    host.append(tp);

    // lines
    const lp = el('div', { className: 'panel' });
    lp.append(el('h2', { textContent: 'Subtitle lines (hover a line to move the start or the end)' }));
    lp.append(renderLines(item));
    host.append(lp);

    // attributes
    const ap = el('div', { className: 'panel' });
    const ah = el('h2', { textContent: 'Attributes that truly apply at this moment ' });
    const qt = el('button', { className: 'btn tiny', type: 'button', textContent: document.body.classList.contains('qfull') ? 'hide full questions' : 'show full questions' });
    qt.onclick = () => {
      const full = document.body.classList.toggle('qfull');
      qt.textContent = full ? 'hide full questions' : 'show full questions';
      try { window.localStorage.setItem('trigger-review:qfull', full ? '1' : '0'); } catch (e) { /* ignore */ }
    };
    ah.append(qt);
    ap.append(ah);
    ap.append(renderAttributes(item));
    host.append(ap);

    // severities
    const sp = el('div', { className: 'panel' });
    sp.append(el('h2', { textContent: 'Severity 0-3' }));
    const srow = el('div', { className: 'sevrow' });
    srow.append(sevBox(item, 'severity_5_7', 'Ages 5-7'), sevBox(item, 'severity_8_10', 'Ages 8-10'));
    sp.append(srow);
    host.append(sp);

    // reviewer note + text visibility
    const np = el('div', { className: 'panel' });
    np.append(el('h2', { textContent: 'Your note' }));
    const ta = el('textarea', { id: 'noteInput', value: item.reviewer_note, placeholder: 'Why you changed it, or what you were unsure about.' });
    ta.setAttribute('aria-label', 'Reviewer note');
    ta.addEventListener('input', () => { item.reviewer_note = ta.value; save(); });
    np.append(ta);
    const vl = el('label', { className: 'fieldlabel', htmlFor: 'tvSelect', textContent: 'How visible is this in the subtitle lines?' });
    const vs = el('select', { id: 'tvSelect' });
    for (const v of ['high', 'medium', 'low']) vs.append(el('option', { value: v, textContent: v, selected: item.text_visibility === v }));
    vs.addEventListener('change', () => { item.text_visibility = vs.value; save(); refreshChrome(); syncChip(item); });
    np.append(el('div', { style: 'margin-top:8px' }, [vl, vs]));
    host.append(np);

    // draft, read only
    const draft = DRAFT.get(item.id);
    const dp = el('div', { className: 'panel draftbox' });
    dp.append(el('h2', { textContent: 'What the drafter wrote (read-only)' }));
    if (!draft) dp.append(el('p', { textContent: 'You added this scene; there is no draft to compare with.' }));
    else {
      dp.append(el('p', { textContent: draft.note || '(no note)' }));
      dp.append(el('p', {}, [
        el('b', { textContent: 'text visibility: ' }), document.createTextNode(String(draft.text_visibility || '?') + '  ·  '),
        el('b', { textContent: 'evidence cues: ' }), document.createTextNode((draft.evidence || []).join(', ') || '(none)'),
      ]));
      dp.append(el('p', {}, [
        el('b', { textContent: 'draft attributes (' + (D.taxonomy.hasLegacyMap ? 'older taxonomy' : D.taxonomy.name) + '): ' }),
        document.createTextNode((draft.attributes || []).join(', ') || '(none)' + ''),
        document.createTextNode((draft.visual_only || []).length ? '  ·  visual only: ' + draft.visual_only.join(', ') : ''),
      ]));
      if (D.taxonomy.hasLegacyMap) {
        const events = carryOver(draft.attributes).filter((id) => ATTR_BY_ID.has(id));
        const presence = [...impliedPresence(draft.attributes || [])];
        dp.append(el('p', {}, [
          el('b', { textContent: 'carried over as ' + D.taxonomy.name + ': ' }),
          document.createTextNode('events pre-ticked: ' + (events.join(', ') || '(none)')
            + '  ·  presence left for you to judge: ' + (presence.join(', ') || '(none)')),
        ]));
      }
      dp.append(el('p', { id: 'changedLine' }));
    }
    host.append(dp);
    syncChip(item);
    host.scrollTop = 0;
  }

  // Status chip and the "you changed" line, without re-rendering the whole panel (keeps focus).
  function syncChip(item) {
    const chip = $('#stchip');
    if (chip) {
      const st = statusOf(item);
      chip.className = 'st st-' + st;
      chip.textContent = st;
    }
    const line = $('#changedLine');
    if (line) {
      const cf = changedFields(item);
      line.textContent = cf.length ? 'You changed: ' + cf.join(', ') : 'No changes to the draft yet.';
    }
  }

  function renderLines(item) {
    const box = el('div', { className: 'lines', id: 'linesBox' });
    const a = CUE_POS.get(item.start_cue);
    const b = CUE_POS.get(item.end_cue);
    if (a == null || b == null) {
      box.append(el('p', { className: 'hint', textContent: 'Cue ids not found in this subtitle file.' }));
      return box;
    }
    for (let i = Math.max(0, a - 8); i <= Math.min(CUES.length - 1, b + 8); i++) {
      const inside = i >= a && i <= b;
      box.append(lineRow(CUES[i], { inside, control: item.control, edge: i === a ? 'start' : i === b ? 'end' : '', onSet: (which) => setBoundary(item, which, CUES[i].id) }));
    }
    requestAnimationFrame(() => {
      const first = box.querySelector('.line.in');
      if (first) box.scrollTop = Math.max(0, first.offsetTop - 40);
    });
    return box;
  }

  function lineRow(cue, opts) {
    const row = el('div', { className: 'line' + (opts.inside ? ' in' : ' ctx') + (opts.inside && opts.control ? ' ctrl' : '') });
    row.dataset.cue = cue.id;
    row.append(
      el('span', { className: 'cid', textContent: cue.id }),
      el('span', { className: 'ct', textContent: fmt(cue.s) }),
      el('span', { className: 'tx', textContent: cue.x }),
      el('span', { className: 'edge', textContent: opts.edge }),
    );
    const lb = el('span', { className: 'lb' });
    const bs = el('button', { className: 'btn tiny', type: 'button', textContent: 'start here' });
    bs.setAttribute('aria-label', 'Set scene start at ' + cue.id);
    bs.onclick = () => opts.onSet('start');
    const be = el('button', { className: 'btn tiny', type: 'button', textContent: 'end here' });
    be.setAttribute('aria-label', 'Set scene end at ' + cue.id);
    be.onclick = () => opts.onSet('end');
    lb.append(bs, be);
    row.append(lb);
    if (opts.owner !== undefined) row.insertBefore(el('span', { className: 'owner', textContent: opts.owner || '' }), row.firstChild);
    return row;
  }

  function setBoundary(item, which, cueId) {
    const pos = CUE_POS.get(cueId);
    if (which === 'start') {
      item.start_cue = cueId;
      if (pos > CUE_POS.get(item.end_cue)) item.end_cue = cueId;
    } else {
      item.end_cue = cueId;
      if (pos < CUE_POS.get(item.start_cue)) item.start_cue = cueId;
    }
    save();
    renderDetail();
    refreshChrome();
  }

  const LAYER_HEADS = {
    presence: 'What is on screen',
    event: 'What happens to the characters',
  };
  const LAYER_RULES = {
    presence: 'Tick if it is there in the scene, friendly or not, real or imagined on screen. Do not tick if it is only talked about.',
  };

  function renderAttributes(item) {
    const host = el('div');
    const draftIds = (DRAFT.get(item.id) || {}).attributes || [];
    const implied = impliedPresence(draftIds);
    for (const layer of LAYERS) {
      const inLayer = ATTRS.filter((a) => a.layer === layer);
      if (!inLayer.length) continue;
      const boiler = (D.taxonomy.boilerplate || {})[layer ?? ''];
      if (layer) host.append(el('h3', { className: 'layerhead', textContent: LAYER_HEADS[layer] || prettifyClient(layer) }));
      if (LAYER_RULES[layer] || boiler) {
        const rule = el('p', { className: 'layerrule' });
        if (LAYER_RULES[layer]) rule.append(el('b', { textContent: LAYER_RULES[layer] }));
        if (boiler) rule.append(el('span', { textContent: (LAYER_RULES[layer] ? ' ' : '') + 'Applies to all of these: ' + boiler }));
        host.append(rule);
      }
      host.append(renderGroups(inLayer, item, implied));
    }
    const leftovers = renderLeftovers(item);
    if (leftovers) host.append(leftovers);
    return host;
  }

  function renderGroups(pool, item, implied) {
    const wrap = el('div', { className: 'groups' });
    for (const g of GROUPS) {
      const list = pool.filter((a) => a.group === g.id);
      if (!list.length) continue;
      const gb = el('div', { className: 'group' });
      gb.append(el('h3', { textContent: g.label }));
      for (const a of list) {
        const on = item.attributes.includes(a.id);
        const box = el('div', { className: 'attr' + (on ? ' on' : '') });
        const cb = el('input', { type: 'checkbox', id: 'at-' + a.id, checked: on });
        const lab = el('label', { className: 'nm', htmlFor: 'at-' + a.id, textContent: a.label });
        const vo = el('input', { type: 'checkbox', id: 'vo-' + a.id, checked: item.visual_only.includes(a.id), disabled: !on });
        const voWrap = el('label', { className: 'vo', htmlFor: 'vo-' + a.id }, [vo, el('span', { textContent: 'not visible in the lines' })]);
        cb.addEventListener('change', () => {
          if (cb.checked) item.attributes.push(a.id);
          else {
            item.attributes = item.attributes.filter((x) => x !== a.id);
            item.visual_only = item.visual_only.filter((x) => x !== a.id);
            vo.checked = false;
          }
          vo.disabled = !cb.checked;
          box.classList.toggle('on', cb.checked);
          save();
          refreshChrome();
          syncChip(item);
        });
        vo.addEventListener('change', () => {
          item.visual_only = vo.checked ? [...new Set([...item.visual_only, a.id])] : item.visual_only.filter((x) => x !== a.id);
          save();
          refreshChrome();
          syncChip(item);
        });
        const full = a.question + (a.no ? ' — ' + a.no : '');
        if (full.trim()) box.title = full;
        box.append(cb, lab);
        if (implied.has(a.id)) box.append(el('div', { className: 'implied', textContent: 'draft implied this' }));
        if (a.question) box.append(el('div', { className: 'q', textContent: full }));
        if (a.textBlind) box.append(el('div', { className: 'blind', textContent: 'mostly invisible in subtitles' }));
        box.append(voWrap);
        gb.append(box);
      }
      wrap.append(gb);
    }
    return wrap;
  }

  // Draft ids this taxonomy knows nothing about: kept, and shown so they can be dropped.
  function renderLeftovers(item) {
    const unknown = item.attributes.filter((a) => !ATTR_BY_ID.has(a));
    if (!unknown.length) return null;
    const wrap = el('div', { className: 'groups' });
    {
      const gb = el('div', { className: 'group' });
      gb.append(el('h3', { textContent: 'Not in this taxonomy (from the draft)' }));
      for (const id of unknown) {
        const box = el('div', { className: 'attr on' });
        const cb = el('input', { type: 'checkbox', id: 'at-' + id, checked: true });
        cb.addEventListener('change', () => {
          item.attributes = item.attributes.filter((x) => x !== id);
          item.visual_only = item.visual_only.filter((x) => x !== id);
          save();
          refreshChrome();
          renderDetail();
        });
        box.append(cb, el('label', { className: 'nm', htmlFor: 'at-' + id, textContent: id }));
        gb.append(box);
      }
      wrap.append(gb);
    }
    return wrap;
  }

  function sevBox(item, field, bandLabel) {
    const box = el('div', { className: 'sevbox' });
    box.append(el('div', { className: 'fieldlabel', textContent: bandLabel }));
    const fs = el('div', { className: 'sevopts', role: 'radiogroup' });
    fs.setAttribute('aria-label', bandLabel + ' severity');
    for (const lv of RUBRIC.levels) {
      const id = field + '-' + lv.n;
      const r = el('input', { type: 'radio', name: field, id, value: String(lv.n), checked: item[field] === lv.n });
      r.addEventListener('change', () => { item[field] = lv.n; save(); refreshChrome(); syncChip(item); });
      fs.append(el('label', { htmlFor: id }, [r, el('b', { textContent: String(lv.n) }), el('span', { className: 'lv', textContent: lv.label + ' — ' + lv.text })]));
    }
    box.append(fs, el('div', { className: 'hint', style: 'margin-top:4px', textContent: RUBRIC.bands[field] }));
    return box;
  }

  // ---------------- decisions
  function confirmItem(item) {
    item.decision = item.decision === 'confirmed' ? null : 'confirmed';
    save();
    renderList();
    renderProgress();
    syncChip(item);
    const b = document.querySelectorAll('#dhead .btn')[0];
    if (b) b.textContent = item.decision === 'confirmed' ? 'Confirmed ✓ (c to undo)' : 'Confirm as-is (c)';
  }
  function rejectItem(item) {
    item.decision = item.decision === 'rejected' ? null : 'rejected';
    save();
    renderList();
    renderProgress();
    renderDetail();
  }
  function move(delta) {
    const list = ordered();
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === state.selected);
    const next = i === -1 ? 0 : Math.min(list.length - 1, Math.max(0, i + delta));
    select(list[next].id);
  }

  // ---------------- transcript overlay
  let tSel = { start: null, end: null };
  let tRows = null;

  function openTranscript(forAdd) {
    const dlg = $('#tdlg');
    $('#tmode').textContent = forAdd ? 'Add a missed scene: pick the first and last line.' : 'Full transcript. Already-listed scenes are shaded.';
    if (!tRows) buildTranscript();
    paintTranscript();
    dlg.showModal();
    $('#tsearch').focus();
  }

  function buildTranscript() {
    const host = $('#tlist');
    host.textContent = '';
    tRows = [];
    for (const c of CUES) {
      const row = lineRow(c, { inside: false, owner: '', onSet: (which) => { tSel[which] = c.id; paintTranscript(); } });
      row.classList.remove('ctx');
      host.append(row);
      tRows.push(row);
    }
  }

  function paintTranscript() {
    const cover = new Map();
    for (const item of state.items) {
      if (statusOf(item) === 'rejected') continue;
      const a = CUE_POS.get(item.start_cue);
      const b = CUE_POS.get(item.end_cue);
      if (a == null || b == null) continue;
      for (let i = a; i <= b; i++) cover.set(i, item);
    }
    const sPos = tSel.start != null ? CUE_POS.get(tSel.start) : null;
    const ePos = tSel.end != null ? CUE_POS.get(tSel.end) : null;
    tRows.forEach((row, i) => {
      const owner = cover.get(i);
      row.classList.toggle('cover', !!owner);
      row.classList.toggle('ctrl', !!owner && owner.control);
      row.firstChild.textContent = owner && cover.get(i - 1) !== owner ? owner.id + (owner.control ? ' calm' : '') : '';
      row.classList.toggle('selstart', sPos === i);
      row.classList.toggle('selend', ePos === i);
      row.querySelector('.edge').textContent = sPos === i && ePos === i ? 'start+end' : sPos === i ? 'start' : ePos === i ? 'end' : '';
    });
    $('#tsel').textContent = 'start: ' + (tSel.start || '—') + '   end: ' + (tSel.end || '—');
    const ready = !!(tSel.start && tSel.end && CUE_POS.get(tSel.start) <= CUE_POS.get(tSel.end));
    $('#tcreate').disabled = !ready;
    $('#tcreatec').disabled = !ready;
  }

  function searchTranscript(dir) {
    const q = $('#tsearch').value.trim().toLowerCase();
    if (!q) return;
    const n = CUES.length;
    const from = window.__lastHit == null ? -1 : window.__lastHit;
    for (let k = 1; k <= n; k++) {
      const i = (from + dir * k + n * 2) % n;
      if (CUES[i].x.toLowerCase().includes(q)) {
        if (window.__lastHit != null && tRows[window.__lastHit]) tRows[window.__lastHit].classList.remove('hit');
        window.__lastHit = i;
        tRows[i].classList.add('hit');
        tRows[i].scrollIntoView({ block: 'center' });
        $('#tcount').textContent = CUES.filter((c) => c.x.toLowerCase().includes(q)).length + ' lines match';
        return;
      }
    }
    $('#tcount').textContent = 'no match';
  }

  function nextAddedId() {
    let n = 1;
    while (state.items.some((i) => i.id === 'H' + String(n).padStart(2, '0'))) n++;
    return 'H' + String(n).padStart(2, '0');
  }

  function createScene(control) {
    const item = {
      id: nextAddedId(), origin: 'added', control: !!control, title: '',
      start_cue: tSel.start, end_cue: tSel.end, attributes: [], visual_only: [],
      severity_5_7: 0, severity_8_10: 0, text_visibility: 'medium', decision: null, reviewer_note: '',
    };
    state.items.push(item);
    tSel = { start: null, end: null };
    save();
    $('#tdlg').close();
    select(item.id);
    const t = $('#titleInput');
    if (t) t.focus();
  }

  // ---------------- summary
  function openSummary() {
    const host = $('#sumlist');
    host.textContent = '';
    const ul = el('ul');
    for (const item of ordered()) {
      const st = statusOf(item);
      if (st === 'unreviewed' || st === 'confirmed') continue;
      const cf = changedFields(item);
      ul.append(el('li', {}, [
        el('span', { className: 'st st-' + st, textContent: st + ' ' }),
        el('b', { className: 'mono', textContent: item.id + ' ' }),
        document.createTextNode(item.title || '(untitled)'),
        el('div', { className: 'hint', textContent: (cf.length ? 'changed: ' + cf.join(', ') : '') + (item.reviewer_note ? '  ·  note: ' + item.reviewer_note : '') }),
      ]));
    }
    if (!ul.children.length) ul.append(el('li', { textContent: 'Nothing changed, rejected or added yet.' }));
    const done = state.items.filter(isReviewed).length;
    host.append(el('p', { textContent: done + ' of ' + state.items.length + ' scenes reviewed.' }), ul);
    $('#sdlg').showModal();
  }

  // ---------------- export / import
  function buildExport() {
    const now = new Date().toISOString();
    return ordered().map((item) => {
      const draft = DRAFT.get(item.id);
      const s = cueAt(item.start_cue);
      const e = cueAt(item.end_cue);
      const inRange = (id) => CUE_POS.get(id) >= CUE_POS.get(item.start_cue) && CUE_POS.get(id) <= CUE_POS.get(item.end_cue);
      const st = statusOf(item);
      return {
        id: item.id,
        title: item.title,
        start_cue: item.start_cue,
        end_cue: item.end_cue,
        start: s ? fmt(s.s) : null,
        end: e ? fmt(e.e) : null,
        attributes: item.attributes.slice().sort(),
        visual_only: item.visual_only.slice().sort(),
        severity_5_7: item.severity_5_7,
        severity_8_10: item.severity_8_10,
        control: !!item.control,
        evidence: ((draft && draft.evidence) || []).filter((id) => CUE_POS.has(id) && inRange(id)),
        text_visibility: item.text_visibility,
        note: (draft && draft.note) || '',
        taxonomy: D.taxonomy.name,
        draft_attributes_v2: ((draft && draft.attributes) || []).slice(),
        review: {
          status: st,
          changed_fields: changedFields(item),
          reviewer_note: item.reviewer_note || '',
          reviewed_at: st === 'unreviewed' ? null : now,
        },
      };
    });
  }

  function exportJson() {
    const data = buildExport();
    const text = JSON.stringify(data, null, 2);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = el('a', { href: url, download: D.film.slug + '.json' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      showWarn('Download failed (' + e.message + '). Copy the JSON from the console instead: window.reviewExport()');
    }
    return data;
  }

  function importJson(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const parsed = JSON.parse(String(fr.result));
        const rows = Array.isArray(parsed) ? parsed : parsed.items;
        if (!Array.isArray(rows)) throw new Error('not a list of scenes');
        for (const r of rows) {
          let item = byId(r.id);
          if (!item) {
            item = { id: r.id, origin: 'added', control: !!r.control, title: '', start_cue: r.start_cue, end_cue: r.end_cue, attributes: [], visual_only: [], severity_5_7: 0, severity_8_10: 0, text_visibility: 'medium', decision: null, reviewer_note: '' };
            state.items.push(item);
          }
          item.title = r.title ?? item.title;
          item.start_cue = r.start_cue ?? item.start_cue;
          item.end_cue = r.end_cue ?? item.end_cue;
          // Known ids, plus any draft id this taxonomy lacks (they stay visible and removable).
          const draftIds = ((DRAFT.get(r.id) || {}).attributes) || [];
          item.attributes = (r.attributes || []).filter((a) => ATTR_BY_ID.has(a) || draftIds.includes(a));
          item.visual_only = (r.visual_only || []).filter((a) => item.attributes.includes(a));
          item.severity_5_7 = r.severity_5_7 ?? item.severity_5_7;
          item.severity_8_10 = r.severity_8_10 ?? item.severity_8_10;
          item.text_visibility = r.text_visibility || item.text_visibility;
          item.control = !!r.control;
          const rev = r.review || {};
          item.reviewer_note = rev.reviewer_note || '';
          item.decision = rev.status === 'rejected' ? 'rejected' : rev.status === 'confirmed' ? 'confirmed' : null;
        }
        save();
        refreshChrome();
        renderDetail();
        showWarn('Imported ' + rows.length + ' scenes.');
        setTimeout(() => { $('#warn').hidden = true; }, 4000);
      } catch (e) {
        showWarn('Import failed: ' + e.message);
      }
    };
    fr.readAsText(file);
  }

  // ---------------- wiring
  function init() {
    load();
    try { if (window.localStorage.getItem('trigger-review:qfull') === '1') document.body.classList.add('qfull'); } catch (e) { /* ignore */ }
    if (!state.selected || !byId(state.selected)) state.selected = ordered()[0] ? ordered()[0].id : null;
    if (!storageOk) showWarn('This browser will not let the page save to localStorage. Keep the tab open and export often.');
    $('#bExport').onclick = () => exportJson();
    $('#bImport').onclick = () => $('#fileInput').click();
    $('#fileInput').onchange = (ev) => { if (ev.target.files[0]) importJson(ev.target.files[0]); ev.target.value = ''; };
    $('#bAdd').onclick = () => openTranscript(true);
    $('#bTranscript').onclick = () => openTranscript(false);
    $('#bSummary').onclick = openSummary;
    $('#bReset').onclick = () => {
      if (!window.confirm('Throw away all your corrections and start from the draft again?')) return;
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      state = { film: D.film.slug, goldHash: D.goldHash, items: GOLD.map(fromGold), selected: null, savedAt: null };
      state.selected = ordered()[0] ? ordered()[0].id : null;
      refreshChrome();
      renderDetail();
    };
    $('#tsearch').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); searchTranscript(ev.shiftKey ? -1 : 1); } });
    $('#tnext').onclick = () => searchTranscript(1);
    $('#tprev').onclick = () => searchTranscript(-1);
    $('#tcreate').onclick = () => createScene(false);
    $('#tcreatec').onclick = () => createScene(true);
    for (const b of document.querySelectorAll('[data-close]')) b.onclick = (ev) => ev.target.closest('dialog').close();

    document.addEventListener('keydown', (ev) => {
      const t = ev.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const item = byId(state.selected);
      if (ev.key === 'j' || ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'k' || ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'c' && item) { ev.preventDefault(); confirmItem(item); }
      else if (ev.key === 'x' && item) { ev.preventDefault(); rejectItem(item); }
      else if (ev.key === 'n') { ev.preventDefault(); openTranscript(true); }
      else if (ev.key === 't') { ev.preventDefault(); openTranscript(false); }
    });

    refreshChrome();
    renderDetail();
    window.reviewExport = buildExport;
    window.reviewState = () => state;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

function renderPage(data) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review - ${escapeHtml(data.film.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div id="app">
  <header>
    <h1>${escapeHtml(data.film.title)} <span class="hint">reference scene review</span></h1>
    <div id="progress"><div id="bar"><i></i></div><span id="ptext"></span><span id="saved" class="hint"></span></div>
    <span class="spacer"></span>
    <button class="btn" id="bAdd" type="button">Add missed scene (n)</button>
    <button class="btn" id="bTranscript" type="button">Transcript (t)</button>
    <button class="btn" id="bSummary" type="button">Summary</button>
    <button class="btn" id="bImport" type="button">Import</button>
    <button class="btn primary" id="bExport" type="button">Export JSON</button>
    <button class="btn" id="bReset" type="button" title="Throw away all corrections">Reset</button>
    <input type="file" id="fileInput" accept="application/json,.json" hidden>
    <p id="warn" hidden></p>
  </header>
  <main>
    <div id="list" role="list" aria-label="Scenes in time order"></div>
    <div id="detail"></div>
  </main>
</div>

<dialog id="tdlg" aria-label="Full transcript">
  <div class="dlg">
    <div class="bar">
      <h2 id="tmode"></h2>
      <span class="spacer" style="flex:1 1 auto"></span>
      <button class="btn" type="button" data-close>Close</button>
    </div>
    <div class="bar">
      <label class="fieldlabel" for="tsearch">Search lines</label>
      <input type="search" id="tsearch" placeholder="word or phrase, Enter for next">
      <button class="btn" id="tprev" type="button">Prev</button>
      <button class="btn" id="tnext" type="button">Next</button>
      <span class="hint" id="tcount"></span>
      <span class="spacer" style="flex:1 1 auto"></span>
      <span class="mono hint" id="tsel"></span>
    </div>
    <div id="tlist"></div>
    <div class="bar">
      <span class="hint">Click "start here" on the first line and "end here" on the last line, then:</span>
      <button class="btn primary" id="tcreate" type="button" disabled>Create scene</button>
      <button class="btn" id="tcreatec" type="button" disabled>Create calm control</button>
    </div>
  </div>
</dialog>

<dialog id="sdlg" aria-label="Summary of changes">
  <div class="dlg" style="grid-template-rows:auto 1fr">
    <div class="bar"><h2>What you changed</h2><span class="spacer" style="flex:1 1 auto"></span><button class="btn" type="button" data-close>Close</button></div>
    <div id="sumlist"></div>
  </div>
</dialog>

<script>window.__REVIEW__ = ${jsonForScript(data)};</script>
<script>(${clientMain.toString()})();</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs();
  const slug = args.film;
  if (!slug || slug === true) {
    console.error('usage: node build-review.js --film <slug> [--gold gold/<slug>.json] [--taxonomy ./taxonomy-v3.js]');
    process.exit(1);
  }
  const films = JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8'));
  const film = films[slug];
  if (!film) throw new Error(`unknown film "${slug}" (films.json has: ${Object.keys(films).join(', ')})`);

  const srtPath = path.join(here, 'data', `${slug}.srt`);
  const cues = parseSrt(fs.readFileSync(srtPath, 'utf8'));

  const goldPath = path.resolve(here, typeof args.gold === 'string' ? args.gold : path.join('gold', `${slug}.json`));
  const goldRaw = fs.readFileSync(goldPath, 'utf8');
  const gold = JSON.parse(goldRaw);
  if (!Array.isArray(gold)) throw new Error(`${goldPath} is not an array of scenes`);
  const goldHash = crypto.createHash('sha256').update(goldRaw).digest('hex').slice(0, 16);

  const taxonomy = await loadTaxonomy(typeof args.taxonomy === 'string' ? args.taxonomy : './taxonomy-v3.js');

  const known = new Set(cues.map((c) => c.id));
  const badCues = gold.filter((g) => !known.has(g.start_cue) || !known.has(g.end_cue)).map((g) => g.id);
  const known2 = new Set(taxonomy.attributes.map((a) => a.id));
  const mapsFrom = new Set(taxonomy.attributes.flatMap((a) => a.v2));
  const draftAttrs = [...new Set(gold.flatMap((g) => g.attributes || []))];
  const badAttrs = draftAttrs.filter((a) => !known2.has(a) && !mapsFrom.has(a));
  const carried = draftAttrs.filter((a) => !known2.has(a) && mapsFrom.has(a));
  if (badCues.length) console.warn(`warning: scenes with cue ids missing from the subtitles: ${badCues.join(', ')}`);
  if (badAttrs.length) console.warn(`warning: draft attributes with no counterpart in ${taxonomy.source}: ${badAttrs.join(', ')}`);
  if (carried.length) console.log(`  carried over by the taxonomy's own mapping: ${carried.join(', ')}`);

  const data = {
    film: { slug, title: film.title || slug, year: film.year || null },
    goldFile: path.relative(here, goldPath),
    goldHash,
    builtAt: new Date().toISOString(),
    cues: cues.map((c) => ({ id: c.id, s: c.startMs, e: c.endMs, x: c.text })),
    gold,
    taxonomy,
    rubric: RUBRIC,
  };

  const outDir = path.join(here, 'review');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${slug}.html`);
  fs.writeFileSync(out, renderPage(data));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`wrote ${path.relative(here, out)}  (${kb} KB)`);
  console.log(`  film: ${data.film.title}   cues: ${cues.length}   scenes: ${gold.length} (${gold.filter((g) => g.control).length} calm controls)`);
  console.log(`  gold: ${data.goldFile} sha256:${goldHash}   taxonomy: ${taxonomy.source} (${taxonomy.attributes.length} attributes, ${taxonomy.groups.length} groups)`);
  console.log(`  open: open "${out}"`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
