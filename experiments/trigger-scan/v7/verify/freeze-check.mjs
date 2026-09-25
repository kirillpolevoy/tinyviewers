import fs from 'fs'; import crypto from 'crypto'; import path from 'path';
const fz = JSON.parse(fs.readFileSync('out/freeze.json','utf8'));
const frozenAt = new Date(fz.frozen_at);
let bad=0;
for (const [f,h] of Object.entries(fz.files)) {
  const buf = fs.readFileSync(f); const got = crypto.createHash('sha256').update(buf).digest('hex');
  const st = fs.statSync(f);
  const ok = got===h; if(!ok) bad++;
  console.log((ok?'OK  ':'BAD ')+f.padEnd(20), st.mtime.toISOString(), st.mtime>frozenAt?'MODIFIED-AFTER-FREEZE':'');
}
console.log('frozen_at', fz.frozen_at, 'mismatches', bad);
// held-out output timestamps
for (const s of ['iron-giant','up']) {
  const fs_ = fs.readdirSync('out').filter(x=>x.startsWith(s+'.'));
  const t = fs_.map(x=>[x, fs.statSync('out/'+x).mtime.toISOString()]).sort((a,b)=>a[1]<b[1]?-1:1);
  console.log(s, 'earliest', t[0], 'latest', t.at(-1));
}
