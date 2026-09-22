// No database: the calibration arithmetic, the word matcher, and the OpenAPI document.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHms, parseClock, offsetFromOneAnchor, mappingFromTwoAnchors, applyMapping, implausibleMapping,
} from '../lib/time.js';
import { matchTerm, matchTerms, matchGroup, broadGroupFor, singular, normalise, BROAD_TERMS } from '../lib/match.js';
import { openapi, ROUTES } from '../lib/openapi.js';
import { bandFor, shapeScene } from '../lib/present.js';

test('formatHms', () => {
  assert.equal(formatHms(0), '0:00:00');
  assert.equal(formatHms(186_520), '0:03:06');
  assert.equal(formatHms(3_723_000), '1:02:03');
  assert.equal(formatHms(5_613_350), '1:33:33');
});

test('parseClock accepts seconds, M:SS and H:MM:SS', () => {
  assert.equal(parseClock('312'), 312_000);
  assert.equal(parseClock('186.5'), 186_500);
  assert.equal(parseClock('5:12'), 312_000);
  assert.equal(parseClock('0:05:12'), 312_000);
  assert.equal(parseClock('1:02:03'), 3_723_000);
  assert.equal(parseClock('1:02:03.500'), 3_723_500);
  assert.equal(parseClock('soon'), null);
  assert.equal(parseClock('1:99'), null);
  assert.equal(parseClock(''), null);
});

test('one anchor: a constant shift', () => {
  const m = offsetFromOneAnchor(283_701, 312_000);
  assert.deepEqual(m, { offset_ms: 28_299, scale: 1 });
  assert.equal(applyMapping(1_000_000, m), 1_028_299);
});

test('two anchors: a PAL 25/24 transfer, both directions', () => {
  const a1 = 283_701;
  const a2 = 5_060_723;

  // Their copy is a 24 fps master run at 25 fps: 4% faster, every time x 24/25, plus 30s of extra
  // leader at the front.
  const fast = mappingFromTwoAnchors(a1, Math.round(a1 * (24 / 25)) + 30_000, a2, Math.round(a2 * (24 / 25)) + 30_000);
  assert.ok(Math.abs(fast.scale - 24 / 25) < 1e-6, `scale ${fast.scale}`);
  assert.ok(Math.abs(fast.offset_ms - 30_000) < 2, `offset ${fast.offset_ms}`);
  // Halfway through the film, one anchor alone would already be a minute out.
  const mid = 2_800_000;
  assert.ok(Math.abs(applyMapping(mid, fast) - (mid + 30_000)) > 60_000);

  // And the reverse: a PAL source timed back to 24 fps runs 25/24 slower.
  const slow = mappingFromTwoAnchors(a1, Math.round(a1 * (25 / 24)), a2, Math.round(a2 * (25 / 24)));
  assert.ok(Math.abs(slow.scale - 25 / 24) < 1e-6);
  assert.ok(Math.abs(slow.offset_ms) < 2);
});

test('two anchors: nonsense input is refused rather than producing a silly scale', () => {
  assert.match(mappingFromTwoAnchors(100_000, 0, 130_000, 0).error, /at least 60s apart/);
  assert.match(mappingFromTwoAnchors(100_000, 0, 5_000_000, 20_000_000).error, /playback speed/);
  assert.match(mappingFromTwoAnchors(100_000, 5_000_000, 5_000_000, 100_000).error, /same order/);
});

test('singularisation and normalisation', () => {
  assert.equal(singular('monsters'), 'monster');
  assert.equal(singular('sharks'), 'shark');
  assert.equal(singular('knives'), 'knife');
  assert.equal(singular('boxes'), 'box');
  assert.equal(singular('puppies'), 'puppy');
  assert.equal(singular('glass'), 'glass');
  assert.equal(normalise('Monster or strange creature'), 'monster strange creature');
  assert.equal(normalise('monster_creature'), 'monster creature');
});

