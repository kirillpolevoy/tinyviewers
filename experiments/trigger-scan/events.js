// Code, not a model, turns per-window answers into scenes. All times come from cue/window bounds.
import { CATEGORIES } from './taxonomy.js';

export const DEFAULT_POLICY = { threshold: 0.5, minSeverity: 1.0 };

// Categories that fire in one window under a policy.
export function flaggedCategories(win, { threshold, minSeverity } = DEFAULT_POLICY) {
  // v2 beats: act on a confident category alone (>= 0.7, per the thresholds in TypeSafe's cookbooks);
  // a weaker one (>= threshold) needs the threat/distress scores to put real mass on the top two levels.
  if (win.pHigh !== undefined) {
    const probs = Object.values(win.categories);
    const flagged = probs.some((p) => p >= 0.7) || (probs.some((p) => p >= threshold) && win.pHigh >= 0.5);
    return flagged ? CATEGORIES.filter((c) => win.categories[c.id] >= threshold).map((c) => c.id) : [];
  }
  if (win.severity < minSeverity) return [];
  return CATEGORIES.filter((c) => (win.categories[c.id] ?? 0) >= threshold).map((c) => c.id);
}

// One scene per flagged window. Merging neighbours (policy.merge) reads nicely in a list but glues
// half the film into a few giant scenes when an analyzer over-flags, which hides that problem.
export function windowsToScenes(windows, policy = DEFAULT_POLICY) {
  const scenes = [];
  let open = null;
  for (const w of windows) {
    const cats = flaggedCategories(w, policy);
    if (!cats.length) {
      open = null;
      continue;
    }
    if (!open || !policy.merge) {
      open = { startMs: w.startMs, endMs: w.endMs, startCue: w.cueIds[0], endCue: w.cueIds[1], windowIds: [], categories: {}, severity: 0, peakCue: null, peakSeverity: -1 };
      scenes.push(open);
    }
    open.endMs = w.endMs;
    open.endCue = w.cueIds[1];
    open.windowIds.push(w.windowId);
    for (const id of cats) open.categories[id] = Math.max(open.categories[id] ?? 0, w.categories[id]);
    open.severity = Math.max(open.severity, w.severity);
    if (w.severity > open.peakSeverity && w.peakCue && w.peakCue !== 'none') {
      open.peakSeverity = w.severity;
      open.peakCue = w.peakCue;
    }
  }
  return scenes.map(({ peakSeverity, ...s }, i) => ({ id: `S${String(i + 1).padStart(2, '0')}`, ...s }));
}
