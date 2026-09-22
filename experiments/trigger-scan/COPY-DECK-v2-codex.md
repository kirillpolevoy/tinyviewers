I’ll make the film page compact and move the technical story to the analysis page. I’ll use your padding rules, keep recorded runs at their original speed, and remove the old timing and cost figures.
The revised film page uses expandable rows, with the padded times inside each row. The analysis page keeps live runs and recordings clearly labeled. Its completed Jev panel holds still for inspection while Sonnet continues at the recorded pace, and “Skip to the result” is available only during replay.
**Revised IA.** Search and Library remain the two main parent paths. The analysis page gets its own navigation entry and a distinct Home band.

| Surface | Revised structure |
|---|---|
| **Home** | Promise → source note → search and library → analysis band. |
| **Search / film picker** | One field accepts a title or IMDb link → identify the film → open an existing guide, replay its analysis, or start a new analysis with a passcode. |
| **Film** | Title → age toggle → one quiet source-and-timing line → every scene in time order → optional filters → analysis cross-link. Rows expand in place. |
| **Analysis** | Pitch and picker → Jev’s burst → completed totals → beat exploration → Sonnet’s scene formation → saved result. |

The collapsed range uses the recorded scene boundaries. Expanded rows show **30 seconds before the start**, never before `0:00:00`, and **15 seconds after the end**.

Jev’s completed panel holds still for exploration while Sonnet continues. Exploring does not slow playback or pause a live job. Recordings follow recorded event timing; pauses are explicit. **Skip to the result** appears only during replay.

Character counts below include spaces and punctuation. Braces hold real data.

**Navigation and analysis-page name.** Pick the first pair.

| Choice | Navigation label | Page headline |
|---|---|---|
| **Recommended** | **Watch an analysis** (17) | **From subtitles to scenes, at full speed.** (40) |
| Alternative | **Inside the analysis** (19) | **See the questions behind each scene.** (36) |
| Alternative | **Watch it work** (13) | **Watch a scene guide take shape.** (31) |

Final navigation: **Search** (6) · **Library** (7) · **Watch an analysis** (17).

**Home copy, top to bottom.**

| Element | Paste-ready copy |
|---|---|
| Audience line | Scene guides for ages 5–10. |
| Headline | **Know the scene before it starts.** (32) |
| Subhead | See what could scare or upset your child, when it happens, and what is in each scene. |
| Source note | AI reads the subtitles. It does not watch the film. No person has reviewed the scenes yet. |
| Search label | Film title or IMDb link |
| Placeholder | Enter a title or paste an IMDb link |
| Search button | **Search** (6) |
| Library action | **Browse the library** (18) |
| Library support | See all films with scene guides. |
| Analysis-band headline | **Watch an analysis happen** (24) |
| Analysis-band body | Questions race across the timeline. Then scenes take shape. Watch a recorded run at its original speed, or start a new one with a passcode. |
| Analysis-band button | **Watch an analysis** (17) |

**Film page and expanding rows.** Keep the age control quiet. Default to 5–7; changing it changes the single strength mark, never which scenes appear.

| Element | Paste-ready copy |
|---|---|
| Example page title | **Finding Nemo** (12) |
| Age-control label | Strength for |
| Toggle | **Ages 5–7** (8) · **Ages 8–10** (9) |
| Scale disclosure | **What the levels mean** (20) |
| Single source-and-timing note | AI reads subtitles, not images. Times come from one release; your copy may run a few seconds earlier or later, or drift further. |
| List heading | **Every scene we found** (20) |

Example collapsed row:

> **0:24:43–0:25:39**  
> **Chased Through the Minefield** (28)  
> Shark · Explosions · Chase · Caught in danger · Panic  
> **3 · Very strong**

The whole row opens. Its accessible action label is **Show details** (12), changing to **Hide details** (12).

Expanded content:

> Bruce chases Marlin and Dory through sea mines that explode as they escape.
>
> **Be ready at** (11): **0:24:13**  
> **Scene ends around** (17): **0:25:54**
>
> **Ages 5–7:** 3 · Very strong  
> **Ages 8–10:** 2 · Strong
>
> **Was this right?** (15) · **Yes** (3) · **Something is off** (16)

