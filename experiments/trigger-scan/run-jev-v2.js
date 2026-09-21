// Jev v2, following the docs audit (see AUDIT.md):
//  - judges short beats (<= 8 cues) addressed by path inside one request per window, not whole windows
//  - narrow present-tense questions; "being retold" is a companion question that vetoes in code
//  - two single-dimension Scores about the text (threat, distress) instead of one viewer-reaction score
//  - state carries only window-local line ids, the text, and the cast members named in the window
//  - sound captions are pulled out by regex and judged on their own
//
//   node run-jev-v2.js --track sdh --label r1
import { CATEGORY_IDS } from './taxonomy.js';
import { ATTRIBUTES, MODIFIERS, CANCELLED_WHEN_RETOLD } from './taxonomy-v2.js';
import { loadTrack, loadFilm, glossary, parseArgs, pool, postJson, saveRun } from './common.js';

const MODEL = 'jev-1.13.0';
const PRICE_PER_MTOK = 0.042;
const MAX_BEAT_CUES = 8;
const BEAT_GAP_MS = 2000;
const RETOLD = 'A character describing something that happened earlier, or that might happen, is a no.';

// id -> [question about P, optional `false` boundary]. P is replaced by the beat's path.
const ATOMS = {
  chased: ['In P, is a character being chased or attacked at this moment?', RETOLD],
  in_hazard: ['In P, is a character caught in a physical hazard at this moment, such as a net, a strong current, a machine, or an explosion?', RETOLD],
  predator_present: ['In P, is a dangerous animal or monster threatening a character who is there with it?', `${RETOLD} A friendly animal is a no.`],
  dies_now: ['In P, does a character die or get killed at this moment?', RETOLD],
  believed_dead: ['In P, does a character believe that someone close to them has just died?', 'Remembering a death from long ago is a no. "I\'m dead" said as a figure of speech is a no.'],
  grieving: ['In P, is a character mourning someone they have lost?', null],
  child_taken: ['In P, is a child being taken away from a parent at this moment?', 'Nobody is taken in these lines. A parent telling others that their child was taken earlier is a no. A school drop-off is a no.'],
  child_lost_calling: ['In P, is a child alone and calling for a parent, or a parent desperately calling for a missing child?', RETOLD],
  companion_rejected: ['In P, does a character tell a companion to leave, or that they are not wanted?', null],
  captured_now: ['In P, is a character being caught, netted, bagged, or swallowed at this moment?', RETOLD],
  trapped_struggling: ['In P, is a character stuck somewhere and struggling to get free?', 'Characters who live in a tank or cage and are calmly talking or planning are a no.'],
  hurt_now: ['In P, is a character physically hurt, stung, or knocked unconscious at this moment?', RETOLD],
  says_dark: ['In P, do characters say that it is dark or that they cannot see?', null],
  frightened: ['In P, is a character frightened by what is around them?', null],
  angry_yelling: ['In P, is a character yelling at another character in anger?', 'Excited, playful, or urgent shouting without anger is a no.'],
  threatens: ['In P, does a character threaten to harm another character?', null],
  panicking: ['In P, is a character panicking or screaming in terror?', null],
  crying_despair: ['In P, is a character crying, pleading, or giving up hope?', 'A baby crying in the background is a no.'],
  child_defies: ['In P, does a child do something dangerous that an adult has just told them not to do?', null],
  recounting: ['In P, is a character telling others about events that happened earlier?', null],
  joking: ['Is the exchange in P played as a joke?', null],
};
const THREAT = ['Nobody is in any danger.', 'A danger is talked about or hinted at but is not present.', 'A character is in real danger but not harmed: chased, cornered, or trapped.', 'A character is attacked, seriously hurt, swallowed, or appears to die.'];
const DISTRESS = ['Characters are calm, joking, or happy.', 'A character is worried, annoyed, or sad but composed.', 'A character is frightened, crying, or pleading.', 'A character is screaming in terror or grieving a death.'];

