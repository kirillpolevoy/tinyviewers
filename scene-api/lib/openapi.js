// An OpenAPI 3.1 description written for an assistant that has never seen this API and will read
// it once, cold, before answering a worried parent. Prose over jargon on purpose.

export const ROUTES = ['/api/films', '/api/films/{slug}', '/api/films/{slug}/scenes', '/api/vocabulary', '/api/openapi.json'];

const HONESTY = `
WHAT THIS DATA IS, AND WHAT IT IS NOT — say this to the parent, do not skip it:

* Every scene here was found by reading the film's SUBTITLE FILE. Nothing watched the picture.
  Frights that make no sound and nobody mentions (a face in a window, a dark shape, blood on
  screen, strobing or flashing light, a loud music sting) are NOT covered and are routinely
  missed. This API is a filter for the things people say and the sounds a caption records, not a
  content rating.
* For the track named in each answer, the scene list for the WHOLE FILM is complete, not a sample.
  If a moment is not among those scenes, our analysis did not flag it — which is different from
  "it is not there". A filtered or paged response is a subset of that list: compare counts.returned
  with counts.matching before you tell a parent you have shown them everything.
* Everyday words that could mean two things (e.g. "shot" = an injection or a gunshot) resolve to
  ALL of them, and filters_applied says which. Over-matching is deliberate: showing a parent one
  scene they did not need is better than hiding one they did.
* Titles, descriptions, severities and labels are machine-generated and, unless a scene's
  review_status says otherwise, have NOT been checked by a person. Scenes carry
  review_status: "unreviewed".
* A missing label never means "absent". Each scene carries a not_assessed list of vocabulary items
  that subtitles are blind to; for those, the absence of a label carries no information at all.
* Labels come in four strengths and you must not flatten them. See "FOUR STRENGTHS" below.
* confirmed_by_second_run: true means a second independent pass over the same subtitles found an
  overlapping scene. false means it did not. null means no second pass exists for that film. It is
  a consistency check between two model runs, not a check against the film.
* Severities (severity_5_7 and severity_8_10) run 0-3 and are one model's reading of a passage of
  dialogue. They are not a rating from any board and they are not a promise.
`.trim();

const CALIBRATION = `
HOW TO GET TIMES THAT MATCH THE PARENT'S SCREEN

Every timestamp belongs to ONE subtitle track, which belongs to ONE release of the film. Another
release can start tens of seconds earlier or later (different logos, different studio cards), and
a PAL transfer of a 24 fps film runs about 4% FASTER, so a difference that starts at zero grows to
minutes by the end. Quoting our raw times at a parent is the main way this API can be wrong in a
way that matters.

Two ways to fix it:

1. platform=<name> — if someone has measured the offset for that streaming service. Call
   GET /api/films/{slug} first; calibration_platforms.available lists what exists. It is empty for
   every film today, so this will usually fail; prefer option 2.

2. anchor_cue + observed_at — always available. GET /api/films/{slug} returns three short spoken
   lines (anchors.lines), one near the start, one in the middle, one near the end, each with the
   time WE have for it. Ask the parent to play the film, listen for one of those lines, and read
   the clock on their player when it is spoken. Then:

     /api/films/nemo/scenes?anchor_cue=C0056&observed_at=0:05:12

   The API computes offset = their time - our time and reports every scene in both timelines.

   ONE anchor corrects the start only; it assumes both copies play at the same speed. If the
   parent can give you TWO anchors (use the early one and the late one, they must be at least a
   minute apart), pass them comma separated and in the same order:

     /api/films/nemo/scenes?anchor_cue=C0056,C1420&observed_at=0:05:12,1:24:45

   Two anchors also recover the speed difference (scale). The response's calibration block states
   the offset, the scale and, in words, whether their copy runs faster or slower than ours.

observed_at accepts H:MM:SS (0:05:12), M:SS with no cap on the minutes (5:12, and 84:20 means 84 minutes) or
plain seconds (312). If the numbers imply a film that starts before it begins or ends half an hour
past its length, the API returns a 400 asking you to check the anchor line rather than a bogus time. Every scene then carries
track_time (our clock) AND player_time (theirs). Quote player_time to the parent, and say which
release the calibration came from.
`.trim();

