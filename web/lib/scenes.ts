// Pure logic shared by the film page and its tests. No database, no React.
//
// Three rules from the product brief are enforced here rather than in a component, so they cannot
// drift between pages:
//   1. "Be ready at" is the scene start minus 30 s and never earlier than 0:00:00.
//   2. "Scene ends around" is the scene end plus 15 s.
//   3. Filters are built only from the labels that actually occur in the film being shown.

import { STRENGTH_WORDS, STRENGTH_WORDS_LOWER, NOT_CHECKED_LOWER, EMPTY, FILM } from './copy';

export type AgeBand = '5-7' | '8-10';

export const DEFAULT_BAND: AgeBand = '5-7';

export const READY_PAD_MS = 30_000;
export const ENDS_PAD_MS = 15_000;

/**
 * The most filters one URL may carry. The largest film in the library offers about forty labels in
 * total, so no real selection reaches this; it exists because the query string is public input. It
 * bounds the work every request does and keeps a hand-made URL from turning into a long scan.
 */
export const MAX_TAGS = 40;

/** A tag under a scene title: the plain short label, presence before events. */
export type SceneTag = {
  id: string;
  label: string;
  channel: 'presence' | 'event';
};

export type Scene = {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  description: string | null;
  severity57: number | null;
  severity810: number | null;
  tags: SceneTag[];
  /**
   * Why the scene is on the list: the reasons the pipeline flagged it for, as plain labels, in its
   * order ("Creature threatens", "Child in danger"). Present on every scene the v10.4 pipeline built;
   * absent (or empty) on a guide built before it.
   */
  why?: string[];
  /**
   * The reasons as the pipeline stored them, one per check (label, and from a v10.4 guide its rule and
   * category): grouped for the open row by lib/reasons.ts, never used as filters.
   */
  whyTags?: WhyTagLite[];
};

/** One stored reason tag, as much of it as the open row needs. */
export type WhyTagLite = { label: string; category?: string | null; rule?: string | null };

/** The title the pipeline writes when no title passed its checks. Never shown as a title. */
export const PLACEHOLDER_TITLE = 'Flagged scene';

/**
 * The stored why (`scenes.why_tags`): `{ line, tags: [{ label }] }` as the scene API writes it, or a
 * bare list of tags or labels, or a "A · B" line. Anything else is no reasons, never an error: a page
 * must not fail over a column it can live without. Labels are trimmed, and repeats dropped.
 */
export function parseWhy(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      value = text.split('·');
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { tags?: unknown; line?: unknown };
    value = Array.isArray(v.tags) ? v.tags : typeof v.line === 'string' ? v.line.split('·') : [];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    // A film-specific reason is filtered by its stable category; the open row groups the tags themselves (parseWhyTags).
    const obj = item && typeof item === 'object' ? (item as { label?: unknown; category?: unknown }) : null;
    const label = typeof item === 'string' ? item : obj ? (typeof obj.category === 'string' && obj.category.trim() ? obj.category : obj.label) : null;
    if (typeof label !== 'string') continue;
    const clean = label.trim();
    if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
  }
  return out;
}

/**
 * The stored why (`scenes.why_tags`) as its individual tags, in the pipeline's order, repeats dropped:
 * every shape `parseWhy` reads (a bare label or an "A · B" line is a tag with a label only). Nothing
 * readable is no tags, never an error.
 */
export function parseWhyTags(raw: unknown): WhyTagLite[] {
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return [];
    try {
      value = JSON.parse(text);
    } catch {
      value = text.split('·');
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as { tags?: unknown; line?: unknown };
    value = Array.isArray(v.tags) ? v.tags : typeof v.line === 'string' ? v.line.split('·') : [];
  }
  if (!Array.isArray(value)) return [];
  const out: WhyTagLite[] = [];
  for (const item of value) {
    const obj = item && typeof item === 'object' ? (item as { label?: unknown; category?: unknown; rule?: unknown }) : null;
    const label = typeof item === 'string' ? item : typeof obj?.label === 'string' ? obj.label : null;
    const clean = label?.trim();
    if (!clean || out.some((t) => t.label.toLowerCase() === clean.toLowerCase())) continue;
    out.push({
      label: clean,
      category: typeof obj?.category === 'string' && obj.category.trim() ? obj.category.trim() : null,
      rule: typeof obj?.rule === 'string' ? obj.rule : null,
    });
  }
  return out;
}

