// The spend rule: every model call reserves its worst-case cost first. Round 1's moment requests
// were billed up to 2.07x their estimate against a 1.28x reservation (all 54 under-reserved).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runJobs, sizeRequest, usd, MOMENT_RESERVE_X_EST } from '../jev-client.js';
import { budget } from '../budget.js';

// [estimated tokens, Choice options, billed input tokens] for the 54 real round-1 moment requests
// (Nemo 23, Monsters, Inc. 18, Lion King 13), from out/<slug>.moments.r1.json (numbers only).
const MOMENT_REQUESTS = [[1345,104,1902],[1113,100,1903],[2578,300,4270],[2273,270,3998],[1090,96,1868],[1148,84,1995],[3832,560,7055],[755,60,1438],[2328,256,3822],[1851,204,3193],[1058,78,1643],[3359,420,5652],[1414,132,2312],[3869,480,6829],[4243,580,7971],[2043,222,3660],[1561,152,2807],[2796,320,4881],[2413,270,4188],[706,48,1328],[2655,276,4372],[897,70,1744],[3439,460,6450],[4170,640,7786],[1149,100,1908],[3143,474,6102],[1925,174,3388],[2645,348,5134],[911,70,1723],[1960,210,3466],[3549,456,6367],[2983,370,5376],[912,76,1782],[1864,216,3594],[1915,232,3765],[2628,320,4776],[6425,1080,13312],[3871,528,7163],[1120,94,2115],[1943,234,3651],[1886,204,3468],[1856,192,3033],[2979,380,5156],[2257,216,3443],[817,36,1134],[307,8,564],[810,52,1274],[453,18,766],[1817,176,2898],[1045,66,1535],[575,38,1103],[689,44,1274],[565,34,1055],[1485,104,2187]];

test('moment reservation covers every billed round-1 moment request', () => {
  assert.equal(MOMENT_REQUESTS.length, 54);
  const over = MOMENT_REQUESTS.filter(([est, , billed]) => billed > Math.ceil(est * MOMENT_RESERVE_X_EST));
  assert.deepEqual(over, [], `billed above the moment reservation: ${JSON.stringify(over)}`);
  // and the old default (est x 3.2/2.5) really was below every one of them
  const oldOver = MOMENT_REQUESTS.filter(([est, , billed]) => billed > Math.ceil((est * 3.2) / 2.5) + 1);
  assert.equal(oldOver.length, 54);
});

test('sizeRequest applies the moment multiplier only when asked', () => {
  const body = { model: 'm', state: { scene: { lines: ['L1| hi'] } }, questions: { a: { type: 'noul', instructions: 'x' } } };
  const plain = sizeRequest(body, 't');
  const mom = sizeRequest(body, 't', { reserveXEst: MOMENT_RESERVE_X_EST });
  assert.ok(mom.reserveTok >= Math.ceil(plain.est * MOMENT_RESERVE_X_EST));
  assert.ok(plain.reserveTok < mom.reserveTok);
  assert.equal(mom.reserveUsd, usd(mom.reserveTok));
});

test('runJobs records a call billed above its reservation', async () => {
  const b = budget(1);
  const logs = [];
  const post = async () => ({ json: { model: 'm', usage: { input_tokens: 5000 }, answers: {} }, attempts: [{ status: 200, ms: 1 }], latencyMs: 1 });
  const jobs = [
    { body: { questions: { a: {} } }, est: 1000, reserveUsd: usd(1280), meta: { id: 'A', label: 'A' } },
    { body: { questions: { a: {} } }, est: 1000, reserveUsd: usd(6000), meta: { id: 'B', label: 'B' } },
  ];
  const { results } = await runJobs(jobs, { key: 'k', budget: b, concurrency: 1, post, log: (s) => logs.push(s) });
  assert.equal(results[0].record.over_reserve, true);
  assert.equal(results[1].record.over_reserve, undefined);
  assert.ok(logs.some((l) => l.includes('OVER RESERVE')));
  assert.ok(Math.abs(b.spent - 2 * usd(5000)) < 1e-12);
});

test('claim-check reservation covers every billed request of the dev run (claims and placements)', async () => {
  const fs = await import('node:fs');
  const { CHOICE_RESERVE_X_EST } = await import('../jev.js');
  const { pairs } = JSON.parse(fs.readFileSync(new URL('./fixtures/claimcheck-billing.json', import.meta.url), 'utf8'));
  assert.equal(pairs.length, 342);
  const under = pairs.filter((p) => p.billed > Math.ceil(p.est_tokens * CHOICE_RESERVE_X_EST));
  assert.deepEqual(under, []);
  // the old reservation (2.5 chars/token = 1.28 x est) was under nearly all of them
  assert.ok(pairs.filter((p) => p.billed > Math.ceil(p.est_tokens * 3.2 / 2.5)).length > 300);
});
