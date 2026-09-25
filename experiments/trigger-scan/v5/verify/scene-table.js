// Verifier helper: one line per v5 scene (no subtitle text): flag, reasons, cancelled, modifiers, skip.
import fs from 'node:fs';
const slug = process.argv[2];
const t = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.tags.r1.json`, import.meta.url)));
const m = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.moments.r1.json`, import.meta.url))).scenes;
const seg = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.segments.json`, import.meta.url)));
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
for (const s of t.scenes) {
  const sg = seg.scenes.find((x) => x.id === s.id);
  const mm = m[s.id];
  const act = (s.tags || []).filter((x) => x.level === 'act').map((x) => `${x.id}:${x.p}`).join(' ');
  console.log(`${s.id} ${fmt(s.start_ms)}-${fmt(s.end_ms)} ${s.flagged ? 'FLAG' : '    '} sev${s.severity?.['5-7']}/${s.severity?.['8-10']} R[${(s.flag_reasons || []).map((r) => r.id).join(',')}] X[${(s.cancelled || []).filter((c) => c.level === 'act').map((c) => c.id + '<' + c.by).join(',')}] mod[${s.modifiers?.retold?.on ? 'RET ' : ''}${s.modifiers?.comic?.on ? 'COM ' : ''}${s.modifiers?.imagined?.on ? 'IMG' : ''}] ${mm ? `skip ${mm.method} ${Math.round(mm.skip_ms / 1000)}/${Math.round(mm.scene_ms / 1000)}s` : ''} | ${sg?.title ?? ''} | act: ${act}`);
}
