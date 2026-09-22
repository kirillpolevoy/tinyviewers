SESSION_ID:01a0c5d8-8f59-7ed3-8057-36d294defb82
I’ll read the home page, taxonomy, and Nemo scene data, then write the architecture and copy deck. I’ll leave all files unchanged and avoid the directories you listed. Done means every screen and state has usable copy, with the limits clear at the point a parent needs them.
The current home page overpromises with “Kid-Safe,” “100+,” and “parent-reviewed.” I’ll keep its short, warm voice and replace those claims. The Nemo file also uses older tags, so I’ll preserve its real titles and times while clearly separating proposed new labels from recorded data.
Two labels need special care: “safe again at” promises too much, and syncing one line shifts the times but cannot correct a faster-running copy. I’ll recommend “scene ends around,” include copy for your requested label, and make sync success say exactly what changed.
The draft now treats “not checked,” “no matching scenes,” and a low age rating as separate states. It also keeps friendly sharks in the shark filter. One source discrepancy matters for the replay: the saved Nemo run took about 4 minutes 10 seconds and cost about $0.38, so I’ll distinguish that record from the rough estimates for a new analysis.
I recommend a scene guide for parents of kids ages 5–10: show what happens, put it in time order, and let the parent decide what matters. Keep the short, direct rhythm of “Skip the scares. Keep the joy.” Replace its promise of safety with useful detail.

I read the [current home page](/Users/kpolevoy/toddler-movies/app/page.tsx:185), [vocabulary](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/taxonomy-v3.js:102), and [Nemo scene data](/Users/kpolevoy/toddler-movies/experiments/trigger-scan/scenes.nemo.grounded.json). No files were changed.

**A. Information architecture.** The main navigation is **Search** and **Library**. The Tiny Viewers name links home. “Watch an analysis happen” is a smaller entry on the home page.

| Screen and single job | Sections, top to bottom, and the question each answers | Deliberately left out | Navigation |
|---|---|---|---|
| **Home:** help a parent find a scene guide | 1. Value and age range: “Will this help me?” 2. Short source note: “Where does this information come from?” 3. Search: “Do you have my film?” 4. Browse: “What can I read now?” 5. Short explanation of full-film coverage: “Why use this?” 6. Smaller analysis entry: “How does it work?” | Film verdicts, featured “safe” films, testimonials, accounts, fear selection | Search; Browse the library; Watch an analysis happen |
| **Library:** show every available guide | 1. Title and current film count: “What is available?” 2. All six films, alphabetically: “Where is the film I want?” Each card contains title, release year when available, and a scene link. | Recommendations, safety rankings, popularity scores, sorting controls for six items | Search; See scenes |
| **Search:** find the right film and its next available action | 1. Search field: “What am I looking for?” 2. Matching titles, with years to distinguish versions: “Is this the right one?” 3. Availability: “Can I read its scenes now?” 4. For a known film without a guide, analysis entry and passcode explanation: “How can I add it?” | A guide inferred from a similarly named film; analysis triggered merely by searching | See scenes; Analyze it now; Try another search; Browse the library |
| **Film:** let the parent scan the whole scene list | 1. Film identity and guide status: “Is this my film?” 2. Age toggle and age-four note: “How should I read these ratings?” 3. Source limits and time-sync entry: “What can I rely on?” 4. Every identified scene, in time order, with its description, tags, selected age strength, and feedback control: “What happens, and when?” 5. Optional narrowing controls: “Can I just see the things that matter to us?” | Overall score, recommended minimum age, automatic hiding of low-rated scenes, filters before the list | Sync to my player; Show details; Was this right?; Narrow the list; Clear filters |
| **Scene detail:** help a parent prepare for one moment | 1. Film link, scene title, time range: “Where am I?” 2. What happens, including relevant outcomes: “What will upset my child?” 3. Things present and events: “Is their particular fear here?” 4. Strength for both ages: “How strong might this feel?” 5. Uncertainty and unchecked details: “What might this description miss?” 6. Feedback: “Can I flag a mistake?” | Spoiler hiding, an all-clear badge, engine probabilities presented as child-risk scores | Back to scenes; Previous scene; Next scene; Sync to my player; Was this right? |
| **Live analysis:** make the work understandable as it happens | 1. Film identity and persistent Live/Replay label: “Is this happening now?” 2. Four-stage progress: “Where are we?” 3. Current action, including Jev’s question bars: “What is it checking?” 4. Timing and cost context: “Why does this take time and need a passcode?” 5. Saved result: “Can I read the scenes?” | Raw subtitle passages, developer logs, invented progress percentages, accuracy claims | See scenes; replay controls when applicable |
| **Empty and error states:** explain what is missing and the next useful action | 1. Specific outcome: “What happened?” 2. Its meaning: “Does this mean the film has no scary scenes?” 3. Recovery: “What can I do now?” | Generic “Something went wrong,” green reassurance, automatic paid retries | Clear filters; Try again; Try another search; Browse the library, according to the failure |