The example preserves the supplied scene’s times and ratings. The shorter tags map to the existing vocabulary.

Small feedback expansion:

- Field label: **What was off?** (13)
- Placeholder: “Tell us what you noticed.”
- Button: **Send** (4)
- Success: “Feedback saved.”
- Error: “Could not save your feedback. Try again.”

**Strength wording.** Put this inside “What the levels mean,” rather than adding another block above the scenes.

> A low rating can still include your child’s fear.

| Mark | Ages 5–7 | Ages 8–10 |
|---|---|---|
| **0 · Low** | Little upset in the dialogue. | Little upset in the dialogue. |
| **1 · Mild** | Brief scare, worry, or sadness. | Brief, pretend, or comic danger or sadness. |
| **2 · Strong** | Chasing, being trapped or lost, or lasting fear. | Lasting danger, injury, or humiliation. |
| **3 · Very strong** | An attack, a child taken, or someone dying or seeming to die. | Someone dies or seems to die, a child is taken, or family is in serious danger. |

Age-four note, inside the same disclosure:

> For a 4-year-old, use 5–7; expect some scenes to feel stronger.

**Quiet filters and empty states.** Place the filter disclosure after the full list.

| Element | Copy |
|---|---|
| Disclosure | **Narrow the list** (15) |
| Instruction | Show scenes with any of these. |
| Groups | What is in it · What happens |
| Actions | **Apply filters** (13) · **Clear filters** (13) |
| Active result count | Showing {shown} of {total} scenes. |

Keep these three states separate:

| Meaning | Copy |
|---|---|
| Current filters match no listed scenes | No matches. Clear filters to see all scenes. |
| The analysis identifies no scenes | No scenes found in the subtitles. |
| The source cannot answer the question | Not checked. The subtitles cannot tell us. |

These are fallback states, not extra filter choices or per-scene lists. An unavailable rating never becomes zero.

After the scene list and filters:

**See how this was worked out** (27)

This opens that film’s recorded analysis.

**Search and adding a film.** Reuse the same field on Search and the analysis page.

| State | Paste-ready copy |
|---|---|
| Page title | **Find a film** (11) |
| Field label | Film title or IMDb link |
| Empty placeholder | Enter a title or paste an IMDb link |
| Search action | **Search** (6) |
| Searching | Finding films. |
| Title matches heading | **Choose a film** (13) |
| Match entry | {title} · {year} |
| No matches heading | **No films found** (14) |
| No matches body | Check the title or paste its IMDb link. |
| IMDb confirmation card | **{title}, {year}. Is this the one?** |
| Confirmation actions | **Use this film** (13) · **Try another film** (16) |
| Invalid IMDb link heading | **Check the link** (14) |
| Invalid-link body | That is not an IMDb film link. Paste a film link or enter its title. |
| Checking source | Looking for subtitles. |
| No subtitles heading | **No subtitles found** (18) |
| No subtitles body | We found the film, but no subtitles are available for analysis. |
| No subtitles action | **Try another film** (16) |
| Already in library | This film is already in the library. |
| Existing-film actions | **Open it** (7) · **Play its analysis** (17) |
| New film, subtitles available | Subtitles found. This film is ready to analyze. |
| New-film action | **Analyze it now** (14) |

An existing film bypasses the passcode and always uses its saved guide or recorded run.

**Passcode modal.**

| Element | Copy |
|---|---|
| Title | **Enter your passcode** (19) |
| Selected film | {title} · {year} |
| Body | Each new analysis costs real money to run. It is invite-only for now. |
| Field label | Passcode |
| Placeholder | Enter passcode |
| Primary button | **Start analysis** (14) |
| Secondary button | **Cancel** (6) |
| Empty-field error | Enter your passcode. |
| Wrong-passcode error | That passcode is not right. Try again. |
| Pending state | Checking passcode. |
| Connection error | Could not check the passcode. Try again. |