test('matchTerm on a small vocabulary', () => {
  const vocab = [
    { id: 'monster_creature', layer: 'presence', label: 'Monster or strange creature', aliases: ['monster', 'monsters', 'beast'] },
    { id: 'shark', layer: 'presence', label: 'Shark', aliases: ['sharks'] },
    { id: 'chased', layer: 'event', label: 'Someone is being chased', aliases: ['chase'] },
  ];
  assert.deepEqual(matchTerm('monsters', vocab).ids, ['monster_creature']);
  assert.deepEqual(matchTerm('MONSTER', vocab).ids, ['monster_creature']);
  assert.deepEqual(matchTerm('monster_creature', vocab).ids, ['monster_creature']);
  assert.deepEqual(matchTerm('Sharks', vocab).ids, ['shark']);
  assert.deepEqual(matchTerm('strange creature', vocab).ids, ['monster_creature']);
  assert.deepEqual(matchTerm('chased', vocab, { layer: 'presence' }).ids, []);
  assert.deepEqual(matchTerm('chased', vocab, { layer: 'event' }).ids, ['chased']);
  assert.deepEqual(matchTerm('velociraptor', vocab).ids, []);
});

test('broad words resolve to a group, the narrow id still resolves to the item', () => {
  const vocab = [
    { id: 'monster_creature', layer: 'presence', label: 'Monster or strange creature', aliases: ['strange creature'] },
    { id: 'shark', layer: 'presence', label: 'Shark', aliases: ['sharks'] },
  ];
  for (const word of ['monster', 'monsters', 'Monsters', 'creature', 'creatures', 'scary creature', 'scary creatures', 'beast', 'beasts']) {
    assert.equal(broadGroupFor(word), 'creatures_figures', word);
  }
  assert.equal(broadGroupFor('monster_creature'), null);
  assert.equal(broadGroupFor('shark'), null);

  const broad = matchTerms(['monsters'], vocab);
  assert.deepEqual(broad.groups, ['creatures_figures']);
  assert.deepEqual(broad.ids, []);
  assert.equal(broad.matched[0].how, 'broadened_to_group');
  assert.match(broad.matched[0].note, /ask for a specific one/);

  const narrow = matchTerms(['monster_creature', 'Sharks'], vocab);
  assert.deepEqual(narrow.groups, []);
  assert.deepEqual(narrow.ids.sort(), ['monster_creature', 'shark']);

  assert.ok(Object.values(BROAD_TERMS).every((g) => g === 'creatures_figures'));
});

test('bandFor', () => {
  assert.equal(bandFor('5-7').band, '5-7');
  assert.equal(bandFor('8-10').band, '8-10');
  assert.equal(bandFor('6').band, '5-7');
  assert.equal(bandFor('9').band, '8-10');
  assert.equal(bandFor(null).band, '5-7');
  assert.equal(bandFor('3').band, '5-7');
  assert.match(bandFor('3').note, /UNDERSTATE/);
  assert.equal(bandFor('12').band, '8-10');
  assert.equal(bandFor('grown up').invalid, true);
});