The three overlays have simple sequences:

- **Passcode:** why it is needed → entry → start or correction.
- **Sync:** source release → reference line → player time → proposed shift → result.
- **Feedback:** yes or something is off → optional detail → saved or retry.

Keep navigation state useful: returning from a scene preserves the parent’s age selection, filters, and scroll position. Previous/next scene follows the film’s full chronological list.

**Honesty placement.** Put one short AI/subtitle note beside the home-page promise. Show the fuller explanation before the first scene on a parent’s first film or scene visit; retain a compact source status and a way to reopen it afterward. Put release differences and playback drift inside sync. Put scene-specific unknowns beside that scene’s details. Introduce the engines and their costs in the analysis view. The footer is a short reminder, never the sole disclosure.

I would change two parts of the owner’s flow:

1. **Replace “Safe again at” with “Scene ends around.”** A subtitle-derived endpoint cannot establish that a child is safe to resume. The deck below also supplies the requested owner wording, with a visible qualification.
2. **Describe the one-line sync as a time shift.** It fixes a starting offset. It cannot also correct a faster-running release. Correcting that would require another timing reference later in the film. The copy below works with the current one-line flow.

Two source findings also affect what can be claimed:

- The Nemo file has **30 scenes using the older taxonomy**. It does not establish complete coverage under the new presence vocabulary. The proposed v3 tags below are editorial mappings, not recorded v3 results.
- That saved run records **about 4 minutes 10 seconds and $0.38 total**. Use the brief’s speed and cost figures as rough estimates for new work, not as measurements of this replay.

**B. Copy deck.** Counts in parentheses are characters, including spaces and punctuation. They are not part of the displayed copy. Braces identify values supplied by the application.

**B1. Shared navigation and conventions.** Use American spelling: *analyze, analyzed, analyzing*.

| Element | Copy |
|---|---|
| Brand/home link | **Tiny Viewers** (12) |
| Main navigation | **Search** (6); **Library** (7) |
| Library card action | **See scenes** (10) |
| Return to library | **Back to library** (15) |
| Return from scene | **Back to scenes** (14) |
| Previous scene | **Previous scene** (14) |
| Next scene | **Next scene** (10) |
| Dismiss overlay | **Close** (5) |
| Cancel action | **Cancel** (6) |
| Retry action | **Try again** (9) |
| Finished with overlay | **Done** (4) |

Use sentence case for interface copy. Preserve the film and scene titles supplied by the data. Use `0:24:43` for displayed times, consistently.

**B2. Home.** Exactly two main paths appear together: search and library. The analysis entry has less visual weight.

| Element | Copy |
|---|---|
| Audience line | Scene guides for ages 5–10. |
| Headline | **Know the scene before it starts.** (32) |
| Subhead | A friendly shark can still be scary. See what is in each scene, what happens, and when to expect it. |
| Age explanation | Each scene has a strength rating for ages 5–7 and 8–10. You know what worries your child. |
| Visible source note | AI reads the subtitles. It does not watch the film. No person has reviewed the scenes yet. |
| Search label | Film title |
| Search placeholder | Try Finding Nemo |
| Search button | **Search** (6) |
| Second main action | **Browse the library** (18) |
| Library support line | Six films with scene guides, ready to read. |
| Access line | No account. No sign-up. |
| Supporting headline | **Small moments matter, too.** (26) |
| Supporting body | We check the whole subtitle file and list every scene the AI flags, with times tied to the dialogue. That includes smaller moments and films with little written about them. |
| Smaller entry | **Watch an analysis happen** (24) |
| Smaller-entry support | See two AI tools build a scene guide. Saved replays are open to everyone. |

Home metadata:

- **Title:** `Tiny Viewers | Scary scenes, with times` — **39 characters**
- **Description:** `Find scary or upsetting scenes with subtitle-based times and age guides for 5–7 and 8–10. See what happens, then choose what to skip.` — **133 characters**

**B3. Library.** Present all six films alphabetically.

- **Page title:** “Film library” (12)
- **Introduction:** “Six films with scene guides, ready to read.”
- **Supporting line:** “Open a film to see the full list of scenes found in its subtitles.”

| Card title | Characters | Action |
|---|---:|---|
| Finding Nemo | 12 | See scenes |
| Frankenweenie | 13 | See scenes |
| Monsters, Inc. | 14 | See scenes |
| The Iron Giant | 14 | See scenes |
| The Lion King | 13 | See scenes |
| The Wild Robot | 14 | See scenes |