**Analysis page: pitch and picker.** Engine names, probabilities, measurements, and disagreements live here.

- **Headline:** “From subtitles to scenes, at full speed.” (40)
- **Pitch:** “Jev scans short sections of subtitles with yes-or-no questions. Sonnet reads the whole film’s subtitles and turns the findings into scenes. Watch the work, then inspect the answers.”
- **Picker label:** “Film title or IMDb link”
- **Placeholder:** “Enter a title or paste an IMDb link”
- **Picker helper:** “Choose a library film to replay its first run. New films need a passcode.”

A compact measured summary may sit below the pitch:

> Across {film_count} recorded films: {total_beats} beats, {total_answers} answers, {total_jev_seconds} seconds of combined Jev time, ${total_jev_cost_usd}.

Every total is calculated from recordings. No example values become fixed page copy.

Mode and playback copy:

| State | Copy |
|---|---|
| Recorded-run label | Recorded run · {date} · original speed |
| Recorded-run explanation | Playback follows the recorded request and response times. |
| Recording action | **Play the run** (12) |
| Finished-recording action | **Play again** (10) |
| Playback controls | **Pause** (5) · **Resume** (6) |
| Paused status | Playback paused |
| New-run label | Live |
| New-run explanation | This is the film’s first analysis. Requests, answers, timing, tokens, and cost are recorded as it runs. |

**Jev burst.** Begin as soon as the real run or recording reaches this stage. Do not add an animation delay.

- **Stage headline:** “Jev scans the subtitles” (23)
- **Introduction:** “Jev is a small, fast AI that answers yes-or-no questions with probabilities and does not write text.”
- **Setup line:** “The subtitles form {beat_count} beats, each a few lines long.”
- **Active narration:** “Jev checks every beat against {questions_per_beat} questions.”

| Instrument | Label | Value |
|---|---|---|
| Racing answer counter | Questions answered | {answers_returned} |
| Clock, displayed in tenths | Jev time | {elapsed_seconds}s |
| Cost ticker | Jev cost | ${cost_usd} |
| Concurrency | Requests in flight | {requests_in_flight} |
| Beat progress | Beats checked | {beats_checked} / {total_beats} |
| Question count | Questions per beat | {questions_per_beat} |
| Token usage | Input tokens | {input_tokens} |
| Token usage | Output tokens | {output_tokens} |
| Timeline position | Film time | {film_time} |
| Timeline key | Flagged beat | — |

The timeline stays in film order. Flags appear when the recorded answers arrive; a flag means an answer meets that question’s threshold.

Missing measurements display **“Not recorded”**, never a fabricated zero.

**The landing line.** Hold the completed Jev values still.

> Jev returns {answer_count} answers across {beat_count} beats in {elapsed_seconds} seconds, for ${cost_usd}.

Then expose the beat explorer. Sonnet’s work or recorded playback continues at its actual pace.

**Beat explorer.**

| Element | Copy |
|---|---|
| Panel title | Explore the answers |
| Empty-state headline | **Pick a beat** (11) |
| Empty-state body | Choose a beat to see its subtitle lines and every answer. |
| Selected-beat label | Beat {beat_number} · {start}–{end} |
| Subtitle panel | Subtitle lines |
| Question-list label | All questions · highest probability first |
| Question text | {question} |
| Probability label | Jev’s probability of “yes” |
| Probability value | {probability}% |
| Threshold marker | Flag threshold: {threshold}% |
| Flagged status | Flagged |
| Below-threshold status | Below threshold |
| Beat with no flags | No answers reach their flag threshold. |
| Missing answer | No answer recorded. |

One short explanation beside the bars:

> These are Jev’s estimates, not measured accuracy or a child’s chance of being scared.

Show the actual subtitle excerpt for the selected beat. This deck supplies no replacement or invented dialogue.

**Sonnet stage.**

- **Headline:** “Sonnet forms the scenes” (23)
- **Introduction:** “Sonnet is a larger language model that reads the whole subtitle file, sets scene boundaries, names scenes, and rates them for both age groups.”