test('openapi.json is valid JSON and describes every route', () => {
  const doc = openapi({ serverUrl: 'https://example.test' });
  const round = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(round, doc);
  assert.equal(doc.openapi, '3.1.0');
  // ROUTES is the PUBLIC surface, and by default it is the WHOLE document. `x-internal` used to be
  // the only thing keeping the two money-spending POSTs out of a connector, and an importer that
  // enumerates `paths` — which is most of them — never looked at it.
  const publicPaths = Object.entries(doc.paths);
  assert.deepEqual(publicPaths.map(([p]) => p).sort(), [...ROUTES].sort());
  for (const [path, item] of publicPaths) {
    for (const [method, op] of Object.entries(item)) {
      assert.ok(op.operationId, `${method} ${path} needs an operationId`);
      assert.ok(op.summary, `${method} ${path} needs a summary`);
      assert.ok(op.responses, `${method} ${path} needs responses`);
      assert.equal(method, 'get', `${path} offers ${method}: no public operation may write or spend`);
    }
    assert.ok(item.get.responses['200'], `${path} needs a 200`);
  }
  assert.ok(!Object.keys(doc.paths).some((p) => p.startsWith('/api/add')), 'an importer walking `paths` must not find the add routes');
  assert.ok(!JSON.stringify(doc.paths).includes('x-internal'), 'nothing in the public document needs an internal marker any more');
  // Every $ref resolves.
  const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"(#\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of new Set(refs)) {
    const target = ref.slice(2).split('/').reduce((o, k) => o?.[k], doc);
    assert.ok(target, `dangling $ref ${ref}`);
  }
  // The things an assistant must be told are actually in the description.
  for (const phrase of ['subtitle', 'flashing', 'complete', 'unreviewed', 'anchor_cue', 'observed_at', 'PAL',
    'not_assessed', 'possibly_present', 'stated_in_lines', 'known_from_film', 'include_possible',
    'creatures_figures', 'both_sources_agree']) {
    assert.ok(doc.info.description.includes(phrase), `the description must mention "${phrase}"`);
  }
  assert.ok(doc.paths['/api/films/{slug}/scenes'].get.parameters.map((p) => p.name ?? p.$ref)
    .join(' ').includes('anchor_cue'));
  assert.equal(doc.servers[0].url, 'https://example.test');

  // The document must describe what the code actually enforces.
  const params = Object.fromEntries(
    doc.paths['/api/films/{slug}/scenes'].get.parameters.filter((p) => p.name).map((p) => [p.name, p]),
  );
  assert.equal(params.offset.schema.maximum, 10000, 'offset has a maximum in code, so it needs one here');
  assert.equal(params.limit.schema.maximum, 300);
  assert.match(params.group.description, /include_possible/);
  assert.match(params.group.description, /exactly/);
  assert.match(params.observed_at.description, /no hours cap|84:20/);
  assert.match(params.observed_at.description, /400/);

  // Every endpoint that can 400 says so.
  for (const path of ['/api/films', '/api/films/{slug}', '/api/films/{slug}/scenes', '/api/vocabulary']) {
    assert.ok(doc.paths[path].get.responses['400'], `${path} can 400 and must document it`);
  }
  // The 405 enum value is reachable, and the schema explains when.
  assert.ok(doc.components.schemas.Error.properties.error.enum.includes('method_not_allowed'));
  assert.match(doc.components.schemas.Error.properties.error.description, /405/);
});

// ------------------------------------------------------------------------------------------------
// Regressions from the code review
// ------------------------------------------------------------------------------------------------

test('parseClock accepts M:SS with more than 59 minutes, as the docs promise', () => {
  // A player showing "62:34" means 62 minutes; only a form WITH an hours field caps minutes at 59.
  assert.equal(parseClock('62:34'), (62 * 60 + 34) * 1000);
  assert.equal(parseClock('84:20'), (84 * 60 + 20) * 1000);
  assert.equal(parseClock('120:00'), 120 * 60 * 1000);
  assert.equal(parseClock('5:12'), (5 * 60 + 12) * 1000);
  // With hours present, 75 minutes is a typo, not a duration.
  assert.equal(parseClock('1:75:00'), null);
  assert.equal(parseClock('0:62:34'), null);
  // Seconds are always capped.
  assert.equal(parseClock('10:75'), null);
  assert.equal(parseClock('1:02:75'), null);
});

test('implausibleMapping catches the wrong-anchor mistakes and passes real ones', () => {
  const DURATION = 5_613_350; // Finding Nemo's subtitle track
  assert.equal(implausibleMapping({ offset_ms: 0, scale: 1 }, DURATION), null);
  assert.equal(implausibleMapping({ offset_ms: 28_299, scale: 1 }, DURATION), null);
  assert.equal(implausibleMapping({ offset_ms: -45_000, scale: 1 }, DURATION), null, 'a trimmed logo is plausible');
  assert.equal(implausibleMapping({ offset_ms: 30_000, scale: 24 / 25 }, DURATION), null, 'a PAL transfer is plausible');

  // The reported case: the late anchor (1:24:20) claimed at 10:00.
  const wrong = offsetFromOneAnchor(5_060_723, 600_000);
  assert.match(implausibleMapping(wrong, DURATION), /before the film begins/);
  assert.match(implausibleMapping({ offset_ms: -90_000, scale: 1 }, DURATION), /before the film begins/);
  assert.match(implausibleMapping({ offset_ms: 40 * 60_000, scale: 1 }, DURATION), /past where it should be/);
  assert.match(implausibleMapping({ offset_ms: 0, scale: 0.0001 }, DURATION), /not the same film/);
  assert.match(implausibleMapping({ offset_ms: 0, scale: 0 }, DURATION), /backwards/);
});