Card status: “Scene guide ready.”

Loading text: “Loading the library.”

Use the current library count to generate the introduction as the collection grows.

**B4. Search and the not-yet-analyzed film.** Searching does not start an analysis.

| Element/state | Copy |
|---|---|
| Initial page title | **Search for a film** (17) |
| Field label | Film title |
| Placeholder | Try Finding Nemo |
| Button | **Search** (6) |
| Blank submission | Enter a film title. |
| Loading text | Searching for films. |
| Results page title | **Search results** (14) |
| Results context | Results for “{query}”. |
| Available result status | Scene guide ready |
| Available result action | **See scenes** (10) |
| Unavailable guide heading | **Not analyzed yet** (16) |
| Unavailable guide body | There is no scene guide for {film} yet. With a passcode, you can start one. Allow a few minutes. |
| Analysis action | **Analyze it now** (14) |
| Access explanation | New analyses are invite-only because each one costs money to run. The library and saved replays are open to everyone. |
| Alternative destination | **Browse the library** (18) |

A matching, analyzed film opens its film page. If several titles match, let the parent choose the title and year first.

For a title the search cannot identify:

- **Heading:** “We could not find that title” (28)
- **Body:** “Check the spelling or try the full film title.”
- **Actions:** “Try another search” (18); “Browse the library” (18)

Do not offer to analyze an unidentified title.

**B5. Passcode modal.** Opening the modal is not the paid action; the submit button starts it.

| Element | Copy |
|---|---|
| Title | **Enter your passcode** (19) |
| Film context | Start a scene guide for {film}. |
| Body | New analyses are invite-only for now. The passcode helps us limit the cost of running them. |
| Field label | Passcode |
| Placeholder | Enter passcode |
| Primary button | **Start analysis** (14) |
| Secondary button | **Cancel** (6) |
| Pending button | **Checking passcode** (17) |
| Empty field error | Enter your passcode to start. |
| Wrong passcode | That passcode is not right. Try again. |
| Check unavailable | We could not check that passcode. Try again. |
| Access reminder | You can read the library and replay saved analyses without a passcode. |

If another visitor finishes the guide before submission:

- **Heading:** “The scenes are ready” (20)
- **Body:** “This film is already in the library. You can open its scene guide now.”
- **Button:** “See scenes” (10)

**B6. Film page.** The default view includes every recorded scene, including scenes rated zero for the selected age.

For the supplied Nemo record:

| Element | Copy |
|---|---|
| Page title | **Finding Nemo** (12) |
| Release year | 2003 |
| Page descriptor | Scene guide |
| Scene count | 30 scenes found |
| Source status | Made from subtitles |
| Review status | Not yet reviewed by a person |
| Age-control label | Show strength for |
| Age choices | **Ages 5–7** (8); **Ages 8–10** (9) |
| Age helper | This changes the strength shown beside each scene. All scenes stay in the list. |
| Age-four note | For a 4-year-old, 5–7 is the closest guide. Expect it to understate some scares or upset. |
| Scale link | **What the levels mean** (20) |
| Timing status before sync | Times from our copy |
| Timing helper | Your player may show different times. |
| Timing action | **Sync to my player** (17) |
| Scene-list heading | **Every scene we found** (20) |
| List introduction | In time order. Descriptions include what happens and how scenes end. |

The source explanation, shown at the first meaningful scene view:

- **Heading:** “What this guide can miss” (24)
- **Body:** “AI reads the subtitles; it does not watch or listen to the film. Things shown without words, frightening faces, flashing lights, and sounds may be missed. No person has reviewed these scenes yet.”

The first three scene rows demonstrate the default chronological list:

| Scene title | Time | Description | Ages 5–7 | Ages 8–10 |
|---|---|---|---|---|
| **Barracuda Attack** (16) | 0:03:06–0:03:42 | A barracuda attacks the family’s home. Marlin tries to protect Coral and their eggs. | 3 · Very scary or upsetting | 2 · Scary or upsetting |
| **Coral Is Gone** (13) | 0:03:46–0:04:57 | Marlin searches for Coral and finds only one surviving egg. He grieves and promises to protect his son. | 2 · Scary or upsetting | 3 · Very scary or upsetting |
| **Playground Teasing About Nemo’s Fin** (35) | 0:09:10–0:09:38 | Other young fish tease Nemo about his small fin. A classmate tells them to be nice. | 1 · A little scary or sad | 1 · A little scary or sad |

These are examples of row copy, not a three-scene limit. Continue through all 30 records.

Each row also contains:

- “What is in it” with the applicable presence labels.
- “What happens” with the applicable event labels.
- “Show details” (12).
- “Was this right?” (15).
- A specific uncertainty indicator when supported by the record.

Use “Hide details” (12) if details expand within the row.

