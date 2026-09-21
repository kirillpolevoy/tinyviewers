# Drafting a reference ("gold") scene list for one film

You are drafting the human-reviewable reference list used to test AI analyzers that flag movie scenes
which could frighten or upset children aged 5-10, from subtitles only. A parent will review it later.
It is the yardstick: do not pad it, do not skip real scenes, and be strict about attributes.

Working directory: /Users/kpolevoy/toddler-movies/experiments/trigger-scan

Hard rules
- Do NOT read anything under `runs/`, `ablations/`, any `scenes.*.json`, `results*.json`, `report.html`,
  or `/Users/kpolevoy/toddler-movies/claude-analysis.log`. The list must be independent of model output.
- Do not call any AI API. Create only the one output file you are told to create.

Inputs
- `data/<slug>.srt`: the subtitle track. `srt.js` exports `parseSrt(raw)` -> cues `{id:"C0001", startMs, endMs, text}`
  and `formatTime(ms)`. You MUST use the cue ids this parser assigns.
- `taxonomy-v2.js`: exports `ATTRIBUTES` (53 attribute ids, each with a narrow question and a "no" boundary)
  and `GROUPS`. Read it fully. Use ONLY these attribute ids.

Steps
1. Print and read the WHOLE transcript (page through it; do not skim only famous scenes):
   node --input-type=module -e 'import fs from "node:fs"; import {parseSrt,formatTime} from "./srt.js"; for (const c of parseSrt(fs.readFileSync("data/<slug>.srt","utf8"))) console.log(c.id, formatTime(c.startMs), c.text)'
2. Using the transcript plus your knowledge of the film, list every scene a careful parent of a 5-10
   year-old would want flagged. Bound each tightly with `start_cue`/`end_cue` around the frightening or
   upsetting part only. If the hard part is wordless, bound it with the nearest cues and say so in `note`.
   Split contiguous beats that differ in content or intensity.
3. For each scene list ALL attribute ids that truly apply AT THAT MOMENT (not retold, not imagined),
   reading each attribute's question literally, the way its "no" boundary says. Typically 1-5 per scene.
   You may use film knowledge for what is happening on screen (e.g. a character dies wordlessly), and mark
   such attributes in `visual_only` (a subset of `attributes`) when the lines themselves do not show them.
4. Give `severity_5_7` and `severity_8_10` (0-3): 0 none, 1 mild and brief, 2 sustained fear or sadness a
   sensitive child would need a parent for, 3 intense threat to life, a death, or deep grief. Ages 5-7
   are most affected by frightening creatures and looks, the dark, loud sudden events and separation from a
   parent, and are not reassured by comedy, fantasy or a later happy ending. Ages 8-10 are more affected
   by what could really happen (death, injury, abduction, guns, harm to family, humiliation) and are
   reassured by comic tone and quick rescue.
5. Add 5 CALM control ranges (`"control": true`, `attributes: []`, severities 0), each 45-120 s, spread
   across the film, where nothing should be flagged. Make one of them deliberately hard (e.g. characters
   retelling or joking about an earlier danger).

Output: a JSON array sorted by start time, items:
{ "id": "G01" (controls "K01"...), "title": "...", "start_cue": "C0031", "end_cue": "C0044",
  "start": "00:03:40", "end": "00:04:30", "attributes": ["chased", "monster_threatens"], "visual_only": [],
  "severity_5_7": 3, "severity_8_10": 2, "control": false, "evidence": ["C0035"],
  "text_visibility": "high" | "medium" | "low", "note": "why flagged; any uncertainty" }

Validate with a throwaway node script (run it, do not save it): every cue id exists, start <= end,
`start`/`end` strings match the cues, every attribute id is in taxonomy-v2.js, `visual_only` is a subset of
`attributes`, severities are 0-3, ids unique, no overlapping ranges, controls are 45-120 s. Fix failures.

Report back briefly: counts, and a short list of the scenes/attributes you were least sure about.
