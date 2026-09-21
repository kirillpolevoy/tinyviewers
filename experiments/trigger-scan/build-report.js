// Builds a self-contained report.html from results.json. Optional findings.html is inlined at the top.
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORIES } from './taxonomy.js';
import { here, loadTrack } from './common.js';

const results = JSON.parse(fs.readFileSync(path.join(here, 'results.json'), 'utf8'));
const findingsFile = path.join(here, 'findings.html');
const findings = fs.existsSync(findingsFile) ? fs.readFileSync(findingsFile, 'utf8') : '';

// Only the cue lines the report quotes (gold evidence, model evidence, peak lines) are embedded.
const cueById = new Map(loadTrack('sdh').cues.map((c) => [c.id, c.text]));
const quoted = new Set();
for (const g of results.gold) (g.evidence ?? []).forEach((id) => quoted.add(id));
for (const a of results.arms) for (const s of a.runs[0].scenes) [...(s.evidence ?? []), s.peakCue].filter(Boolean).forEach((id) => quoted.add(id));
const cueText = Object.fromEntries([...quoted].filter((id) => cueById.has(id)).map((id) => [id, cueById.get(id)]));

const data = { results, cueText, categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) };

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jev vs Claude: Finding Nemo</title>
<style>
  :root {
    --surface: #fcfcfb; --surface-2: #f3f2ef; --border: #dddcd6;
    --text: #0b0b0b; --text-2: #52514e; --text-3: #7a7973;
    --sev-1: #86b6ef; --sev-2: #2a78d6; --sev-3: #104281; --control: #b9b8b1;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface: #1a1a19; --surface-2: #252523; --border: #3a3a37;
      --text: #ffffff; --text-2: #c3c2b7; --text-3: #918f86;
      --sev-1: #184f95; --sev-2: #3987e5; --sev-3: #9ec5f4; --control: #5c5b55;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--surface); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 40px 0 8px; }
  p, li { color: var(--text-2); max-width: 78ch; }
  .meta { color: var(--text-3); font-size: 13px; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { padding: 6px 10px; border-bottom: 1px solid var(--border); text-align: right; white-space: nowrap; }
  th { color: var(--text-2); font-weight: 600; }
  th:first-child, td:first-child { text-align: left; }
  td.wrap { white-space: normal; text-align: left; min-width: 220px; }
  .timeline { margin-top: 12px; min-width: 760px; }
  .lane { display: grid; grid-template-columns: 210px 1fr; align-items: center; gap: 8px; margin: 3px 0; }
  .lane-label { font-size: 12px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lane-label b { color: var(--text); font-weight: 600; }
  .track { position: relative; height: 22px; background: var(--surface-2); border-radius: 4px; }
  .block { position: absolute; top: 2px; bottom: 2px; min-width: 3px; border-radius: 3px; border: 0; padding: 0; cursor: pointer; box-shadow: 0 0 0 1px var(--surface); }
  .block:hover, .block.active { outline: 2px solid var(--text); outline-offset: 1px; z-index: 2; }
  .sev-1 { background: var(--sev-1); } .sev-2 { background: var(--sev-2); } .sev-3 { background: var(--sev-3); }
  .control { background: transparent; border: 1.5px dashed var(--control); box-shadow: none; }
  .axis { position: relative; height: 18px; font-size: 11px; color: var(--text-3); }
  .axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: var(--text-2); margin: 8px 0; }
  .legend i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  #detail { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 6px; min-height: 84px; font-size: 13px; color: var(--text-2); }
  #detail b { color: var(--text); }
  .chip { display: inline-block; padding: 1px 7px; margin: 2px 4px 2px 0; border: 1px solid var(--border); border-radius: 10px; font-size: 12px; }
  .quote { display: block; margin-top: 4px; color: var(--text-3); }
</style>
</head>
<body>
<main>
  <h1>Jev vs Claude: trigger scenes in Finding Nemo</h1>
  <div class="meta" id="meta"></div>
  ${findings}
  <h2>Timeline</h2>
  <p>Top lane is the reference list; dashed boxes are calm control stretches where nothing should be flagged. Each lane below is one analyzer (first run). Darker means more severe for a 5-year-old. Click a block for details.</p>
  <div class="legend"><span><i class="sev-1"></i>1 mild</span><span><i class="sev-2"></i>2 moderate</span><span><i class="sev-3"></i>3 strong</span><span><i class="control"></i>calm control</span></div>
  <div class="scroll"><div class="timeline" id="timeline"></div></div>
  <div id="detail">Click a block to see what was flagged and why.</div>

  <h2>Scores against the reference list</h2>
  <p>Averages over the runs of each analyzer. "Scenes found" counts a reference scene as found when any flagged scene overlaps it (within 15 s). "Flagged minutes" is how much of the 93-minute film the analyzer marks; "on target" is the share of that time inside reference scenes. "Label" columns check the categories, excluding the two caption-inferred categories. "Same twice" is how much of the flagged time two identical runs agree on.</p>
  <div class="scroll"><table id="summary"></table></div>

  <h2>Jev: sensitivity sweep</h2>
  <p>Jev returns a probability per category, so sensitivity is a setting in code. These rows reuse the same stored answers; no new API calls.</p>
  <div class="scroll"><table id="sweep"></table></div>

  <h2>Jev on each reference scene</h2>
  <p>Highest probability Jev gave each expected category in the windows covering the scene. Low numbers on a scene with low text visibility mean the subtitles do not show it, not that Jev misread them.</p>
  <div class="scroll"><table id="jevgold"></table></div>

  <h2>Per-category results</h2>
  <div class="scroll"><table id="percat"></table></div>
</main>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const { results, cueText, categories } = JSON.parse(document.getElementById('data').textContent);
const end = results.movieEndMs;
const fmt = (ms) => { const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':'); };
const pct = (x) => x == null ? '–' : Math.round(x * 100) + '%';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sevClass = (s) => 'sev-' + Math.min(3, Math.max(1, Math.round(s)));
const el = (tag, props = {}, html = '') => { const n = Object.assign(document.createElement(tag), props); if (html) n.innerHTML = html; return n; };

document.getElementById('meta').textContent = 'Generated ' + results.generatedAt.slice(0, 16).replace('T', ' ') + ' UTC · subtitles only · timeline = hearing-impaired Blu-ray track · ' + results.gold.filter((g) => !g.control).length + ' reference scenes';

// ---- timeline ----
const timeline = document.getElementById('timeline');
const detail = document.getElementById('detail');
function showDetail(btn, title, s) {
  document.querySelectorAll('.block.active').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  const chips = (s.categories ?? []).map((id) => '<span class="chip">' + esc(categories[id] ?? id) + (s.probabilities ? ' ' + s.probabilities[id].toFixed(2) : '') + '</span>').join('');
  const quotes = [...(s.evidence ?? []), s.peakCue].filter((id) => cueText[id]).map((id) => '<span class="quote">' + id + ': “' + esc(cueText[id]) + '”</span>').join('');
  detail.innerHTML = '<b>' + esc(title) + '</b> · ' + fmt(s.startMs) + '–' + fmt(s.endMs) + (s.control ? ' · calm control' : ' · severity ' + (+s.severity).toFixed(s.probabilities ? 2 : 0)) + '<br>' + chips + (s.description || s.note ? '<span class="quote">' + esc(s.description || s.note) + '</span>' : '') + quotes;
}
function lane(labelHtml, scenes, titleOf) {
  const row = el('div', { className: 'lane' });
  row.append(el('div', { className: 'lane-label', title: labelHtml.replace(/<[^>]+>/g, '') }, labelHtml));
  const track = el('div', { className: 'track' });
  for (const s of scenes) {
    const b = el('button', { className: 'block ' + (s.control ? 'control' : sevClass(s.severity)), title: titleOf(s) + ' ' + fmt(s.startMs) });
    b.style.left = (s.startMs / end * 100) + '%';
    b.style.width = ((s.endMs - s.startMs) / end * 100) + '%';
    b.addEventListener('click', () => showDetail(b, titleOf(s), s));
    track.append(b);
  }
  row.append(track);
  timeline.append(row);
}
lane('<b>Reference list</b>', results.gold, (g) => g.id + ' ' + g.title);
for (const a of results.arms) lane('<b>' + esc(a.arm) + '</b> · ' + a.track, a.runs[0].scenes, (s) => s.title || a.arm + ' scene');
const axisRow = el('div', { className: 'lane' });
axisRow.append(el('div'));
const axis = el('div', { className: 'axis' });
for (let m = 0; m * 60000 <= end; m += 10) { const t = el('span', {}, m + ' min'); t.style.left = (m * 60000 / end * 100) + '%'; if (m * 60000 / end > 0.95) t.style.transform = 'translateX(-100%)'; axis.append(t); }
axisRow.append(axis);
timeline.append(axisRow);

// ---- tables ----
function table(id, head, rows) {
  document.getElementById(id).innerHTML = '<thead><tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c, i) => '<td' + (String(c).length > 40 ? ' class="wrap"' : '') + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>';
}
table('summary', ['Analyzer', 'Track', 'Scenes found', 'Serious found', 'Flagged min', 'Calm controls flagged', 'Label precision', 'Label recall', 'Cost / movie', 'Time', 'Same twice', 'Scenes flagged', 'Flags that hit a scene', 'On target', 'Label F1', 'Severity error'],
  results.arms.map((a) => { const s = a.summary; return [esc(a.arm), a.track, pct(s.sceneRecall), pct(s.seriousRecall), s.flaggedMin.toFixed(1), s.controlsHit + ' of 6', pct(s.categoryPrecision), pct(s.categoryRecall), '$' + a.costUsd.toFixed(3), (a.wallMs / 1000).toFixed(0) + ' s', pct(a.stability), a.runs[0].score.sceneCount, pct(s.scenePrecision), pct(s.timePrecision), pct(s.categoryF1), s.severityMae.toFixed(2)]; }));
table('sweep', ['Min severity', 'Probability threshold', 'Scenes flagged', 'Scenes found', 'Flags that hit a scene', 'Flagged minutes', 'Category precision', 'Category recall', 'Category F1', 'Calm controls flagged'],
  (results.jevSweep ?? []).map((r) => [r.minSeverity.toFixed(1), r.threshold.toFixed(1), r.scenes, pct(r.sceneRecall), pct(r.scenePrecision), r.flaggedMin.toFixed(1), pct(r.categoryPrecision), pct(r.categoryRecall), pct(r.categoryF1), r.controlsHit]));
const probs = (o) => Object.entries(o).map(([id, p]) => '<span class="chip">' + esc(categories[id]) + ' ' + p.toFixed(2) + '</span>').join('') || '–';
table('jevgold', ['Scene', 'Text visibility', 'Jev severity (0–3)', 'Expected categories', 'Also flagged'],
  (results.jevOnGold ?? []).map((r) => [esc(r.gold + ' ' + r.title), r.textVisibility ?? '–', r.maxSeverity.toFixed(2), probs(r.expected), probs(r.unexpected)]));
const firstRuns = results.arms.map((a) => a.runs[0]);
table('percat', ['Category (found / missed / wrong)', ...results.arms.map((a) => esc(a.arm) + ' · ' + a.track)],
  Object.entries(categories).map(([id, label]) => [esc(label), ...firstRuns.map((r) => { const c = r.score.perCategory[id]; return c.tp + ' / ' + c.fn + ' / ' + c.fp; })]));
</script>
</body>
</html>`;

fs.writeFileSync(path.join(here, 'report.html'), html);
console.log('wrote report.html', (html.length / 1024).toFixed(0) + ' KB');