const STRENGTHS = `
FOUR STRENGTHS, AND WHY YOU MUST NOT FLATTEN THEM

Every scene sorts what we know into four lists. They do not mean the same thing:

1. present — a per-scene judgement says this IS in the scene. Each entry carries evidence:
     "stated_in_lines"  the subtitle lines of that scene show it. This is evidence from our data.
     "known_from_film"  the model says it is on screen there from knowing the film, and our
                        subtitles do NOT corroborate it. Usually right, sometimes the wrong scene.
                        Worth saying out loud when a parent is deciding on it.
   An entry also carries both_sources_agree: true when a second, independent screener agreed.
2. possibly_present — ONLY a cheap per-beat screener leaned this way, with a probability. That
   screener reads 8 subtitle lines at a time and over-flags badly: on Finding Nemo it calls the
   barracuda attack, the scuba divers and the pelican flight all "shark". Treat these as leads to
   check, never as facts, and never read one to a parent as though it were in the film.
3. talked_about_only — the dialogue brings it up while it is NOT in the scene ("there are sharks
   out there"). Often exactly what a parent does not mind. possibly_talked_about is the screener's
   weaker version of the same thing.
4. not_assessed — subtitles are blind to this and nobody looked. Absence proves nothing.

By default filters match list 1 only. include_possible=true also matches list 2, and the response
says so in filters_applied.match_rule.
`.trim();

const FILTERING = `
HOW TO TURN A PARENT'S WORDS INTO FILTERS

There are two independent layers, and mixing them up is the commonest mistake:

* presence = WHAT IS IN THE SCENE, regardless of whether anything bad happens. A friendly monster,
  a comic monster and a terrifying monster all count. Use this for "does it have X in it"
  questions: monsters, sharks, spiders, guns, needles, the dark, fire, a graveyard.
* event  = WHAT HAPPENS TO THE CHARACTERS right now: chased, captured, someone dies, a child is
  taken from a parent, someone is crying. Use this for "does anything bad happen" questions.
* group  = a whole family of either, e.g. creatures_figures, peril, death, separation.

Values are matched tolerantly — case and plurals do not matter, and everyday words work: "Sharks"
resolves to shark, "needles" to needle_medical, "the dark" to darkness. If nothing matches you get
a 400 with the nearest ids. GET /api/vocabulary lists every id, its parent-facing label and the
other words it answers to.

BROAD WORDS RESOLVE TO A GROUP. "monster", "monsters", "creature(s)", "scary creature(s)" and
"beast(s)" are answered with the whole creatures_figures GROUP, not with one item, and
filters_applied says so. This is deliberate: the narrow item monster_creature excludes every
ordinary animal by definition, so under it Finding Nemo has no monsters at all — a true statement
about our taxonomy and a useless answer to a parent, who means "frightening creatures of any
kind". Worked example: presence=monsters on Finding Nemo returns 11 scenes (the barracuda as
large_predator, Bruce the shark, the anglerfish as monster_creature, and more); presence=
monster_creature on the same film returns just the anglerfish. Use the id when the parent really
does mean the narrow thing, and offer to narrow ("shark", "ghost") when the group is too wide.

Different kinds of filter are ANDed; several values of one kind are ORed. So
presence=shark&event=chased means "a shark is present AND someone is chased".

If a filter matches nothing, the response carries a nothing_matched block, with screener_leads
where the weaker detector saw something. Read it before telling a parent a film is clear.

${STRENGTHS}
`.trim();

const AGE = `
AGES

Severity is scored for two bands only, 5-7 and 8-10. Pass age=5-7, age=8-10, or a plain number of
years and the API picks the band. A number below 5 is answered with the 5-7 band, and the response
says so in filters_applied.age_band_note — that band UNDERSTATES how frightening a scene is for a
three- or four-year-old, and you must pass that warning on. age only chooses which severity column
min_severity is compared against; it never hides scenes on its own.
`.trim();

