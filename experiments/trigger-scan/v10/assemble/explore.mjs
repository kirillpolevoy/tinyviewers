import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('../jevfirst/tournament/results.json','utf8'));
const cands = new Map(r.all_candidates.map(c=>[c.id,c]));
const wilson=(k,n,z=1.96)=>{if(!n)return -1;const p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return (c-m)/d;};
const pct=x=>x==null?'-':Math.round(x*100)+'%';
for (const row of r.rows) {
  const son = row.sonnet?.at; const sonM = son && son.fires>=4;
  let tier, pick;
  if (row.owner==='jev') { tier='A-pass'; pick={id:row.best.id,t:row.best.t,all:row.best.all,magic:row.best.magic}; }
  else if (sonM) { if (row.jev_vs_sonnet_tie) {tier='B-tie'; pick=row.jev_vs_sonnet_tie;} else {tier='S-sonnet';} }
  else {
    tier = row.sonnet? 'C-thin':'C-never';
    const ref = row.v9_ids.length? `V:${row.v9_ids[row.v9_ids.length-1]}` : `V:${row.concept}`;
    const refId = row.concept==='appears_suddenly'?'V:jump_scare':ref;
    const refc = cands.get(refId); const rr = refc?.res['0.7'].all;
    const opts=[];
    for (const c of r.all_candidates.filter(c=>c.concept===row.concept)) for (const t of ['0.6','0.7','0.8']) { if(!c.res[t]) continue; const a=c.res[t].all; if (a.fires<4) continue; if (rr && a.recall < rr.recall-0.05) continue; opts.push({id:c.id,t:+t,all:a,magic:c.res[t].magic,w:wilson(a.hits,a.fires)}); }
    opts.sort((a,b)=>b.w-a.w||b.all.recall-a.all.recall);
    pick=opts[0] ?? (refc ? {id:refId,t:0.7,all:refc.res["0.7"].all,magic:refc.res["0.7"].magic,fallback:true} : null); if(pick) pick.ref = `${refId}@0.7 ${rr?`${rr.hits}/${rr.fires} R${pct(rr.recall)}`:'none'}`;
  }
  console.log(`${row.concept.padEnd(22)} ${tier.padEnd(9)} ${pick?`${pick.id}@${pick.t} P ${pick.all.hits}/${pick.all.fires}=${pct(pick.all.precision)} R ${pct(pick.all.recall)} mag ${pick.magic.hits}/${pick.magic.fires}`:''} ${son?`| S ${son.hits}/${son.fires} R${pct(son.recall)}`:''} ${pick?.ref??''}`);
}