test('shapeScene pins a player time that would be negative, and says it did', () => {
  const scene = {
    id: 'x:S01', title: 'Opening', description: null, start_ms: 5_000, end_ms: 40_000,
    start_cue: 'C0001', end_cue: 'C0004', severity_5_7: 1, severity_8_10: 0,
    confirmed_by_second_run: null, review_status: 'unreviewed', text_visibility: 'high',
  };
  const shifted = shapeScene(scene, [], [], { offset_ms: -20_000, scale: 1 });
  assert.equal(shifted.player_time.start_ms, 0, 'clamped, not -15000');
  assert.equal(shifted.player_time.start, '0:00:00');
  assert.equal(shifted.player_time.end_ms, 20_000);
  assert.match(shifted.player_time.note, /pinned to 0:00:00/);
  assert.equal(shifted.track_time.start_ms, 5_000, 'our own timeline is untouched');

  const normal = shapeScene(scene, [], [], { offset_ms: 20_000, scale: 1 });
  assert.equal(normal.player_time.start_ms, 25_000);
  assert.equal(normal.player_time.note, undefined);
});

test('matchGroup needs a name, not a fragment', () => {
  const groups = [
    { id: 'creatures_figures', label: 'Creatures & figures on screen' },
    { id: 'copyable', label: 'Copyable risk' },
    { id: 'peril', label: 'Peril' },
    { id: 'death', label: 'Death & loss' },
  ];
  assert.equal(matchGroup('peril', groups).id, 'peril');
  assert.equal(matchGroup('PERIL', groups).id, 'peril');
  assert.equal(matchGroup('Death & loss', groups).id, 'death');
  assert.equal(matchGroup('creatures', groups).id, 'creatures_figures', 'a unique whole word is enough');
  assert.equal(matchGroup('copyable', groups).id, 'copyable');
  // Fragments used to win by substring: "e" was inside "copyable".
  assert.equal(matchGroup('e', groups).error, 'none');
  assert.equal(matchGroup('able', groups).error, 'none');
  assert.equal(matchGroup('ril', groups).error, 'none');
  assert.equal(matchGroup('', groups).error, 'empty');
  // A whole word shared by two groups is ambiguous rather than arbitrary.
  const two = matchGroup('loss', [...groups, { id: 'other', label: 'Another loss' }]);
  assert.equal(two.error, 'ambiguous');
  assert.deepEqual(two.candidates.sort(), ['death', 'other']);
});

test('matchTerm returns every item a word is an alias of', () => {
  const vocab = [
    { id: 'gun', layer: 'presence', label: 'Gun', aliases: ['shot', 'shots', 'shooting'] },
    { id: 'needle_medical', layer: 'presence', label: 'Needle or medical procedure', aliases: ['shot', 'shots', 'needle'] },
    { id: 'weapon_used', layer: 'event', label: 'A weapon is used on someone', aliases: ['shot'] },
  ];
  const m = matchTerm('shot', vocab, { layer: 'presence' });
  assert.deepEqual(m.ids.sort(), ['gun', 'needle_medical']);
  assert.equal(m.how, 'several_items');
  assert.match(m.note, /can mean more than one thing/);
  // Layer still scopes it.
  assert.deepEqual(matchTerm('shot', vocab, { layer: 'event' }).ids, ['weapon_used']);
  // An unambiguous word is still a single clean match.
  assert.deepEqual(matchTerm('needle', vocab, { layer: 'presence' }).ids, ['needle_medical']);
  assert.equal(matchTerm('needle', vocab, { layer: 'presence' }).how, 'label');
  assert.equal(matchTerm('gun', vocab, { layer: 'presence' }).how, 'exact');
});

test('the internal document is a separate ask, and it is the one with the add operations on it', () => {
  const doc = openapi({ serverUrl: 'https://example.test', internal: true });
  assert.ok(doc.paths['/api/add/jobs'].post, 'the owner still gets a complete account of the API');
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!path.startsWith('/api/add')) continue;
    for (const op of Object.values(item)) {
      assert.ok(op['x-internal'] && op.tags?.includes('internal'), `${path} must still be marked internal`);
      assert.match(op.summary, /^INTERNAL\./, `${path}'s summary must start by saying so`);
    }
  }
});