/**
 * What a scene row is called: its own title, or — when the pipeline had no title that passed its
 * checks — where it starts ("Scene starting at 0:10:53"). Its reasons are shown in the open row,
 * never stitched into a title that would read like a summary of what happens. Never the placeholder.
 */
export function sceneHeading(scene: Pick<Scene, 'title' | 'startMs'>): string {
  const title = scene.title?.trim();
  if (title && title !== PLACEHOLDER_TITLE) return title;
  return FILM.untitledScene(formatTime(scene.startMs));
}

export type Facet = {
  id: string;
  label: string;
  count: number;
};

/** Times are always H:MM:SS. A negative input is a bug upstream; clamp rather than print "-0:00:30". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The padded start a parent watches for. Never before the beginning of the film. */
export function readyAtMs(startMs: number): number {
  return Math.max(0, startMs - READY_PAD_MS);
}

/** The padded end. No upper clamp: a film's true runtime is longer than its last subtitle cue. */
export function endsAroundMs(endMs: number): number {
  return endMs + ENDS_PAD_MS;
}

export function severityFor(scene: Scene, band: AgeBand): number | null {
  const value = band === '8-10' ? scene.severity810 : scene.severity57;
  return value === null || value === undefined ? null : value;
}

/**
 * The one mark a row shows. A missing severity is "Not checked", never a zero — the difference
 * between "the subtitles say little happens" and "the subtitles cannot tell us".
 */
export function strengthLabel(value: number | null): string | null {
  if (value === null) return null;
  const word = STRENGTH_WORDS[value];
  return word ? `${value} · ${word}` : null;
}

/** Filled circles out of three. Level 0 fills none. */
export function strengthDots(value: number | null): number {
  if (value === null) return 0;
  return Math.min(3, Math.max(0, value));
}

/** Marker height and colour on the timeline strip, by strength for the selected band. */
export function markerShape(value: number | null): { heightPct: number; tone: string } {
  switch (value) {
    case 3:
      return { heightPct: 100, tone: 'coral' };
    case 2:
      return { heightPct: 66, tone: 'blush' };
    case 1:
      return { heightPct: 38, tone: 'butter' };
    case 0:
      return { heightPct: 22, tone: 'mint' };
    default:
      return { heightPct: 22, tone: 'grey' };
  }
}

/** Position of a marker along the strip, as a percentage. A zero-length film puts everything at 0. */
export function markerLeftPct(startMs: number, durationMs: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return Math.min(100, Math.max(0, (startMs / durationMs) * 100));
}

/**
 * The filter chips for one film: every asserted label that occurs in it, with the number of scenes
 * it occurs in, most common first. A label that occurs in no scene of this film never appears, so a
 * parent cannot pick a filter that can only return nothing.
 */
