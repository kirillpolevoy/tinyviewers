// Pure logic shared by the film page and its tests. No database, no React.
//
// Three rules from the product brief are enforced here rather than in a component, so they cannot
// drift between pages:
//   1. "Be ready at" is the scene start minus 30 s and never earlier than 0:00:00.
//   2. "Scene ends around" is the scene end plus 15 s.
//   3. Filters are built only from the labels that actually occur in the film being shown.

import { STRENGTH_WORDS } from './copy';

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
};

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