// ------------------------------------------------------------------------------------------------
// The pool's cancellation, the quotation rule and the budget ledger: the three pieces of the
// pipeline that can be exercised without a database or a stubbed service.
// ------------------------------------------------------------------------------------------------

test('a failed worker stops the pool dispatching, aborts the rest, and settles before it throws', async () => {
  // The bug: `Promise.all` rejected on the first failure while the surviving workers carried on
  // taking items. The pipeline then marked the job failed and released the one-live-run lock with
  // eight paid calls still in flight, and the next run was admitted on top of them.
  const { pool } = await import('../pipeline/net.js');
  const dispatched = [];
  let settled = 0;
  let sawAbort = 0;

  await assert.rejects(
    () => pool(Array.from({ length: 20 }, (_, i) => i), 4, async (item, i, signal) => {
      dispatched.push(i);
      try {
        if (i === 1) throw new Error('call 2 failed');
        // The three siblings already in flight are cancelled where they wait, not left to finish.
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => { clearTimeout(timer); sawAbort += 1; reject(new Error('aborted')); });
        });
      } finally {
        settled += 1;
      }
    }),
    (e) => e.message === 'call 2 failed',
  );

  assert.deepEqual(dispatched, [0, 1, 2, 3], 'nothing beyond the in-flight set was dispatched');
  assert.equal(sawAbort, 3, 'the three still in flight were told to stop');
  assert.equal(settled, 4, 'the pool did not throw until every worker had settled');
});

test('the quotation rule catches eight words of subtitle in a model-written sentence', async () => {
  const { transcriptShingles, quotedRun } = await import('../pipeline/quotes.js');
  const cues = [
    { id: 'C0001', text: 'I cannot swim any faster than this, and I am really frightened now!' },
    { id: 'C0002', text: 'Elsewhere, calmly.' },
  ];
  const fromFilm = transcriptShingles(cues);
  // Punctuation and case are not what makes a quotation.
  assert.equal(quotedRun('i cannot swim any faster than this and i am', fromFilm), 'i cannot swim any faster than this and');
  // Seven words in common is a coincidence; a paraphrase is not a quotation at all.
  assert.equal(quotedRun('I cannot swim any faster than this', fromFilm), null);
  assert.equal(quotedRun('A fish is frightened and cannot swim fast enough to get away', fromFilm), null);
});

test('the budget ledger counts the calls that are still out, not only the ones that are paid for', async () => {
  const { budget } = await import('../pipeline/budget.js');
  const ledger = budget(1);
  // Five workers reserving $0.30 each: the fourth is refused, because the three before it have not
  // been billed yet. Checking completed spending is how a $1.00 cap finished a film at $1.176.
  assert.equal(ledger.reserve(0.3), true);
  assert.equal(ledger.reserve(0.3), true);
  assert.equal(ledger.reserve(0.3), true);
  assert.equal(ledger.reserve(0.3), false);
  assert.equal(ledger.spent, 0);
  // Each one really cost a tenth of its reservation, and the headroom comes back.
  ledger.settle(0.3, 0.03);
  assert.equal(ledger.reserve(0.3), true);
  assert.ok(Math.abs(ledger.spent - 0.03) < 1e-12);
});

