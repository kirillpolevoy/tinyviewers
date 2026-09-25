// Runs Astra (Codex CLI, gpt-6-astra, ultra, read-only, ephemeral) on astra.prompt.txt.
// Reserves a worst-case budget in ledger.jsonl BEFORE the call (ChatGPT plan: no per-token charge)
// and records actual usage after. Saves raw answer + event log; validates the JSON.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const D = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(D, '..', '..');
const prompt = fs.readFileSync(path.join(D, 'astra.prompt.txt'), 'utf8');
const row = { type: 'object', additionalProperties: false,
  required: ['id', 'replaces', 'owner', 'question', 'yes_criteria', 'no_criteria', 'group', 'flag_use', 'rationale'],
  properties: { id: { type: 'string' }, replaces: { type: 'string' }, owner: { type: 'string', enum: ['jev', 'sonnet', 'drop'] },
    question: { type: 'string' }, yes_criteria: { type: 'string' }, no_criteria: { type: 'string' }, group: { type: 'string' },
    flag_use: { type: 'string' }, rationale: { type: 'string' } } };
const schema = { type: 'object', additionalProperties: false, required: ['summary', 'questions'],
  properties: { summary: { type: 'string' }, questions: { type: 'array', items: row } } };
const schemaPath = path.join(D, 'astra.schema.json');
fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
const answer = path.join(D, 'astra.raw-answer.json');
const events = path.join(D, 'astra.events.jsonl');
const ledger = (e) => fs.appendFileSync(path.join(D, 'ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
ledger({ kind: 'reserve', call: 'astra-distill', model: 'gpt-6-astra', effort: 'ultra', reserved_input_tokens: 2_000_000, reserved_output_tokens: 200_000, billing: 'chatgpt-plan (no per-token charge)', reserved_usd: 0 });
const args = ['exec', '--ignore-user-config', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="ultra"', '--sandbox', 'read-only',
  '--ephemeral', '-C', ROOT, '--json', '--output-schema', schemaPath, '-o', answer, '-'];
const t0 = Date.now();
const p = spawn('codex', args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
const out = fs.createWriteStream(events); let err = '';
p.stdout.pipe(out); p.stderr.on('data', (d) => { err += d; });
p.stdin.end(prompt);
p.on('close', (code) => {
  out.end();
  const ev = fs.readFileSync(events, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const usage = ev.filter((e) => e.type === 'turn.completed').reduce((a, e) => { for (const [k, v] of Object.entries(e.usage ?? {})) a[k] = (a[k] ?? 0) + v; return a; }, {});
  ledger({ kind: 'actual', call: 'astra-distill', exit: code, seconds: Math.round((Date.now() - t0) / 1000), usage, usd: 0 });
  fs.writeFileSync(path.join(D, 'astra.stderr.txt'), err.slice(-5000));
  console.log('exit', code, 'seconds', Math.round((Date.now() - t0) / 1000), JSON.stringify(usage));
});