**B7. Optional filters.** Put the entry after the unfiltered list. Opening it is a deliberate choice.

| Element | Copy |
|---|---|
| Entry and panel title | **Narrow the list** (15) |
| Introduction | Only want certain scenes? Choose what matters to your child. |
| Selection rule | Show scenes with any of these. |
| First group | **What is in it** (13) |
| Second group | **What happens** (12) |
| Apply button | **Apply filters** (13) |
| Reset button | **Clear filters** (13) |
| Filtered-list heading | **Scenes matching your filters** (28) |
| Result count | Showing {shown} of {total} scenes. |
| Return action | **Show all scenes** (15) |

Only offer labels found in that film. Combine selected labels with **any**, so choosing shark and chase returns scenes containing either.

Presence-label explanation:

> Friendly, funny, and imagined appearances count, too. The description explains what happens.

A scene about something only being mentioned remains in the full list, but it does not count as that thing being present.

**B8. Strength scale.** Use the same four short labels for both age bands. The explanations describe how the bands differ.

- **Heading:** “How strong is this scene?” (25)
- **Introduction:** “These are AI estimates from the subtitles. A low number can still include something your child fears.”
- **Supporting line:** “The examples below explain the levels. They are not fixed rules for every child.”

| Level | Label | Ages 5–7 explanation | Ages 8–10 explanation |
|---|---|---|---|
| **0** | **Little upset** | The dialogue seems calm or light. A creature or topic may still bother your child. | The dialogue seems calm or light. A creature or topic may still bother your child. |
| **1** | **A little scary or sad** | A brief scare, surprise, worry, or sad moment. | Danger or sadness that is brief, pretend, or played for laughs. |
| **2** | **Scary or upsetting** | A chase, being trapped or lost, darkness, or crying that lasts. | Someone is hurt, humiliated, or in danger for a while. |
| **3** | **Very scary or upsetting** | An attack, a child taken from a parent, or someone dying or seeming to die. | Someone dies or seems to die, a child is taken, or a family member is in serious danger. |

For an unavailable rating:

- **Value:** “Not checked”
- **Explanation:** “The subtitles do not give enough detail to rate this scene.”

Never substitute zero for an unavailable rating. Do not force the older age band to have a lower score; the Nemo data contains scenes rated more strongly for older children.

**B9. Tag vocabulary.** Keep the three distinctions clear: things present, events happening, and context. The IDs below are handoff keys; parents see only the labels.

These are the recommended presence labels:

| ID | Parent-facing label |
|---|---|
| `monster_creature` | Monster or strange creature |
| `ghost_spirit` | Ghost or spirit |
| `reanimated_dead` | Something dead brought back to life |
| `skeleton_corpse` | Skeleton or dead body |
| `shark` | Shark |
| `spider_insect` | Spider or insect |
| `snake_reptile` | Snake or lizard |
| `large_predator` | Large hunting animal |
| `rodent_bat` | Rat, mouse or bat |
| `clown_doll_puppet` | Clown, doll, puppet, mannequin or mask |
| `robot_machine_being` | Robot or machine creature |
| `witch_magic_villain` | Witch, wizard, curse or frightening magic |
| `alien` | Alien |
| `scary_appearance` | A frightening appearance |
| `gun` | Gun |
| `blade_weapon` | Knife, sword or other weapon |
| `fire` | Fire |
| `explosion` | Explosion or bomb |
| `storm_lightning` | Storm, lightning or flood |
| `deep_dark_water` | Deep or dark water |
| `heights` | Dangerous height |
| `darkness` | Darkness |
| `needle_medical` | Needle or medical tool |
| `hospital_illness` | Hospital, medical care or serious illness |
| `blood_wound` | Blood or an open wound |
| `vehicle_crash` | Vehicle out of control or crashing |
| `cage_net_trap` | Cage, net or trap |
| `graveyard_funeral` | Graveyard or funeral |
| `dangerous_machine` | Dangerous machinery or electricity |

Presence group labels are **Creatures and characters** and **Things and places**. Avoid “on screen,” which would imply the visuals were checked.

These are the recommended event labels:

