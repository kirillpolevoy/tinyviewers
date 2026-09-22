// COPY of experiments/trigger-scan/srt.js as of commit 5fe8fb5, byte for byte below this line.
// The experiment keeps its own copy as the historical record; see pipeline/README.md.
// SRT parsing and windowing. Pure code: every timestamp in the experiment comes from here,
// never from a model.

const TIME_RE = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

const toMs = (h, m, s, ms) => ((+h * 60 + +m) * 60 + +s) * 1000 + +ms;

export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export const cueId = (index) => `C${String(index).padStart(4, '0')}`;

function cleanText(lines) {
  return lines
    .join(' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns [{ id, index, startMs, endMs, text }] in file order. Cues with no text are dropped.
export function parseSrt(raw) {
  const blocks = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeLine = lines.findIndex((l) => TIME_RE.test(l));
    if (timeLine === -1) continue;
    const m = lines[timeLine].match(TIME_RE);
    const text = cleanText(lines.slice(timeLine + 1));
    if (!text) continue;
    cues.push({
      startMs: toMs(m[1], m[2], m[3], m[4]),
      endMs: toMs(m[5], m[6], m[7], m[8]),
      text,
    });
  }
  cues.sort((a, b) => a.startMs - b.startMs);
  return cues.map((c, i) => ({ id: cueId(i + 1), index: i + 1, ...c }));
}

// Splits cues into consecutive windows. A window closes at the first dialogue gap >= gapMs once it
// is at least minMs long, and is force-closed at maxMs. Every cue lands in exactly one window.
export function buildWindows(cues, { minMs = 60_000, maxMs = 120_000, gapMs = 3_000 } = {}) {
  const windows = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    windows.push({
      id: `W${String(windows.length + 1).padStart(3, '0')}`,
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      cues: current,
    });
    current = [];
  };
  for (const cue of cues) {
    if (current.length) {
      const span = cue.endMs - current[0].startMs;
      const gap = cue.startMs - current[current.length - 1].endMs;
      const long = current[current.length - 1].endMs - current[0].startMs >= minMs;
      if (span > maxMs || (long && gap >= gapMs)) flush();
    }
    current.push(cue);
  }
  flush();
  // A short tail (e.g. a stray credits line) is folded into the previous window.
  const last = windows[windows.length - 1];
  if (windows.length > 1 && last.endMs - last.startMs < 20_000) {
    const prev = windows[windows.length - 2];
    prev.cues = [...prev.cues, ...last.cues];
    prev.endMs = last.endMs;
    windows.pop();
  }
  return windows;
}

export const windowText = (w) => w.cues.map((c) => `${c.id} [${formatTime(c.startMs)}] ${c.text}`).join('\n');