const args = parseArgs();
// --taxonomy universal: ask the universal 5-10 attribute set (taxonomy-v2.js) instead of the Nemo-era atoms above.
const UNIVERSAL = args.taxonomy === 'universal';
const QUESTIONS = UNIVERSAL
  ? { ...Object.fromEntries(ATTRIBUTES.map((a) => [a.id, [a.question, a.no]])), ...Object.fromEntries(Object.entries(MODIFIERS).map(([id, q]) => [id, [q, null]])) }
  : ATOMS;

// Universal set -> the 12 legacy categories (only so Nemo can be scored against its reference list).
function combineUniversal(a, loud) {
  const notNow = (a.recounting >= 0.6 || a.imagined >= 0.6) && a.terrified < 0.7;
  const cat = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0]));
  for (const attr of ATTRIBUTES) {
    let p = a[attr.id];
    if (notNow && CANCELLED_WHEN_RETOLD.has(attr.id)) p = 0;
    if (a.joking >= 0.6 && ['threatens_harm', 'adult_rages_at_child', 'physical_violence'].includes(attr.id)) p = 0;
    cat[attr.legacy] = Math.max(cat[attr.legacy], p);
  }
  cat.loud_sudden_sound = Math.max(loud, a.jump_scare >= 0.7 ? a.jump_scare : 0);
  cat.flashing_light_inferred = 0;
  return cat;
}
// Experimental: how much the strongest attribute in the beat matters for each age band (0-1).
const bandScores = (a) => Object.fromEntries(['5-7', '8-10'].map((band) => [band, Math.max(...ATTRIBUTES.map((t) => a[t.id] * (t.weights[band] / 3)))]));
const track = args.track ?? 'sdh';
// --film <slug> runs any film in data/; without it this is the Finding Nemo experiment
const film = args.film;
const { windows } = film ? loadFilm(film) : loadTrack(track);

function cutBeats(cues, cutAfter = new Set()) {
  const beats = [[]];
  for (const c of cues) {
    const cur = beats[beats.length - 1];
    if (cur.length && (cutAfter.has(cur[cur.length - 1].id) || cur.length >= MAX_BEAT_CUES || c.startMs - cur[cur.length - 1].endMs >= BEAT_GAP_MS)) beats.push([c]);
    else cur.push(c);
  }
  // fold a 1-2 cue fragment into its predecessor so a lone gasp is not judged without context
  return beats.reduce((out, b) => (out.length && b.length < 3 && !cutAfter.has(out[out.length - 1][out[out.length - 1].length - 1].id) && out[out.length - 1].length + b.length <= MAX_BEAT_CUES + 2 ? (out[out.length - 1].push(...b), out) : [...out, b]), []);
}

// Only cast members named in this window, described neutrally; no plot.
function castFor(text) {
  const cast = {};
  if (film) return cast; // no per-film cast lists; removing the glossary made no difference on Nemo
  for (const [names, role] of Object.entries(glossary.characters)) {
    for (const name of names.split(',').map((n) => n.replace(/\(.*?\)/g, '').trim())) {
      if (new RegExp(`\\b${name.replace(/^The /, '')}\\b`, 'i').test(text)) cast[name] = role;
    }
  }
  return cast;
}

const max = Math.max;
function combine(a, loud) {
  const cat = {
    peril_chase: max(a.chased, a.in_hazard),
    predator_creature: a.predator_present,
    death_loss: max(a.dies_now, a.believed_dead, a.grieving),
    separation_abandonment: max(a.child_taken, a.child_lost_calling, a.companion_rejected),
    injury_pain: a.hurt_now,
    captivity_confinement: max(a.captured_now, a.trapped_struggling),
    darkness_unknown: Math.min(a.says_dark, a.frightened),
    shouting_aggression: a.joking >= 0.6 ? 0 : max(a.angry_yelling, a.threatens),
    emotional_distress: max(a.panicking, a.crying_despair),
    imitable_risk: a.child_defies,
    loud_sudden_sound: loud,
    flashing_light_inferred: 0, // not assessable from text
  };
  // A retelling is not the event, unless the teller is themselves in distress right now.
  if (a.recounting >= 0.6 && a.panicking < 0.7) for (const k of ['peril_chase', 'predator_creature', 'separation_abandonment', 'captivity_confinement', 'injury_pain']) cat[k] = 0;
  return cat;
}