| ID | Parent-facing label |
|---|---|
| `chased` | Someone is being chased |
| `attacked` | Someone is being attacked |
| `weapon_used` | Someone is threatened or attacked with a weapon |
| `falling` | Someone is falling |
| `drowning` | Someone cannot breathe |
| `caught_in_hazard` | Someone is caught in danger |
| `vehicle_accident` | A vehicle crash is happening |
| `battle` | A battle or attack on many people |
| `captured` | Someone is being caught |
| `trapped_struggling` | Someone is trapped and struggling |
| `injured` | Someone is hurt |
| `dies` | Someone dies |
| `believed_dead` | Someone thinks a loved one has died |
| `parent_death_learned` | A child loses a parent |
| `grieving` | Someone is grieving |
| `child_taken` | A child is taken from a parent |
| `child_lost` | A child and parent are separated and calling out |
| `abandoned` | Someone is sent away or left behind |
| `family_in_danger` | A family member is in danger |
| `parents_fighting` | A child’s parents argue or talk about splitting up |
| `rages_at_child` | An adult yells angrily at a child |
| `threatens_harm` | Someone threatens to hurt someone |
| `bullying` | Someone is mocked or excluded |
| `discrimination` | Someone is treated badly for who they are |
| `caregiver_cruelty` | A caregiver is cruel to a child |
| `betrayal` | A trusted adult turns on a child |
| `transformation` | Someone changes into something frightening |
| `nightmare` | A nightmare or frightening vision |
| `unseen_threat` | Something unseen is near |
| `jump_scare` | A sudden scare |
| `terrified` | Someone is terrified |
| `sobbing_despair` | Someone cries or loses hope |
| `animal_cruelty` | An animal is mistreated |
| `animal_in_danger` | An animal is in danger |
| `dangerous_act` | A child does something dangerous |
| `runs_away` | A child runs away or goes off with a stranger |
| `slapstick_violence` | Violence played for laughs |

If event subgroups are needed, use: **Danger; Violence; Death and loss; Family and separation; Injury; Caught or trapped; Uneasy moments and sudden scares; Threats and cruel behavior; Fear and upset; Animals; Risky things a child might copy.**

Keep “Risky things a child might copy” separate from the strength score.

Context appears under **“More about this scene” (21)**:

| ID | Parent-facing label |
|---|---|
| `retold` | Told as a story |
| `imagined` | Imagined or dreamed |
| `comic` | Played for laughs |
| `child_victim` | A child is in trouble |
| `animal_victim` | An animal is in trouble |
| `reassured` | Someone is comforted or rescued |

Use **“Talked about” (12)** for mentions. A remembered attack must not become “Someone is being attacked.” A friendly or dreamed shark still counts as a shark.

Tooltips for labels whose boundaries need explanation:

| Label | Tooltip |
|---|---|
| A frightening appearance | Someone reacts to how a character looks. We have not checked the appearance itself. |
| Needle or medical tool | Includes injections, surgical tools, and a dentist’s drill. |
| Someone is threatened or attacked with a weapon | Includes a weapon being pointed at someone. |
| Someone is hurt | Includes being stung, burned, wounded, or knocked unconscious. |
| A child loses a parent | A child sees or learns that a parent or caregiver has died. |
| An animal is in danger | Used for animals that cannot speak. Talking animal characters are covered by the other scene labels. |
| Risky things a child might copy | These actions may be worth discussing even when the scene has a low strength rating. |

**B10. Scene detail.** This example preserves the recorded title, times, and age scores.

- **Page title:** “Chased Through the Minefield” (28)
- **Film link:** “Finding Nemo” (12)
- **Description:** “Bruce the shark chases Marlin and Dory through old sea mines. The mines explode as they try to get away.”

Recommended timing block:

| Label | Value |
|---|---|
| **Be ready at** (11) | 0:24:43 |
| **Scene ends around** (17) | 0:25:39 |

Visible timing note:

> These times follow the subtitles. Images or sounds may start earlier or continue later.

Action: **“Sync to my player” (17)**.

For the owner’s requested version, the second label is **“Safe again at” (13)**, with this immediately underneath:

> This is the estimated end of this scene. Scary images or sounds may continue.

I would still replace that label before launch; the qualification does not remove its reassuring implication.

The remainder of the detail page:

| Section | Copy |
|---|---|
| **What is in it** (13) | Shark · Explosion or bomb |
| **What happens** (12) | Someone is being chased · Someone is caught in danger · Someone is terrified |
| **How strong is this scene?** (25) | Ages 5–7: **3 · Very scary or upsetting**. Ages 8–10: **2 · Scary or upsetting**. |
| Subtitle uncertainty | Some details are hard to judge from the subtitles. |
| Comparison status | Agreement not recorded |
| Comparison explanation | This saved guide does not include a comparison for these details. |
| **Not checked** (11) | Scary faces — Not checked. Flashing lights — Not checked. Images with no clue in the subtitles — Not checked. How loud or sudden sounds feel — Not checked. |
| Feedback entry | **Was this right?** (15) |

The presence and event labels above are proposed mappings from the saved description. They must not be presented as newly confirmed v3 output.

A second example establishes why presence and strength are separate:

- **Title:** “Sharks Visit the School” (23)
- **Time:** `1:31:21–1:31:43`
- **Description:** “Bruce and the other sharks visit Nemo’s school. Their arrival is a surprise, but they are friendly.”
- **Presence label:** “Shark”
- **Ages 5–7:** “1 · A little scary or sad”
- **Ages 8–10:** “0 · Little upset”