test('a client identity is trusted only when the request proves it came from our own proxy', async () => {
  const { clientIp } = await import('../lib/http.js');
  const req = (headers) => ({ headers, socket: { remoteAddress: '10.0.0.1' } });
  const was = process.env.ADD_FILM_PROXY_SECRET;
  try {
    // Unset: the header is just a header, and the old behaviour is what happens.
    delete process.env.ADD_FILM_PROXY_SECRET;
    assert.equal(clientIp(req({ 'x-tinyviewers-client': 'visitor-1', 'x-forwarded-for': '203.0.113.9, 10.0.0.2' })), '203.0.113.9');

    process.env.ADD_FILM_PROXY_SECRET = 'shared-secret';
    assert.equal(
      clientIp(req({ 'x-tinyviewers-proxy': 'shared-secret', 'x-tinyviewers-client': 'visitor-1', 'x-forwarded-for': '203.0.113.9' })),
      'visitor-1',
    );
    // A stranger sending the identity header without the secret gets nothing for it — otherwise
    // anyone could spend somebody else's ten guesses, or dodge their own.
    assert.equal(clientIp(req({ 'x-tinyviewers-client': 'visitor-1', 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');
    assert.equal(clientIp(req({ 'x-tinyviewers-proxy': 'wrong', 'x-tinyviewers-client': 'visitor-1', 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9');
    // A secret of a different length must not throw out of timingSafeEqual.
    assert.equal(clientIp(req({ 'x-tinyviewers-proxy': 'x', 'x-tinyviewers-client': 'visitor-1' })), '10.0.0.1');

    // The proxy says `unknown` when it cannot see the visitor, and that must never become a bucket:
    // every unidentifiable visitor would share one counter and lock each other out — the exact
    // failure this header exists to fix. It falls back to the socket, not to the proxy's own
    // `x-forwarded-for`, and counts nothing at all when there is no socket either.
    assert.equal(
      clientIp(req({ 'x-tinyviewers-proxy': 'shared-secret', 'x-tinyviewers-client': 'unknown', 'x-forwarded-for': '203.0.113.9' })),
      '10.0.0.1',
    );
    assert.equal(clientIp(req({ 'x-tinyviewers-proxy': 'shared-secret', 'x-tinyviewers-client': 'UNKNOWN' })), '10.0.0.1');
    assert.equal(clientIp(req({ 'x-tinyviewers-proxy': 'shared-secret' })), '10.0.0.1', 'a missing identity is the same as an unknown one');
    assert.equal(
      clientIp({ headers: { 'x-tinyviewers-proxy': 'shared-secret', 'x-tinyviewers-client': 'unknown' } }),
      null,
      'nothing to attribute a guess to means no counter, not a shared one',
    );
  } finally {
    if (was === undefined) delete process.env.ADD_FILM_PROXY_SECRET;
    else process.env.ADD_FILM_PROXY_SECRET = was;
  }
});

test('guardPool attaches an error listener so an idle-client error cannot kill the process', async () => {
  const { guardPool } = await import('../lib/db.js');
  const { EventEmitter } = await import('node:events');
  const fake = new EventEmitter();
  assert.equal(fake.listenerCount('error'), 0);
  guardPool(fake, 'test');
  assert.equal(fake.listenerCount('error'), 1);
  // Without a listener this line throws (EventEmitter rethrows unhandled 'error').
  const logged = [];
  const realError = console.error;
  console.error = (m) => logged.push(m);
  try {
    fake.emit('error', new Error('Connection terminated unexpectedly'));
  } finally {
    console.error = realError;
  }
  assert.match(logged[0], /idle client error/);
  assert.match(logged[0], /Connection terminated unexpectedly/);
});

test('the taxonomy copies under pipeline/ are byte-identical to the experiment originals', async () => {
  // pipeline/README.md names the cost of copying rather than importing: the two can drift, and a
  // drift in the taxonomy is the silent kind — a live film would be labelled against a different
  // vocabulary from the six films the database was built with, and nothing in either file or in any
  // response would say so. The copies carry a two-line banner and are identical below it.
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { root } = await import('../lib/db.js');
  const { DEFAULT_EXPERIMENT_DIR } = await import('../load.js');

  for (const name of ['taxonomy-v2.js', 'taxonomy-v3.js']) {
    const copy = fs.readFileSync(path.join(root, 'pipeline', name), 'utf8');
    const original = fs.readFileSync(path.join(DEFAULT_EXPERIMENT_DIR, name), 'utf8');
    const lines = copy.split('\n');
    assert.match(lines[0], /^\/\/ COPY of experiments\/trigger-scan\//, `${name}: no banner`);
    assert.match(lines[1], /^\/\/ /, `${name}: the banner is two lines`);
    assert.equal(lines.slice(2).join('\n'), original, `${name} has drifted from the experiment's copy`);
  }
});
