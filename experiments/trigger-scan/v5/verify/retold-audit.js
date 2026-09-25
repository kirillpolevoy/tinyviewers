// Verifier helper (no model calls): scenes where a modifier cancellation removed the only flag reasons.
import fs from 'node:fs';
const policy = JSON.parse(fs.readFileSync(new URL('../policy.json', import.meta.url)));
const strong = new Set(policy.flag.strong_events);
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const t = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.tags.r1.json`, import.meta.url)));
  const rows = [];
  let byRetold = 0, byComic = 0;
  for (const s of t.scenes) {
    const lost = (s.cancelled || []).filter((c) => c.level === 'act' && (strong.has(c.id) || c.film_specific && /_(threatens|in_danger|endangers)$/.test(c.id)));
    if (!lost.length) continue;
    if (lost.some((c) => c.by.includes('retold'))) byRetold++;
    if (lost.some((c) => c.by.includes('comic'))) byComic++;
    rows.push(`${s.id}${s.flagged ? '(still flagged)' : ' UNFLAGGED'} lost ${lost.map((c) => `${c.id}:${c.p}<${c.by}`).join(',')} retold_p ${s.modifiers.retold.p} absent ${s.modifiers.retold.danger_absent}`);
  }
  console.log(`== ${slug}: ${rows.length} scenes lost an act-level flag reason to a modifier (retold ${byRetold}, comic ${byComic}); unflagged because of it: ${rows.filter((r) => r.includes('UNFLAGGED')).length}`);
  for (const r of rows) console.log('  ' + r);
}