The shark label remains visible at zero.

**B11. Agreement and uncertainty.** Attach agreement to the particular thing or event being identified. It does not establish agreement about scene boundaries or age ratings.

| State | Display copy | Explanation |
|---|---|---|
| Both checks identify a detail | **Both AI checks found this** (25) | Jev and Sonnet both found signs of this in the subtitles. Neither watched the film. |
| Only one identifies it | **One AI check found this** (23) | Jev and Sonnet disagree about this detail, so it is less certain. |
| Scene contains disputed details | **AI checks differ** (16) | Some details in this scene are less certain. Open the scene to see which ones. |
| Comparison unavailable | **Agreement not recorded** (22) | This saved guide does not include a comparison for this detail. |
| Insufficient evidence to judge | **Not checked** (11) | The subtitles do not give us enough information to judge this. |

Disclosure control: **“Why less certain?” (17)**.

Do not manufacture agreement from the older Nemo file’s probability values. A missing comparison is not a disagreement.

**B12. Scene feedback.** Put this on every scene, including the list view.

- **Prompt:** “Was this right?” (15)
- **Actions:** “Yes” (3); “Something is off” (16)

After “Yes”:

> Thanks. Your feedback is saved.

After “Something is off”:

- **Title:** “What needs changing?” (20)
- **Instruction:** “Choose what was off.”
- **Choices:** “The time”; “What is in the scene”; “What happens”; “The age rating”; “Something is missing”.
- **Optional field label:** “What should change? (optional)”
- **Placeholder:** “Tell us what you noticed.”
- **Buttons:** “Send feedback” (13); “Cancel” (6)

Success:

- **Heading:** “Thanks for checking” (19)
- **Body:** “Your feedback is saved. It does not change the guide yet.”

Failure:

> Your feedback was not saved. Please try again.

Do not turn a parent’s “Yes” into “Reviewed by a person.”

**B13. Sync flow.** The guide’s times shift; the site does not control the player.

**Opening.**

- **Title:** “Sync to my player” (17)
- **Body:** “Find one line in your copy of the film. Enter the time your player shows, and we will shift every scene time by the same amount.”
- **Source:** “Timing source: Finding Nemo (2003), Blu-ray subtitle track.”
- **Limit, visible before submitting:** “Some releases run faster or slower. One sync cannot keep those times lined up throughout the film.”

**Step 1.**

- **Heading:** “Find this line” (14)
- **Instruction:** “Play your copy and pause when this line starts.”
- **Reference:** **“It’s okay. Daddy’s here.”**
- **Reference time:** “Our copy: 0:04:43”
- **Scene context:** “This line is in an upsetting scene. Set this up before your child watches.”

This is the only subtitle quotation in the deck.

**Step 2.**

- **Heading:** “Enter your player time” (22)
- **Field label:** “Time on your player”
- **Placeholder:** `0:04:43`
- **Helper:** “Use minutes:seconds or hours:minutes:seconds.”
- **Shift preview:** “Every scene time will move {offset} later.”  
  For a negative offset: “Every scene time will move {offset} earlier.”
- **Primary button:** “Shift times” (11)
- **Secondary button:** “Cancel” (6)

Validation:

| Condition | Message |
|---|---|
| Empty | Enter the time shown on your player. |
| Invalid format | Use minutes:seconds or hours:minutes:seconds, such as 4:43. |
| Invalid seconds/minutes | Check the minutes and seconds. Each must be between 00 and 59 when you include hours. |
| Implausibly large shift | That is a large change from 0:04:43. Check that you found the same line and entered the player time. Your times have not changed. |

For a large but valid shift, use **“Check that time” (15)** and offer **“Use this time” (13)** or **“Keep current times” (18)**. A large offset is a reason to check, not proof that the parent is wrong.

**Success.**

- **Heading:** “Times shifted” (13)
- **Body:** “We moved every scene time {offset} later.”  
  For a negative offset: “We moved every scene time {offset} earlier.”
- **Anchor explanation:** “The shift lines up with the dialogue time you entered.”
- **Drift reminder:** “If your copy runs faster or slower, the times may drift later in the film. Check your player before relying on a scene time.”
- **Button:** “Done” (4)

When the entered time matches the reference:

> This line is at the same time in both copies. No shift was needed.

Persistent film-page status:

> Times shifted {offset} later.

Actions:

- **Sync again** (10)
- **Reset times** (11)

Reset confirmation:

- **Heading:** “Times reset” (11)
- **Body:** “The guide is showing the original subtitle times again.”

