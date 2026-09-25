// node --test test/  — alias citation gate (cite.js) and the held-out gate (env.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateCastMember, gateAliases } from '../cite.js';
import { freezeStatus, HELD_OUT, DEV_FILMS } from '../env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { nCues: 10, wCount: 3, tCount: 2 };

test('gateAliases: v6 aliases keep valid cites; an uncited alias is dropped; legacy strings pass through', () => {
  const rejected = [];
  const out = gateAliases([{ name: 'Big V', cites: ['L3', 'L99'] }, { name: 'No Cite', cites: [] }, 'Legacy Name', { name: ' ', cites: ['L1'] }], ctx, rejected);
  assert.deepEqual(out, [{ name: 'Big V', cites: ['L3'] }, 'Legacy Name']);
  assert.deepEqual(rejected.map((r) => r.why), ['unknown', 'uncited_alias_dropped']);
  const g = gateCastMember({ name: 'Vera', tmdb: 'T1', aliases: [{ name: 'Big V', cites: ['L3'] }], kind: 'person', is_child: 'false', looks_frightening: 'unknown', disposition: 'villain', disposition_note: 'x', group: 'hostility', cites: { name: [], kind: ['L1'], is_child: ['L2'], looks_frightening: [], disposition: ['W1'] } }, ctx);
  assert.deepEqual(g.member.aliases, [{ name: 'Big V', cites: ['L3'] }]);
});

test('held-out gate (v10): the 13 seen films are dev; every other slug needs --final-held-out-run and an intact out10/freeze.json', () => {
  assert.deepEqual([...DEV_FILMS].sort(), ['book-of-life', 'coco', 'frankenweenie', 'how-to-train-your-dragon', 'iron-giant', 'lion-king', 'moana', 'monsters-inc', 'nemo', 'princess-and-the-frog', 'tangled', 'up', 'wild-robot']);
  for (const s of DEV_FILMS) assert.equal(HELD_OUT.has(s), false);
  assert.equal(HELD_OUT.has('some-new-film'), true);
  const run = (slug, args) => spawnSync(process.execPath, ['--input-type=module', '-e', `import { heldOutGate } from '../env.js'; heldOutGate(${JSON.stringify(slug)}, ${JSON.stringify(args)}); console.log('allowed');`], { cwd: here, encoding: 'utf8' });
  assert.equal(run('nemo', []).stdout.trim(), 'allowed');
  assert.equal(run('wild-robot', []).stdout.trim(), 'allowed');
  assert.equal(run('iron-giant', []).stdout.trim(), 'allowed');
  assert.equal(run('some-new-film', []).status, 2);
  const st = freezeStatus();
  const r = run('some-new-film', ['--final-held-out-run']);
  if (st.ok) assert.equal(r.stdout.trim(), 'allowed'); else assert.equal(r.status, 2, 'no intact freeze: refused');
});