Use short narration as the corresponding results arrive:

| Event | Narration |
|---|---|
| Whole-film reading starts | Sonnet reads the subtitles together. |
| Scene boundaries arrive | Scene boundaries appear on the timeline. |
| Scene details arrive | Sonnet adds names, age ratings, and what each scene contains. |
| Comparison becomes available | Differences from Jev appear beside each scene. |

Scene result labels:

- “Scene: {scene_title}”
- “Film time: {start}–{end}”
- “Ages {age_band}: {strength}”
- “What is present”
- “What happens”

Stage measurements:

- “Sonnet time: {elapsed_seconds}s”
- “Sonnet cost: ${cost_usd}”
- “Scenes formed: {scene_count}”
- “Input tokens: {input_tokens}”
- “Output tokens: {output_tokens}”

Replay action: **Skip to the result** (18).

Scene arrivals follow recorded events. If a response returns several scenes together, do not invent separate discovery times.

**Disagreement wording.** State what each model returns and what ends up in the guide.

| Recorded outcome | Copy |
|---|---|
| Sonnet identifies a detail Jev did not flag | Sonnet includes {detail}. Jev does not flag it. |
| Jev flags a detail Sonnet explicitly rejects | Jev flags {detail}. Sonnet marks it absent. |
| Jev flags a detail Sonnet simply omits | Jev flags {detail}. Sonnet does not include it. |
| Sonnet explicitly cannot decide | Sonnet cannot judge {detail} from the subtitles. |
| Saved-guide outcome | In the finished guide: {outcome}. |

Supporting evidence:

> Jev: {probability}% · threshold: {threshold}%  
> Sonnet: {recorded_judgment}

Use **Included**, **Left out**, or **Marked uncertain** for `{outcome}`, according to the saved result. Do not call a disagreement a mistake or a correction without evidence.

**Done and failure states.**

| State | Copy |
|---|---|
| Live completion headline | **Saved to the library** (20) |
| Live completion body | The scene guide and this run are saved. The next visitor opens the guide without waiting for another analysis. |
| Replay completion headline | **Replay complete** (15) |
| Replay completion body | The guide is already saved. No new analysis has run. |
| Main result link | **See the finished scene list** (27) |
| Replay action | **Play again** (10) |
| Mid-run failure headline | **The run stopped** (15) |
| Mid-run failure body | The analysis stopped before the scene guide was finished. |
| Failure action | **Retry analysis** (14) |
| Retry explanation | A retry may add to the run cost. |
| Exit action | **Library** (7) |

The film-page return link is **See how this was worked out** (27). The analysis-page result link is **See the finished scene list** (27).

**Removed from the previous deck.**

- The entire sync flow, anchor dialogue, release selector, reset controls, and sync settings.
- Separate scene-detail pages and previous/next-scene navigation.
- Engine names, probabilities, agreement badges, review-status marks, and unchecked-item lists on parent pages.
- Repeated honesty blocks and the repeating footer disclosure.
- The Home “Small moments matter, too” section and the small analysis link; the new band replaces them.
- The longer feedback form and its category checklist.
- Account, profile, and sign-up messaging.
- The old pipeline’s timing and cost figures, fixed performance estimates, artificial playback delays, and any option to rerun an existing library film.

**The three riskiest sentences in this revision.**

1. **“See what could scare or upset your child, when it happens, and what is in each scene.”**  
   “Could” allows for personal reactions. The adjacent Home note identifies subtitle-only AI analysis and the lack of human review. The copy never promises every scare is found.

2. **“Times come from one release; your copy may run a few seconds earlier or later, or drift further.”**  
   “Or drift further” avoids implying that every difference fits inside the padding. The padded labels provide preparation time; they do not promise correct alignment or safety.

3. **“Playback follows the recorded request and response times.”**  
   This requires actual recorded timing. The clock measures run time, pauses are labeled, and skipping is explicit. Neither counters nor scene arrivals may be spread out to make the demonstration more dramatic.

tokens used: 842791
