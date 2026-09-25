#!/usr/bin/env node
// Writes synthetic-film.srt: an INVENTED subtitle track (no film's words) for the Jev-first tests, so the
// orchestration, demo, rebuild and money tests run on any checkout. Deterministic: the same file every run.
//   node test/fixtures/make-synthetic-srt.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WHO = ['Arlo', 'Spot', 'Momma', 'Poppa', 'Buck', 'Libby', 'the ranger', 'the old bird'];
const DO = ['walks toward', 'calls out across', 'looks back at', 'points at', 'climbs over', 'waits beside', 'runs past', 'listens near'];
const WHAT = ['the river', 'the tall fence', 'the corn silo', 'the red rocks', 'the dark woods', 'the muddy bank', 'the storm clouds', 'the far hill'];
const SAY = ['Hurry up, we need to go.', 'Did you hear that?', 'Stay close to me.', 'I think it went this way.', 'Look over there!', 'We should rest here.', 'It is getting late.', 'Keep your head down.'];
const SOUND = ['[wind howling]', '[thunder rumbling]', '[birds chirping]', '[water rushing]'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (ms) => `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
const N = 900;
const out = [];
for (let i = 0; i < N; i++) {
  const start = 60_000 + i * 6_000;
  const end = start + 2_500;
  const k = (i * 7 + 3) % 8;
  const text = i % 23 === 11 ? SOUND[i % SOUND.length]
    : i % 3 === 0 ? `${WHO[i % 8]} ${DO[k]} ${WHAT[(i * 3) % 8]} (${i + 1}).`
      : `${SAY[(i + k) % 8]} Number ${i + 1}.`;
  out.push(`${i + 1}\n${stamp(start)} --> ${stamp(end)}\n${text}\n`);
}
fs.writeFileSync(path.join(here, 'synthetic-film.srt'), out.join('\n'));
console.error(`wrote synthetic-film.srt (${N} cues)`);
