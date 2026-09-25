#!/usr/bin/env node
// v8: apply the unified sentence acceptance rule (accept.js, policy sentence_accept + claim_accept) to
// a checked segments file, after check-claims.js and fill.js and before classify.js. No model calls.
//
//   node refold.js <slug> [--final-held-out-run]
//
// Per sentence: check.status (the rule's verdict, incl. Wikipedia placement and fill.js's neighbour
// placement), check.claim_status (the claim check's own status, kept), check.accepted_by, and
// check.split (the split check's alignment for that sentence, matched by text; stored, not deciding).
// Each scene's summary is rebuilt from its verified, judgement-free sentences. Writes the segments file
// in place with seg.acceptance = { rule, counts, at }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { V8, TS, outDir, sourcesFile, heldOutGate } from './env.js';
import { splitAlignmentBySentence, applyUnified } from './accept.js';
import { DEFAULT_RULE } from './claims.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The model segmentation a film's split check ran on (v7 fold: split_check.raw_file; else out/<slug>.segments.raw.json). */
export function rawFileFor(seg, slug, out = outDir()) {
  if (seg.split_check?.raw_file) return path.resolve(V8, seg.split_check.raw_file);
  return path.join(out, `${slug}.segments.raw.json`);
}

/** Load a film's segments, raw segmentation, sources, cues and the split alignment per sentence. */
export function loadAcceptInputs(slug, { out = outDir(), segFile = null } = {}) {
  const seg = JSON.parse(fs.readFileSync(segFile ?? path.join(out, `${slug}.segments.json`), 'utf8'));
  const raw = JSON.parse(fs.readFileSync(rawFileFor(seg, slug, out), 'utf8'));
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const alignment = splitAlignmentBySentence(seg, raw, cues, { wCount: SRC.wikipedia.sentences.length, tCount: SRC.tmdb.cast.length });
  return { seg, raw, SRC, cues, alignment };
}

export const ruleOf = (policy) => {
  const r = { ...DEFAULT_RULE, ...(policy.claim_accept ?? {}), ...(policy.sentence_accept ?? {}) };
  for (const k of Object.keys(r)) if (k.startsWith('_')) delete r[k];
  return r;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug) { console.error('usage: node refold.js <slug>'); process.exit(2); }
  heldOutGate(slug);
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const rule = ruleOf(policy);
  const file = path.join(outDir(), `${slug}.segments.json`);
  const { seg, alignment } = loadAcceptInputs(slug);
  const counts = applyUnified(seg, alignment, rule);
  const fillSent = seg.scenes.flatMap((s) => s.sentences.filter((x) => x.fill));
  seg.acceptance = { at: new Date().toISOString(), rule, counts, fill: { sentences: fillSent.length, verified: fillSent.filter((x) => x.check.status === 'verified').length }, scenes_with_summary: seg.scenes.filter((s) => s.summary).length };
  fs.writeFileSync(file, JSON.stringify(seg, null, 2));
  console.log(`${slug}: ${JSON.stringify(counts)}; fill ${seg.acceptance.fill.verified}/${seg.acceptance.fill.sentences} verified; scenes with a summary ${seg.acceptance.scenes_with_summary}/${seg.scenes.length}`);
}