“Sync again” corrects an entry or changes to a different copy. Do not describe repeating the same anchor as a fix for playback-speed drift.

**B14. Analysis entry and live view.** Replays and new analyses share the explanation, but their status must remain distinct.

Public entry:

- **Page title:** “Watch an analysis happen” (24)
- **Introduction:** “See how two AI tools turn subtitles into a scene guide.”
- **Section title:** “Choose an analysis to replay” (28)
- **Body:** “Pick a film to see its saved analysis unfold. No passcode needed.”
- **Choices:** The six library films.
- **Action on each:** “Replay analysis” (15)

New-analysis title:

> **Analyzing {film}**

For Finding Nemo: **“Analyzing Finding Nemo” (22)**. Other title lengths are 10 plus the film-title length.

Persistent status: **“Live”**.

Replay title:

> **Replaying {film}**

For Finding Nemo: **“Replaying Finding Nemo” (22)**.

Persistent status: **“Replay”**.

Persistent replay explanation:

> This is a saved analysis. No new analysis is running.

The four stages:

| Stage headline | Narration |
|---|---|
| **Subtitles loaded** (16) | The subtitle file is ready. Its dialogue times will anchor the scene guide. |
| **Jev checks short sections** (25) | The subtitles are split into sections of a few lines. Jev checks each section for things like a shark, a chase, or someone getting hurt. |
| **Sonnet builds the scene list** (28) | Sonnet reads the whole subtitle file and works out where scenes begin and end. It names them, rates them for both age groups, and checks what is present. We compare its findings with Jev’s and mark details they disagree on. |
| **Saved to the library** (20) | The scene guide is saved. The next visitor can open it straight away. |

While finding the subtitle file:

> Finding subtitles for {film}.

Introduce the engines once each:

> **Jev is a small, fast AI that answers narrow yes-or-no questions with an estimate of how likely “yes” is.**

Follow with:

> It does not write scene descriptions.

Then:

> **Sonnet is a larger AI that reads the whole subtitle file, builds the scenes, and estimates how strong each one may feel.**

Jev’s bars:

| Element | Copy |
|---|---|
| Current section | Section {number} of {total} |
| Bar heading | Jev’s estimate |
| Example question | Is a shark there? |
| Example question | Is someone being chased? |
| Bar value | {probability}% |
| Visible explanation | How likely Jev thinks the answer is yes, based on these subtitle lines. |
| Tooltip | This is not the chance that a child will be scared, or a measure of proven accuracy. |

Only display actual questions, outputs, and progress received from the analysis. Do not invent a percentage for Sonnet’s overall progress.

Timing and cost for a **new** analysis:

| Engine | Copy |
|---|---|
| Jev | Estimate: about 3 seconds and $0.03 per film. |
| Sonnet | Estimate: about 2 minutes and $0.20 per film. |
| Explanation | These are Tiny Viewers’ running costs. Time and cost vary by film. |

For the supplied **Nemo replay**, use its recorded total instead:

> This saved run took about 4 minutes 10 seconds and cost about $0.38.

Do not show estimated stage timings as if they were measured in that saved run.

Successful new-analysis completion:

- **Count:** “{count} scenes found.”
- **Review status:** “Not yet reviewed by a person.”
- **Action:** “See scenes” (10)

Replay completion:

> This guide is already saved. Open the scene list now.

Replay controls:

- **Pause replay** (12)
- **Resume replay** (13)
- **Start replay again** (18)
- **Skip to scenes** (14)

Slow-analysis message:

> Still working. Some films take longer. Keep this page open.

**B15. Empty and error states.** These states describe the evidence or failure without implying that the film is free of upsetting material.

| State | Headline | Body | Action |
|---|---|---|---|
| Filter returns nothing | **No scenes match these filters** (29) | Clear the filters to see every scene in this guide. This result does not mean the film has nothing upsetting. | **Clear filters** (13) |
| Detail cannot be judged | **We cannot judge this from subtitles** (35) | The subtitle file does not give enough detail. This stays marked “Not checked.” | **Show all scenes** (15), when shown at film level |
| Analysis completes with zero scenes | **No scenes were flagged** (22) | The AI did not flag any scenes in this subtitle file. Images, sounds, or moments it missed may still upset a child. | **Browse the library** (18) |
| No subtitles available | **No subtitles found** (18) | We could not find subtitles for {film}. We need them to build a scene guide. Nothing has been added to the library. | **Try another search** (18); **Browse the library** (18) |
| Analysis fails after starting | **The analysis stopped** (20) | We could not finish the scene guide. No complete guide has been saved. | **Try again** (9); **Back to library** (15) |
| Analysis finishes but saving fails | **We could not save the guide** (27) | The analysis finished, but the guide was not saved to the library. Keep this page open and try saving again. | **Try saving again** (16) |
| Replay cannot load | **The replay could not load** (25) | We could not load the saved analysis steps. You can still open the scene guide. | **See scenes** (10); **Try again** (9) |
| Search service fails | **We could not search right now** (29) | Your search did not finish. Try again, or open the library. | **Try again** (9); **Browse the library** (18) |
| Library fails to load | **We could not load the library** (29) | The film list did not load. Please try again. | **Try again** (9) |
| Library is actually empty | **No films here yet** (17) | Scene guides will appear here once an analysis is saved. | **Search** (6) |
| Film page fails to load | **We could not load this page** (27) | The scene guide did not load. Please try again. | **Try again** (9); **Back to library** (15) |
| Scene request fails | **We could not load this scene** (28) | The scene details did not load. Please try again. | **Try again** (9); **Back to scenes** (14) |
| Scene ID no longer exists | **This scene is not available** (27) | Open the film’s scene list to find the current guide. | **Back to scenes** (14) |

