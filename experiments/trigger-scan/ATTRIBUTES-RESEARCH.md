# Are these the right attributes for ages 5-10?

Research done 2026-09-20. The attribute set it produced is `taxonomy-v2.js`.

## Findings

1. **One severity scale for 5-10 is not defensible; use two bands, 5-7 and 8-10.** Cantor's fright
   research, Kijkwijzer (6 / 9), Common Sense Media (5-7 / 8-9) and BBFC (U vs PG ~ age 8) all break
   at 7-8. Ages 3-7 fear fantasy characters, transformations, how things look, the dark, animals, loud
   noise. Ages 8-11 fear things that could really happen: death, injury, abduction, guns, war,
   disasters, harm to family, humiliation. 8-10 is not simply "tougher": fears and scary dreams peak
   at 7-9, and 76% of children (mean age 8.5) report a media fright.
2. **Subtitles cannot see the main fear driver for 5-7s: appearance** (grotesque characters,
   transformations, distorted faces and bodies). A subtitle-only 5-7 score is incomplete by design
   and needs a second signal (video frames, or imported Common Sense Media / IMDb / DoesTheDogDie
   data). Attributes marked `textBlind` in the taxonomy are the affected ones.
3. **Flashing lights cannot be inferred from captions at all.** The standard (ITU-R BT.1702) is a
   pixel measurement: more than 3 flashes per second over more than 25% of the screen. A caption
   like "[explosion]" names a sound. Do not label any subtitle output as photosensitivity data.
   Captioners also omit sounds whose source is visible, so sound cues are under-reported.
4. **Gaps in the first proposal, now added:** family member in danger or ill; realistic threats
   (guns, war, abduction); parents fighting; caregiver cruelty; humiliation and exclusion;
   discrimination; phobia animals and uncanny figures (clowns, dolls); jump scares; animals in
   danger; disfigured bodies. Dropped or merged: "under attack", "fighting" + "hit by another",
   orphaned + abandoned, the panic/terror pair, flash detection.
5. **Modifiers that change impact:** happening now vs retold or imagined; fantasy vs could really
   happen; everyday setting (raises lasting fear); who the victim is (child, parent, animal);
   whether characters show fear; duration; reassurance within the scene; comic tone. Comic tone,
   fantasy and animation lower impact for 8-10 only. For under-7s they do little, and "it's not
   real" does not work; a happy ending at the end of the film does not rescue an earlier scene.
6. **Copyable risk is an imitation harm, not a fright harm** (BBFC, Kijkwijzer, AACAP treat it
   separately). Report it beside the scare score, not inside it.
7. **Profanity, romance and substance use:** excluding them from a scare score is right; excluding
   them from the product is not. Every rating system carries them, parents expect them, and
   profanity is the one thing subtitles detect almost perfectly. Ship as a separate pack.

## Sources actually read

Cantor, "Fear and the Media" (encyclopedia.com summary of her research programme); Valkenburg,
Beentjes, Nikken & Tan 2002, "Kijkwijzer: The Dutch rating system" (full text); Kijkwijzer site
(2025 archive copy); Common Sense Media age criteria pages for 5-7, 8-9, 10-12 and its rating
questions; BBFC 2024 Classification Guidelines, U and PG pages, Threat & Horror guide; MPA common
descriptors; DoesTheDogDie category list (2024 archive copy); IMDb Parents Guide help; Kids-In-Mind
(archive copy); AACAP Facts for Families #90; MediaSmarts "Dealing with fear and media"; ITU-R
BT.1702-3; Netflix timed-text style guide and DCMP captioning key.
Abstracts only: Custers & Van den Bulck 2012; Valkenburg, Cantor & Peeters 2000; Muris et al. 1997
and 2000; Cantor et al. 2010. Not read: Cantor's book "Mommy, I'm Scared"; the current Kijkwijzer
questionnaire (not public); Australian Classification site (timed out).

## Suggested test films (content notes unverified)

The Lion King, Finding Nemo, Coraline, Up, Matilda, Home Alone, E.T., The Iron Giant. Together they
exercise every group except discrimination.

## First run of the universal set on Finding Nemo

Same scenes found as the Nemo-specific questions (96%), more false flags (39 min flagged vs 33;
3 of 6 calm controls vs 2; category labels right 40% vs 48%), $0.033 per film. Attributes for themes
the film does not contain (guns, ghosts, fire, war, parents fighting, illness) stayed silent, which
is the property a universal set needs. Noisiest at p >= 0.7: `jump_scare`, `family_in_danger`,
`disfigured_body` (fires on Nemo's small fin), `pitch_dark`, `scary_looking`. The `joking` modifier
averaged 0.60 across all beats, so it is not usable as a veto yet. Per-attribute thresholds have to
be tuned on several films; one shared threshold is the main source of false flags.