const startedAt = new Date().toISOString();
const headers = { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` };

// ---- pass 1: sound captions, one request for all distinct captions -------------------------------
const captionsOf = (text) => text.match(/\([A-Z][A-Z '\-,]+\)/g) ?? [];
const distinct = [...new Set(windows.flatMap((w) => w.cues.flatMap((c) => captionsOf(c.text))))];
// tracks without hearing-impaired captions have nothing to ask here
const captionRes = !distinct.length ? { json: { answers: {}, usage: { input_tokens: 0 } } } : await postJson('https://api.typesafe.ai/v1/systemone', headers, {
  model: MODEL,
  state: { captions: distinct },
  questions: Object.fromEntries(distinct.map((_, i) => [`c${i}`, { type: 'noul', instructions: `Is the sound described by \`captions[${i}]\` a sudden loud noise such as a scream, roar, crash, or explosion?`, criteria: { true: 'A sudden loud noise.', false: 'Quiet, gradual, or ordinary sounds: laughing, sighing, gasping, sobbing, singing, music, mumbling.' } }])),
});
const loudOf = Object.fromEntries(distinct.map((c, i) => [c, captionRes.json.answers[`c${i}`].noul]));

// ---- optional pass (--cuts): where does the film cut to other characters in another place? -----------
// Beats are cut by line count and pauses, so a beat can straddle two scenes ("Swim away!" / "Dad! Daddy?").
const CUT_MIN_P = 0.25;
const cutsByWindow = new Map();
let cutTokens = 0;
if (args.cuts) {
  await pool(windows, 8, async (w) => {
    const ids = w.cues.map((_, i) => `L${String(i + 1).padStart(2, '0')}`);
    const { json } = await postJson('https://api.typesafe.ai/v1/systemone', headers, {
      model: MODEL,
      state: { lines: w.cues.map((c, i) => `${ids[i]}| ${c.text}`) },
      questions: { cut: { type: 'choice', instructions: 'These subtitle lines may cover more than one scene of a film. After which line does the film cut to different characters in a different place? Each option is the id at the start of a line.', criteria: { ...Object.fromEntries(ids.slice(0, -1).map((id) => [id, null])), none: 'All of the lines belong to one continuous scene.' } } },
    });
    cutTokens += json.usage.input_tokens;
    const probs = json.answers.cut.probabilities;
    cutsByWindow.set(w.id, { none: probs.none ?? 0, after: new Set(ids.map((id, i) => [w.cues[i].id, probs[id] ?? 0]).filter(([, p]) => p >= CUT_MIN_P).map(([cueId]) => cueId)), top: ids.map((id, i) => [w.cues[i].id, probs[id] ?? 0]).sort((a, b) => b[1] - a[1]).slice(0, 2) });
  });
}

// Severity per age band, written as situations in the text (not predicted reactions), one dimension each.
const SEV_5_7 = ['Calm or funny talk; nobody is scared, hurt, lost, or in danger.', 'A brief scare, a loud surprise, or a short moment of worry or sadness that is over within these lines.', 'A character is chased, trapped, lost, in the dark, or crying, and it continues through these lines.', 'A creature attacks a character, a child is taken from a parent, or someone dies or appears to die.'];
const SEV_8_10 = ['Calm or funny talk; nobody is scared, hurt, lost, or in danger.', 'Danger or sadness that is make-believe, played for laughs, or over within these lines.', 'A character is really hurt, humiliated, or in danger that continues through these lines.', 'Someone dies or appears to die, a child is taken from a parent, or a family member is in serious danger.'];