A filter built solely from the current film’s findings should normally have a match. Keep the empty-filter state for old links or selections invalidated by an updated guide; do not add absent categories just to populate the filter menu.

Show “You can still open the scene guide” only when that saved guide is available. Keep missing subtitles distinct from a temporary analysis failure: a retry button is not useful when the required source is absent.

**B16. Footer.** Keep this short and consistent.

> Made by AI from subtitles. Images and sounds are not checked directly. No person has reviewed the scenes yet.

Footer links: **Library** (7); **How this works** (14).

“How this works” opens the existing explanation and analysis view; it does not require another top-level page.

**C. Voice guide.** Keep the production voice’s brevity and warmth, while replacing broad reassurance with specifics.

| Rule | Do | Don’t |
|---|---|---|
| **1. Start with the parent’s next action.** | “See scenes.” | “View Analysis.” |
| **2. Name what happens.** | “A shark chases Marlin and Dory.” | “Contains intense peril.” |
| **3. Keep the warmth, drop the promise.** | “Know the scene before it starts.” | “Discover safe, joyful movies for your little one.” |
| **4. Explain a rating without making a decision for the parent.** | “Ages 5–7: Scary or upsetting.” | “Suitable for ages 5 and up.” |
| **5. Name the source and its limits plainly.** | “AI reads the subtitles. No person has reviewed the scenes yet.” | “Parent-reviewed content” or “AI-powered peace of mind.” |
| **6. Make empty results precise.** | “No scenes match these filters.” | “Nothing to worry about.” |
| **7. Describe what the tool actually changed.** | “We moved every scene time {offset} later.” | “Your film is perfectly synced.” |

Use direct words such as *dies, hurt, scared,* and *left behind*. Parents are reading to prepare; euphemisms make that harder.

**D. Words to avoid.** The replacements should match the actual state rather than mechanically swapping one phrase for another.

| Avoid | Use |
|---|---|
| Kid-safe; safe for children | Scene guide for ages 5–10 |
| Safe again at | Scene ends around |
| Perfect for little ones | Describe the particular scenes |
| Every scary scene; nothing missed | Every scene we found in the subtitles |
| None, when something cannot be judged | Not checked |
| Nothing scary found | No scenes were flagged in this subtitle file |
| AI-powered | AI reads the subtitles |
| Trigger | The specific thing: shark, darkness, someone being chased |
| Content warning | What happens |
| Severity | How strong is this scene? |
| Peril | Danger, or the specific event |
| Distress | Fear and upset |
| Captivity | Caught or trapped |
| Confidence score | Jev’s estimate, with the question shown |
| Verified; confirmed safe | State what the AI checks found |
| Curated; parent-reviewed | Scene guide ready |
| Age-appropriate | Strength for ages 5–7 or 8–10 |
| Exact skip times | Times tied to the subtitles |
| Synced perfectly | Times shifted |
| Personalized | Choose what matters to your child |

**E. The three riskiest sentences or labels in this deck.**

1. **“We check the whole subtitle file and list every scene the AI flags.”**  
   A parent could hear “nothing is missed.” The sentence limits completeness to what the AI flags, identifies the source, and sits beside the visible explanation that the film itself is not watched. Avoid shortening it to “Every scary scene.”

2. **“Safe again at 0:25:39.”**  
   This is the owner’s requested wording, and the highest-risk label. I supplied the visible qualification that it is an estimated scene ending and images or sounds may continue. I do not think that hedge is enough; the recommended wording is **“Scene ends around.”**

3. **“The shift lines up with the dialogue time you entered.”**  
   A parent could assume the whole film now matches. The sentence specifies the single anchor, and the same success view explains that faster or slower releases can drift later. The success heading is **“Times shifted,”** which states the operation without promising lasting accuracy.

tokens used: 448134
