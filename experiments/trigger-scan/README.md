# Trigger-scene scan: Jev vs Claude on Finding Nemo

Experiment: from subtitles only, flag scenes that could frighten or upset a 5-year-old, using a fixed
category list, with timestamps. Standalone Node scripts; nothing here touches the app or writes to
the database.

## Run

Needs `TYPESAFE_API_KEY`, `CLAUDE_API_KEY`, `OPENSUBTITLES_API_KEY` and the Supabase keys in `../../.env.local`. Node 20+.

```sh
node fetch-subtitles.js                       # data/nemo.db.srt (Supabase row) + data/nemo.sdh.srt (OpenSubtitles, hearing-impaired)
node --test                                   # parser / windowing tests
node run-jev.js --track sdh --label r1        # ~60 calls, ~2 s, under 1 cent
node run-claude.js --mode windowed --model claude-haiku-4-5 --track sdh --label r1
node run-claude.js --mode whole    --model claude-sonnet-5  --track sdh --label r1
node run-claude.js --mode describe --model claude-haiku-4-5 --from runs/<jev run>.json
node compare.js                               # scores runs/ against gold.json -> results.json
node build-report.js                          # -> report.html
```

`node run-jev.js --track sdh --only W003,W006 --print` prints raw probabilities for a few windows (smoke test).

## How it works

- `srt.js` parses the SRT into cues (`C0001`…) and cuts it into 60–120 s windows at dialogue gaps. Every timestamp in every output comes from cue ids resolved in code; no model writes a time.
- `taxonomy.js` is the single category list (12 ids) and 0–3 severity rubric, used verbatim by every analyzer and by the reference list. Two categories (`loud_sudden_sound`, `flashing_light_inferred`) can only be inferred from sound captions and are scored separately.
- **Jev** answers one yes/no per category, one severity score and one "which line is the peak" choice per window. Raw probabilities are stored, so sensitivity can be changed in `events.js` without new API calls.
- **Claude** runs three ways: the same windows as Jev, the whole transcript in one call, and "describe" — only the scenes Jev flagged, to write the parent-facing text and second-guess the flag.
- `gold.json` is the reference list (scenes + calm control ranges), drafted before any model output existed. It was drafted by Claude and needs a human pass; until then, treat scores as provisional and biased toward Claude.

## Limits

- Subtitles miss anything wordless. Flashing lights cannot be assessed from text; the caption-based categories are a weak proxy.
- Timestamps belong to the subtitle's release. The Supabase track and the Blu-ray SDH track differ by a constant ~21 s.
- One movie. Wording in `taxonomy.js` was tuned once on a handful of calm windows.