export function openapi({ serverUrl = '/' } = {}) {
  const vocabHint = 'A vocabulary id, a parent-facing label, or an everyday word. Case and plurals do not matter. See GET /api/vocabulary.';
  return {
    openapi: '3.1.0',
    info: {
      title: 'Scene database for parents',
      version: '0.1.0',
      summary: 'Exact, subtitle-anchored time ranges for the scenes in a few children\'s films, filterable by what is in them and what happens, with severity for ages 5-7 and 8-10.',
      description: [
        'This API answers one question well: "which moments of this film would bother MY child, and exactly when are they?"',
        '',
        'It does not write prose and it does not know anything about a film beyond one subtitle track. Use it for the',
        'things a web search cannot give you: the complete scene list for one release, exact start and end times you can',
        'calibrate to the parent\'s own player, per-child filters, and an explicit account of what was not assessed.',
        '',
        HONESTY,
        '',
        FILTERING,
        '',
        AGE,
        '',
        CALIBRATION,
      ].join('\n'),
    },
    servers: [{ url: serverUrl, description: 'This deployment' }],
    paths: {
      '/api/films': {
        get: {
          operationId: 'listFilms',
          summary: 'Find a film by title.',
          description: 'Case-insensitive substring match on the title and on the slug, so "nemo" finds Finding Nemo. Call with no q to see every film in the database. Only a handful of films have been analysed; a film that is missing has simply not been looked at.',
          parameters: [
            { name: 'q', in: 'query', required: false, description: 'Part of the title, e.g. "nemo".', schema: { type: 'string', maxLength: 120 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
          ],
          responses: {
            200: { description: 'Matching films, each with its slug and a link to its detail and scenes.', content: { 'application/json': { schema: { $ref: '#/components/schemas/FilmList' } } } },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
      },
      '/api/films/{slug}': {
        get: {
          operationId: 'getFilm',
          summary: 'One film: the analysed release, the anchor lines used for calibration, counts, and the caveats you must repeat.',
          description: 'Call this BEFORE quoting any time to a parent. It tells you which release the timestamps belong to, whether the track had sound captions, how many scenes exist, which analysis runs produced them, and gives the three anchor lines you use to calibrate.',
          parameters: [{ $ref: '#/components/parameters/Slug' }],
          responses: {
            200: { description: 'Film, track, anchors, counts, provenance and caveats.', content: { 'application/json': { schema: { $ref: '#/components/schemas/FilmDetail' } } } },
            400: { $ref: '#/components/responses/BadRequest' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/films/{slug}/scenes': {
        get: {
          operationId: 'listScenes',
          summary: 'The complete scene list for a film, filtered, in time order, in both timelines.',
          description: `Returns every scene our analysis produced for the film's subtitle track, narrowed by the filters you pass, always sorted by start time.\n\n${FILTERING}\n\n${CALIBRATION}`,
          parameters: [
            { $ref: '#/components/parameters/Slug' },
            { name: 'presence', in: 'query', required: false, description: `Comma-separated. What must be IN the scene. ${vocabHint} The broad words "monster(s)", "creature(s)", "scary creature(s)" and "beast(s)" are answered with the whole creatures_figures group rather than the narrow monster_creature item; the response says so in filters_applied. Example: presence=monsters or presence=shark,darkness`, schema: { type: 'string' } },
            { name: 'event', in: 'query', required: false, description: `Comma-separated. What must HAPPEN in the scene. ${vocabHint} Example: event=chased,captured`, schema: { type: 'string' } },
            { name: 'group', in: 'query', required: false, description: 'Comma-separated group ids or full labels, e.g. creatures_figures, peril, death, separation. Name a group exactly: a fragment of a label is rejected rather than guessed at. Matches a scene carrying any asserted label in that group, or — with include_possible=true — any screener lead in it too.', schema: { type: 'string' } },
            { name: 'age', in: 'query', required: false, description: 'The child\'s age. "5-7", "8-10", or a plain number of years. A number below 5 is answered with the 5-7 band and the response says so; pass that warning on. Chooses which severity column min_severity uses.', schema: { type: 'string', examples: ['5-7', '8-10', '4'] } },
            { name: 'min_severity', in: 'query', required: false, description: 'Keep only scenes whose severity for the chosen age band is at least this. 0 = nothing, 1 = a brief scare, 2 = sustained danger or distress, 3 = an attack, a child taken from a parent, or a death.', schema: { type: 'integer', minimum: 0, maximum: 3 } },
            { name: 'only_confirmed', in: 'query', required: false, description: 'true keeps only scenes a second independent analysis pass also found. Films with no second pass have confirmed_by_second_run = null and are excluded entirely; the response says how many that removed.', schema: { type: 'boolean', default: false } },
            { name: 'include_possible', in: 'query', required: false, description: 'false (the default) matches only what a per-scene judgement asserted. true also matches the weaker per-beat screener leads a scene lists under possibly_present. Use it when a parent would rather see a false hit than miss something, and tell them the extra scenes are unconfirmed leads.', schema: { type: 'boolean', default: false } },
            { name: 'platform', in: 'query', required: false, description: 'Name of a streaming release whose time offset has been measured, e.g. "Disney+". None have been measured yet, so this usually 400s; use anchor_cue + observed_at. Cannot be combined with them.', schema: { type: 'string' } },
            { name: 'anchor_cue', in: 'query', required: false, description: 'One or two anchor cue ids from GET /api/films/{slug} (anchors.lines[].cue_id), comma separated, e.g. C0056 or C0056,C1420.', schema: { type: 'string' } },
            { name: 'observed_at', in: 'query', required: false, description: 'Where the parent actually heard those lines on their own player, in the same order as anchor_cue. H:MM:SS (1:24:20), M:SS with no hours cap (84:20 means 84 minutes) or plain seconds (5060). One value gives an offset; two give an offset and a playback-speed correction. A pair of times that would put the film before its start or far past its end is rejected with a 400 rather than turned into nonsense.', schema: { type: 'string' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 300, default: 100 } },
            { name: 'offset', in: 'query', required: false, description: 'How many matching scenes to skip. counts.matching says how many matched in all.', schema: { type: 'integer', minimum: 0, maximum: 10000, default: 0 } },
          ],
          responses: {
            200: { description: 'Scenes in time order, with the filters that were applied, the calibration that was used, and the caveats.', content: { 'application/json': { schema: { $ref: '#/components/schemas/SceneList' } } } },
            400: { $ref: '#/components/responses/BadRequest' },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/api/vocabulary': {
        get: {
          operationId: 'getVocabulary',
          summary: 'Every filter value, grouped, with the everyday words each one answers to.',
          description: 'Read this to turn what a parent said into presence / event / group filters. It also lists broad_words — everyday words like "monsters" that are answered with a whole group rather than one item. Items flagged text_blind are things subtitles cannot see; their absence from a scene means "not assessed", never "not there".',
          responses: {
            200: { description: 'Groups and items.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Vocabulary' } } } },
            400: { $ref: '#/components/responses/BadRequest' },
          },
        },
      },
      '/api/openapi.json': {
        get: {
          operationId: 'getOpenapi',
          summary: 'This document.',
          responses: { 200: { description: 'The OpenAPI 3.1 description of this API.', content: { 'application/json': { schema: { type: 'object' } } } } },
        },
      },
    },
    components: {
      parameters: {
        Slug: { name: 'slug', in: 'path', required: true, description: 'The film\'s slug, from GET /api/films.', schema: { type: 'string', examples: ['nemo', 'monsters-inc'] } },
      },
      responses: {
        BadRequest: { description: 'A parameter was not understood. The body explains what is wrong and, for an unknown filter value, lists the nearest vocabulary ids.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        NotFound: { description: 'No such film. The body lists every slug this database holds.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error', 'message'],
          properties: {
            error: { type: 'string', enum: ['bad_request', 'not_found', 'method_not_allowed', 'internal_error'], description: 'method_not_allowed (405) comes back for anything other than GET, HEAD or OPTIONS: this API is read-only.' },
            message: { type: 'string', description: 'Plain English; safe to paraphrase to the user.' },
            did_you_mean: { type: 'array', items: { type: 'string' } },
            available: { type: 'array', items: { type: 'string' } },
          },
        },
        FilmList: {
          type: 'object',
          properties: {
            query: { type: ['string', 'null'] },
            count: { type: 'integer' },
            films: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, title: { type: 'string' }, year: { type: ['integer', 'null'] }, imdb_id: { type: ['string', 'null'] }, scene_count: { type: 'integer' }, detail: { type: 'string' }, scenes: { type: 'string' } } } },
            note: { type: 'string' },
          },
        },
        FilmDetail: {
          type: 'object',
          properties: {
            film: { type: 'object' },
            track: { type: 'object', description: 'The one subtitle file all timestamps belong to: its source, release label if recorded, whether it has sound captions, cue count and sha256.' },
            anchors: { type: 'object', description: 'Three short spoken lines with our time for each. Give one to the parent to calibrate.' },
            calibration_platforms: { type: 'object' },
            counts: { type: 'object' },
            analysis_runs: { type: 'array', items: { type: 'object' }, description: 'Which model, taxonomy and script produced the rows, and what it cost.' },
            caveats: { $ref: '#/components/schemas/Caveats' },
          },
        },
        Caveats: {
          type: 'object',
          description: 'Sentences about the limits of this data, written to be said out loud. Do not summarise a scene list without them.',
          properties: {
            complete_for_this_film: { type: 'string', description: 'A statement about the FILM, not about the response. A filtered or paged response is a subset; check counts.matching before calling any list complete.' },
            derived_from_subtitles_only: { type: 'string' },
            machine_generated: { type: 'string' },
            human_review: { type: 'string' },
            missing_label_is_not_absence: { type: 'string' },
            timestamps_belong_to_one_release: { type: 'string' },
            severity_scale: { type: 'string' },
            confirmation: { type: 'string' },
          },
        },
        SceneList: {
          type: 'object',
          properties: {
            film: { type: 'object' },
            track: { type: 'object' },
            filters_applied: { type: 'object', description: 'What each filter value resolved to, the age band used, and any warning about it.' },
            calibration: { $ref: '#/components/schemas/Calibration' },
            counts: {
              type: 'object',
              description: 'returned = how many scenes are in THIS response. matching = how many matched the filters in all, ignoring limit and offset. scenes_in_film = every scene we have for the film. When matching is larger than returned, a `more` line says how to page on. Never tell a parent the list is complete when returned is smaller than matching.',
              properties: {
                returned: { type: 'integer' },
                matching: { type: 'integer' },
                scenes_in_film: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                more: { type: 'string' },
              },
            },
            scenes: { type: 'array', items: { $ref: '#/components/schemas/Scene' } },
            nothing_matched: { type: 'object', description: 'Present only when the filters matched no scene. Carries screener_leads (things the weaker per-beat detector saw, with probabilities) and talked_about_somewhere. Read it before telling a parent a film is clear.' },
            caveats: { $ref: '#/components/schemas/Caveats' },
          },
        },
        Calibration: {
          type: 'object',
          properties: {
            applied: { type: 'boolean' },
            method: { type: 'string', enum: ['none', 'platform', 'one_anchor', 'two_anchors'] },
            offset_ms: { type: 'integer', description: 'player_ms = track_ms * scale + offset_ms' },
            scale: { type: 'number', description: '1 when both releases run at the same speed. About 0.96 or 1.042 across an NTSC/PAL change.' },
            anchors_used: { type: 'array', items: { type: 'object' } },
            how_to: { type: 'string' },
          },
        },
        Scene: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', description: 'Machine-written.' },
            description: { type: ['string', 'null'], description: 'Machine-written from the subtitles, sometimes wrong about who or what is on screen. Attribute it, do not assert it.' },
            track_time: { type: 'object', description: 'Start and end on OUR subtitle track, in ms and H:MM:SS.' },
            player_time: { type: 'object', description: 'The same moment on the parent\'s copy after calibration. Identical to track_time when no calibration was requested.' },
            start_cue: { type: 'string', description: 'The subtitle cue id the scene starts on.' },
            end_cue: { type: 'string' },
            severity: { type: 'object', properties: { '5-7': { type: ['integer', 'null'] }, '8-10': { type: ['integer', 'null'] } } },
            present: { type: 'array', items: { $ref: '#/components/schemas/Label' }, description: 'A per-scene judgement says these are in the scene. Check each one\'s `evidence`.' },
            possibly_present: { type: 'array', items: { $ref: '#/components/schemas/Label' }, description: 'Only the per-beat screener leaned this way, with a probability. It over-flags; these are leads to check, not facts. Never present one to a parent as something in the film.' },
            talked_about_only: { type: 'array', items: { $ref: '#/components/schemas/Label' }, description: 'Mentioned in dialogue while not in the scene.' },
            possibly_talked_about: { type: 'array', items: { $ref: '#/components/schemas/Label' }, description: 'The screener\'s weaker version of talked_about_only.' },
            events: { type: 'array', items: { $ref: '#/components/schemas/Label' } },
            not_assessed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, why: { type: 'string' } } }, description: 'Things subtitles are blind to that carry no label here. Absence proves nothing for these.' },
            confirmed_by_second_run: { type: ['boolean', 'null'] },
            review_status: { type: 'string' },
            text_visibility: { type: ['string', 'null'], description: 'How much of what happens in this scene the subtitles could see. "low" means most of it was visual.' },
          },
        },
        Label: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            group: { type: ['string', 'null'] },
            group_label: { type: ['string', 'null'] },
            probability: { type: ['number', 'null'], description: 'Only on possibly_present / possibly_talked_about: the per-beat screener\'s probability, 0-1.' },
            evidence: { type: 'string', enum: ['stated_in_lines', 'known_from_film'], description: 'Only on `present`. "stated_in_lines" = the scene\'s subtitles show it, which is evidence from our data. "known_from_film" = the model says it is on screen from knowing the film, and our subtitles do not corroborate it.' },
            evidence_meaning: { type: 'string', description: 'The same thing in words, safe to paraphrase to a parent.' },
            both_sources_agree: { type: 'boolean', description: 'True when an independent second screener also reached the assertion threshold for this item in this scene.' },
            screener_probability: { type: ['number', 'null'], description: 'What the second screener gave this item here, when it looked at all.' },
            detail: { type: 'string', description: 'Something the vocabulary has no id for yet, e.g. a `dies` label whose detail is "a pet or animal".' },
            source: { type: 'string', description: 'The model that produced the label.' },
            review_status: { type: 'string' },
          },
        },
        Vocabulary: {
          type: 'object',
          properties: {
            taxonomy_version: { type: 'string' },
            how_to_use: { type: 'string' },
            counts: { type: 'object' },
            groups: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
  };
}
