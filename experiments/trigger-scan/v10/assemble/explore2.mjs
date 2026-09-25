import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('../jevfirst/tournament/results.json','utf8'));
const cands = new Map(r.all_candidates.map(c=>[c.id,c]));
const wilson=(k,n,z=1.96)=>{if(!n)return -1;const p=k/n,d=1+z*z/n,c=p+z*z/(2*n),m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return (c-m)/d;};
const pct=x=>x==null?'-':Math.round(x*100)+'%';
const TH=['0.6','0.7','0.8'];
const opts=(concept)=>r.all_candidates.filter(c=>c.concept===concept).flatMap(c=>(c.id.includes(':pruned@')?[c.id.split(':pruned@')[1].split(':')[0]]:TH).filter(t=>c.res[t]).map(t=>({id:c.id,kind:c.kind,t:+t,all:c.res[t].all,magic:c.res[t].magic,w:wilson(c.res[t].all.hits,c.res[t].all.fires)})));
const passes=o=>o.all.fires>=4&&o.all.precision>=0.7&&(!o.magic.fires||o.magic.precision>=0.6);
const out=[];
for (const row of r.rows) {
  const son=row.sonnet?.at; const sonM=son&&son.fires>=4;
  const O=opts(row.concept);
  const pass=O.filter(passes).sort((a,b)=>b.all.recall-a.all.recall||b.all.precision-a.all.precision);
  let tier,pick;
  if (pass.length){tier='A-reliable';pick=pass[0];}
  else if (sonM && !row.jev_vs_sonnet_tie){tier='S-sonnet-better';}
  else if (sonM){tier='B-ties-sonnet';pick=O.find(o=>o.id===row.jev_vs_sonnet_tie.id&&o.t===row.jev_vs_sonnet_tie.t);}
  else { tier=row.sonnet?'C-thin-sonnet':'C-no-sonnet';
    const refId=row.concept==='appears_suddenly'?'V:jump_scare':row.concept.startsWith('film:')?`V:${row.concept}`:`V:${row.v9_ids.at(-1)}`;
    const ref=O.find(o=>o.id===refId&&o.t===0.7);
    const el=O.filter(o=>o.all.fires>=4&&(!ref||o.all.recall>=ref.all.recall-0.05)).sort((a,b)=>b.w-a.w||b.all.recall-a.all.recall);
    pick=el[0]??ref; if(pick) pick.ref=ref&&`${ref.all.hits}/${ref.all.fires} R${pct(ref.all.recall)}`; }
  out.push({concept:row.concept,tier,pick,son});
  console.log(`${row.concept.padEnd(22)} ${tier.padEnd(16)} ${pick?`${pick.id}@${pick.t} [${pick.kind}] P ${pick.all.hits}/${pick.all.fires}=${pct(pick.all.precision)} R ${pct(pick.all.recall)} mag ${pick.magic.hits}/${pick.magic.fires}`:''} ${son?`| S ${son.hits}/${son.fires} R${pct(son.recall)}`:''} ${pick?.ref?'ref '+pick.ref:''}`);
}
const c=(t)=>out.filter(x=>x.tier.startsWith(t)).length;
console.log({A:c('A'),B:c('B'),C:c('C'),S:c('S')});
const kinds={}; for(const x of out) if(x.pick) kinds[x.pick.kind]=(kinds[x.pick.kind]??0)+1; console.log(kinds);
