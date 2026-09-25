// v8: the independent (non-Claude, non-Jev) labeller for DEV calibration only: Codex CLI, read-only,
// ephemeral, run from v8/labels/ (git-ignored) with the prompt and schema written to labels/codex/
// first and its raw answer and event log saved next to them. Copied from refs/codex.js (same flags:
// codex exec --ignore-user-config -m gpt-6-astra -c model_reasoning_effort="high" --sandbox read-only
// --ephemeral). Never used by the pipeline or on held-out films.
//
// Billing: this Codex CLI is logged in with a ChatGPT plan, so a call has no per-token charge. Every
// call still reserves a worst-case token budget in labels/ledger.jsonl BEFORE it runs and records the
// actual token usage afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LABEL_DIR = path.join(here, 'labels');
export const CODEX_DIR = path.join(LABEL_DIR, 'codex');
const LEDGER = path.join(LABEL_DIR, 'ledger.jsonl');
export const MODEL = 'gpt-6-astra';

const ledger = (entry) => fs.appendFileSync(LEDGER, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

export async function runCodex(name, prompt, schema, { maxOutputTokens = 60_000, timeoutMs = 1_800_000 } = {}) {
  fs.mkdirSync(CODEX_DIR, { recursive: true });
  const promptPath = path.join(CODEX_DIR, `${name}.prompt.txt`);
  const schemaPath = path.join(CODEX_DIR, `${name}.schema.json`);
  const answerPath = path.join(CODEX_DIR, `${name}.answer.json`);
  const eventsPath = path.join(CODEX_DIR, `${name}.events.jsonl`);
  if (fs.existsSync(answerPath)) return { answer: JSON.parse(fs.readFileSync(answerPath, 'utf8')), usage: null, commands: [], cached: true };
  fs.writeFileSync(promptPath, prompt);
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  const estInput = Math.ceil(prompt.length / 2.5) + 25_000;
  ledger({ kind: 'reserve', call: name, model: MODEL, reserved_input_tokens: estInput, reserved_output_tokens: maxOutputTokens, billing: 'chatgpt-plan (no per-token charge)', reserved_usd: 0 });
  const args = ['exec', '--ignore-user-config', '-m', MODEL, '-c', 'model_reasoning_effort="high"',
    '--sandbox', 'read-only', '--ephemeral', '-C', CODEX_DIR, '--skip-git-repo-check', '--json', '--output-schema', schemaPath, '-o', answerPath, '-'];
  const started = Date.now();
  const { code, stdout, stderr } = await new Promise((resolve) => {
    const p = spawn('codex', args, { cwd: CODEX_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    const timer = setTimeout(() => p.kill('SIGTERM'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (c) => { clearTimeout(timer); resolve({ code: c, stdout: out, stderr: err }); });
    p.stdin.end(prompt);
  });
  fs.writeFileSync(eventsPath, stdout);
  const events = stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const usage = events.filter((e) => e.type === 'turn.completed').reduce((acc, e) => { for (const [k, v] of Object.entries(e.usage ?? {})) acc[k] = (acc[k] ?? 0) + v; return acc; }, {});
  const commands = events.filter((e) => e.item?.type === 'command_execution').map((e) => e.item.command);
  ledger({ kind: 'actual', call: name, model: MODEL, exit: code, seconds: Math.round((Date.now() - started) / 1000), usage, commands: [...new Set(commands)], usd: 0 });
  if (code !== 0 || !fs.existsSync(answerPath)) throw new Error(`codex ${name} failed (exit ${code}): ${stderr.slice(-800)}`);
  return { answer: JSON.parse(fs.readFileSync(answerPath, 'utf8')), usage, commands };
}

export const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