// ---- pass 2: one request per window, questions per beat ------------------------------------------
const perWindow = await pool(windows, 8, async (w) => {
  const local = new Map(w.cues.map((c, i) => [c.id, `L${String(i + 1).padStart(2, '0')}`]));
  const beats = cutBeats(w.cues, cutsByWindow.get(w.id)?.after);
  const questions = {};
  beats.forEach((_, i) => {
    const P = `\`beats[${i}].lines\``;
    for (const [id, [q, no]] of Object.entries(QUESTIONS)) questions[`b${i}.${id}`] = { type: 'noul', instructions: q.replace(/\bP\b/, P), ...(no ? { criteria: { false: no } } : {}) };
    questions[`b${i}.threat`] = { type: 'score', instructions: `How much physical danger are the characters in during ${P}?`, criteria: THREAT };
    questions[`b${i}.distress`] = { type: 'score', instructions: `How upset are the characters during ${P}?`, criteria: DISTRESS };
    if (args.bands) {
      questions[`b${i}.sev57`] = { type: 'score', instructions: `Which situation best describes what happens in ${P}?`, criteria: SEV_5_7 };
      questions[`b${i}.sev810`] = { type: 'score', instructions: `Which situation best describes what happens in ${P}?`, criteria: SEV_8_10 };
    }
  });
  const body = {
    model: MODEL,
    state: { cast: castFor(w.cues.map((c) => c.text).join(' ')), beats: beats.map((b) => ({ lines: b.map((c) => `${local.get(c.id)}| ${c.text}`) })) },
    questions,
  };
  const { json, latencyMs } = await postJson('https://api.typesafe.ai/v1/systemone', headers, body);
  return beats.map((b, i) => {
    const atoms = Object.fromEntries(Object.keys(QUESTIONS).map((id) => [id, json.answers[`b${i}.${id}`].noul]));
    const threat = json.answers[`b${i}.threat`];
    const distress = json.answers[`b${i}.distress`];
    const pHigh = (s) => (s.probabilities['2'] ?? 0) + (s.probabilities['3'] ?? 0);
    const loud = max(0, ...b.flatMap((c) => captionsOf(c.text)).map((c) => loudOf[c]));
    return {
      windowId: `${w.id}.${i + 1}`,
      startMs: b[0].startMs,
      endMs: b[b.length - 1].endMs,
      cueIds: [b[0].id, b[b.length - 1].id],
      categories: UNIVERSAL ? combineUniversal(atoms, loud) : combine(atoms, loud),
      ...(UNIVERSAL ? { bands: bandScores(atoms) } : {}),
      ...(args.bands ? { bandSeverity: { '5-7': json.answers[`b${i}.sev57`].score, '8-10': json.answers[`b${i}.sev810`].score }, bandConfidence: { '5-7': json.answers[`b${i}.sev57`].confidence, '8-10': json.answers[`b${i}.sev810`].confidence } } : {}),
      severity: max(threat.score, distress.score),
      pHigh: max(pHigh(threat), pHigh(distress)),
      atoms,
      threat: { score: threat.score, probabilities: threat.probabilities, confidence: threat.confidence },
      distress: { score: distress.score, probabilities: distress.probabilities, confidence: distress.confidence },
      peakCue: null,
      usage: i === 0 ? json.usage : { input_tokens: 0, output_tokens: 0 },
      latencyMs,
    };
  });
});

const beatsOut = perWindow.flat();
const inputTokens = beatsOut.reduce((s, r) => s + r.usage.input_tokens, 0) + captionRes.json.usage.input_tokens + cutTokens;
const run = {
  arm: (UNIVERSAL ? 'jev-v3-universal' : 'jev-v2-beats') + (args.cuts ? '+cuts' : '') + (args.bands ? '+bands' : ''),
  cuts: args.cuts ? Object.fromEntries([...cutsByWindow].map(([id, c]) => [id, { none: c.none, after: [...c.after], top: c.top }])) : undefined,
  v2: true,
  film,
  track: film ?? track,
  label: args.label,
  model: MODEL,
  startedAt,
  wallMs: Date.now() - Date.parse(startedAt),
  calls: windows.length + 1,
  inputTokens,
  outputTokens: 0,
  costUsd: (inputTokens / 1e6) * PRICE_PER_MTOK,
  captions: loudOf,
  windows: beatsOut,
};
console.log('saved', saveRun(run, args.dir ?? (film ? 'runs-films' : 'runs')));
console.log(`${run.calls} calls, ${beatsOut.length} beats, ${inputTokens} input tokens, $${run.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)}s wall`);
void CATEGORY_IDS;