export function buildFacets(scenes: Scene[], channel: 'presence' | 'event'): Facet[] {
  const counts = new Map<string, Facet>();
  for (const scene of scenes) {
    const seen = new Set<string>();
    for (const tag of scene.tags) {
      if (tag.channel !== channel || seen.has(tag.id)) continue;
      seen.add(tag.id);
      const hit = counts.get(tag.id);
      if (hit) hit.count += 1;
      else counts.set(tag.id, { id: tag.id, label: tag.label, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}

/** "Show scenes with any of these": a scene survives if it carries at least one selected label. */
export function applyFilters(scenes: Scene[], selected: string[]): Scene[] {
  if (!selected.length) return scenes;
  const wanted = new Set(selected);
  return scenes.filter((scene) => scene.tags.some((tag) => wanted.has(tag.id)));
}

/**
 * The selection as asked for: duplicates removed, order kept, capped at MAX_TAGS.
 *
 * A Set rather than a scan per item — this runs on input from the query string, where the list
 * length is whatever a caller chose to send, and an O(n²) loop over it is a free denial of service.
 *
 * A tag this film does not have is deliberately NOT dropped: a parent who asks for ghosts in a film
 * with no ghosts should be told "No matches", not quietly shown all thirty scenes as though they
 * had asked for nothing. The chips only ever offer labels this film has, so this case only arises
 * from a shared or hand-edited URL — and there the honest answer is the empty state.
 */
export function dedupe(selected: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of selected) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/**
 * Repeated query parameters arrive as an array, a single one as a string, a missing one undefined.
 * Whatever the shape, the result is deduplicated and capped: this is untrusted input, and every
 * caller downstream is entitled to a bounded list.
 */
export function readListParam(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    for (const part of entry.split(',')) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length === MAX_TAGS) return out;
    }
  }
  return out;
}

export function readBand(value: string | string[] | undefined): AgeBand {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '8-10' ? '8-10' : DEFAULT_BAND;
}

/**
 * Same shape the filter form posts, so a link and a form submission produce the same URL. The
 * selection is capped here too: a link this app writes can never be longer than a URL it accepts.
 */
export function filmHref(
  slug: string,
  { band, selected }: { band: AgeBand; selected: string[] },
): string {
  const params = new URLSearchParams();
  if (band !== DEFAULT_BAND) params.set('age', band);
  for (const id of dedupe(selected)) params.append('tag', id);
  const qs = params.toString();
  return qs ? `/film/${slug}?${qs}` : `/film/${slug}`;
}

/** How many of a film's scenes reach the strongest mark in a band — the library card's second fact. */
export function countAtStrongest(scenes: Scene[], band: AgeBand): number {
  return scenes.filter((s) => severityFor(s, band) === 3).length;
}

/**
 * Everything the film page derives from its scenes and its query string.
 *
 * It lives here, apart from the component, so the page's behaviour can be tested directly: give it
 * the same scenes and two different `age` values, and the scene ids it returns must be identical.
 * That is the invariant the age control exists under — it changes the mark, never the list — and
 * it cannot be checked by comparing a function to itself.
 */
export function filmPageModel(
  allScenes: Scene[],
  query: { age?: string | string[]; tag?: string | string[] },
) {
  const band = readBand(query.age);
  const presence = buildFacets(allScenes, 'presence');
  const events = buildFacets(allScenes, 'event');
  const selected = dedupe(readListParam(query.tag));
  const scenes = applyFilters(allScenes, selected);
  const lastEnd = allScenes.length ? allScenes[allScenes.length - 1].endMs : 0;

  return {
    band,
    presence,
    events,
    selected,
    scenes,
    matching: new Set(scenes.map((s) => s.id)),
    strongest: countAtStrongest(allScenes, band),
    lastEnd,
  };
}

// ---------------------------------------------------------------------------------------------
// The film page's findings card, timeline and rows
// ---------------------------------------------------------------------------------------------

/** The severity fill for a level: 0 mint, 1 butter, 2 blush, 3 coral; not checked is dust — never zero. */
export type SeverityTone = 'mint' | 'butter' | 'blush' | 'coral' | 'dust';

export function severityTone(value: number | null): SeverityTone {
  switch (value) {
    case 0:
      return 'mint';
    case 1:
      return 'butter';
    case 2:
      return 'blush';
    case 3:
      return 'coral';
    default:
      return 'dust';
  }
}

/** A tappable timeline marker's height in px: taller where stronger. Not checked is the shortest. */
export function markerHeightPx(value: number | null): number {
  if (value === null || value === undefined) return 12;
  return [12, 20, 32, 46][Math.min(3, Math.max(0, value))];
}

/**
 * A timeline mark's width in px — narrower on a narrow track (a phone), where a film's scenes sit a few
 * pixels apart — and the least clear space between two marks.
 */
export const MARK_PX = 10;
export const MARK_PX_NARROW = 6;
export const NARROW_TRACK_PX = 480;
export const MARK_GAP_PX = 2;

/** The mark width for a track this wide (0, not measured yet: the wide default). */
export function markWidthPx(trackPx: number): number {
  return trackPx > 0 && trackPx < NARROW_TRACK_PX ? MARK_PX_NARROW : MARK_PX;
}

/**
 * Scenes close enough together on the timeline to be drawn as one mark: the scenes in it, where the
 * first and last sit (percent along the track), and the strongest level among them (a known level
 * beats "not checked", which is never read as a zero).
 */
export type MarkerCluster<T> = { items: T[]; firstPct: number; lastPct: number; value: number | null };

/**
 * The timeline's marks, grouped so no two overlap on a track `widthPx` wide: a scene joins the group
 * before it when its centre is less than a mark and a gap (`markWidthPx` + MARK_GAP_PX) from that
 * group's last scene. A group of several is drawn once, as wide as its span and as strong as its
 * strongest, with its count on it; the scene rows stay the way to each scene.
 *
 * `widthPx` 0 (not measured yet, as on the server) puts every scene in a group of its own.
 */
export function clusterMarkers<T>(
  items: T[],
  place: (item: T) => number,
  level: (item: T) => number | null,
  widthPx: number,
): MarkerCluster<T>[] {
  const sorted = items.map((item) => ({ item, pct: place(item) })).sort((a, b) => a.pct - b.pct);
  const minPct = widthPx > 0 ? ((markWidthPx(widthPx) + MARK_GAP_PX) / widthPx) * 100 : 0;
  const out: MarkerCluster<T>[] = [];
  for (const { item, pct } of sorted) {
    const last = out[out.length - 1];
    if (last && widthPx > 0 && pct - last.lastPct < minPct) {
      last.items.push(item);
      last.lastPct = pct;
      last.value = strongest(last.value, level(item));
    } else {
      out.push({ items: [item], firstPct: pct, lastPct: pct, value: level(item) });
    }
  }
  return out;
}

function strongest(a: number | null, b: number | null): number | null {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return Math.max(a, b);
}

/** The word a scene row leads with: "Very strong", or "Not checked" — never a zero. */
export function strengthWord(value: number | null): string {
  if (value === null || value === undefined) return EMPTY.notCheckedHeadline;
  return STRENGTH_WORDS[value] ?? EMPTY.notCheckedHeadline;
}

export type BreakdownEntry = { value: number | null; count: number; word: string; tone: SeverityTone };

/**
 * "3 very strong · 8 strong · 6 mild · 1 low" for one age band, strongest first, empty levels left
 * out. Scenes the subtitles could not judge are their own entry, "not checked", and are never
 * counted as low.
 */
export function strengthBreakdown(scenes: Scene[], band: AgeBand): BreakdownEntry[] {
  const out: BreakdownEntry[] = [];
  for (const value of [3, 2, 1, 0] as const) {
    const count = scenes.filter((s) => severityFor(s, band) === value).length;
    if (count) out.push({ value, count, word: STRENGTH_WORDS_LOWER[value], tone: severityTone(value) });
  }
  const unknown = scenes.filter((s) => severityFor(s, band) === null).length;
  if (unknown) out.push({ value: null, count: unknown, word: NOT_CHECKED_LOWER, tone: 'dust' });
  return out;
}

/**
 * The filter chips as one group: what is in a scene and what happens in it, merged, most common
 * first. A label that is somehow in both channels is one chip, counted once per scene.
 */
export function mergedFacets(scenes: Scene[]): Facet[] {
  const counts = new Map<string, Facet>();
  for (const scene of scenes) {
    const seen = new Set<string>();
    for (const tag of scene.tags) {
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      const hit = counts.get(tag.id);
      if (hit) hit.count += 1;
      else counts.set(tag.id, { id: tag.id, label: tag.label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** When the last scene ends: "Nothing flagged after" this. Zero for a film with no scenes. */
export function lastSceneEndMs(scenes: Scene[]): number {
  return scenes.reduce((max, s) => Math.max(max, s.endMs), 0);
}

/**
 * The rows the list shows. A tapped marker wins — the list is that one scene, or the scenes a grouped
 * mark stands for — and otherwise the chips filter it. The age band is not an input: it changes the
 * marks, never the list.
 */
export function visibleScenes(
  scenes: Scene[],
  {
    selectedSceneId = null,
    selectedIds = null,
    tags,
  }: { selectedSceneId?: string | null; selectedIds?: string[] | null; tags: string[] },
): Scene[] {
  // A tapped mark: one scene, or the several a mark stands for where they sit close together.
  const ids = selectedIds?.length ? selectedIds : selectedSceneId ? [selectedSceneId] : [];
  if (ids.length) {
    const picked = scenes.filter((s) => ids.includes(s.id));
    if (picked.length) return picked;
  }
  return applyFilters(scenes, tags);
}

/** "1 h 28 min", from milliseconds. Under an hour it is minutes alone. */
export function formatRuntime(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/**
 * A synopsis split after its first sentence: `[first, rest]`, with `rest` empty when there is only
 * one. A full stop inside "Mr." or "Dr." is not an ending, nor is an ellipsis mid-sentence.
 */
export function splitFirstSentence(text: string): [string, string] {
  const trimmed = text.trim();
  // An ending is punctuation, space, then a capital (or a quote or digit): "sharks... and more"
  // carries on, "taken. Marlin follows" does not.
  const re = /[.!?](?=\s+["“‘'(]?[A-Z0-9])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    const before = trimmed.slice(0, match.index);
    if (/\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs)$/i.test(before)) continue;
    return [trimmed.slice(0, match.index + 1), trimmed.slice(match.index + 1).trim()];
  }
  return [trimmed, ''];
}
