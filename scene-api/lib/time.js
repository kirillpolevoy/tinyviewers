// Timeline arithmetic.
//
// Every timestamp in the database belongs to ONE subtitle track, which belongs to one release of
// the film. A parent watching a different release sees the same moment at a different place on
// their clock. The two releases are related by an affine map:
//
//     player_ms = track_ms * scale + offset_ms
//
// `scale` is 1 for the ordinary case (same master, different leader length). It is not 1 when the
// releases run at different frame rates: a 24 fps film transferred to PAL plays back at 25 fps, so
// the whole film is 4% shorter and scale is 24/25 = 0.96 (and 25/24 = 1.0417 in the other
// direction). One anchor can only find an offset; two anchors find both.

export function formatHms(ms) {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${h}:${pad(m)}:${pad(s)}`;
}

// Accepts "3754.5" (seconds), "1:02:34", "62:34" (M:SS) and "1:02:34.500".
//
// M:SS has no hours field, so its minutes are not a clock position and are not capped at 59: a
// player that shows "94:12" is telling you 94 minutes. Minutes are only capped when an hours
// group is present, where 1:75:00 really is a typo.
export function parseClock(raw) {
  const value = String(raw).trim();
  if (value === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Math.round(parseFloat(value) * 1000);
  const m = value.match(/^(-)?(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const sign = m[1] ? -1 : 1;
  const hasHours = m[2] !== undefined;
  const h = hasHours ? Number(m[2]) : 0;
  const min = Number(m[3]);
  const sec = parseFloat(String(m[4]).replace(',', '.'));
  if (hasHours && min > 59) return null;
  if (sec >= 60) return null;
  return sign * Math.round(((h * 60 + min) * 60 + sec) * 1000);
}

export const IDENTITY = { offset_ms: 0, scale: 1 };

export const applyMapping = (ms, mapping) => Math.round(ms * mapping.scale + mapping.offset_ms);

// One anchor: assume the releases run at the same speed and only differ by a constant shift.
export function offsetFromOneAnchor(anchorMs, observedMs) {
  return { offset_ms: observedMs - anchorMs, scale: 1 };
}

// Two anchors: solve for both. They must be far enough apart that a second of reading error on the
// parent's player does not swamp the scale estimate.
export const MIN_ANCHOR_SPREAD_MS = 60_000;

// How far the mapped film may stray before we refuse it. A parent who reads the wrong anchor line
// produces an arithmetically valid mapping that puts the film before the start of time or hours
// past its end; that is a mistake to catch, not a number to print.
export const MAX_START_BEFORE_ZERO_MS = 60_000;
export const MAX_END_PAST_DURATION_MS = 30 * 60_000;

/**
 * Sanity-checks a finished mapping against the track it belongs to.
 * @returns {null | string} null when plausible, otherwise the reason it is not.
 */
export function implausibleMapping(mapping, durationMs) {
  const atZero = applyMapping(0, mapping);
  const atEnd = applyMapping(durationMs, mapping);
  if (atZero < -MAX_START_BEFORE_ZERO_MS) {
    return `that puts the start of the film at ${formatHms(atZero)} on their player, which is before the film begins`;
  }
  if (atEnd > durationMs + MAX_END_PAST_DURATION_MS) {
    return `that puts the end of the film at ${formatHms(atEnd)} on their player, more than half an hour past where it should be (${formatHms(durationMs)})`;
  }
  if (atEnd <= atZero) {
    return 'that runs the film backwards';
  }
  const mappedLength = atEnd - atZero;
  if (mappedLength < durationMs / 2 || mappedLength > durationMs * 2) {
    return `that makes their copy ${formatHms(mappedLength)} long against our ${formatHms(durationMs)}, which is not the same film`;
  }
  return null;
}

export function mappingFromTwoAnchors(a1, o1, a2, o2) {
  if (Math.abs(a2 - a1) < MIN_ANCHOR_SPREAD_MS) {
    return { error: `the two anchor lines are only ${Math.round(Math.abs(a2 - a1) / 1000)}s apart in our timeline; pick anchors at least 60s apart (the early and late anchors of the track are the best pair)` };
  }
  const scale = (o2 - o1) / (a2 - a1);
  if (!Number.isFinite(scale) || scale <= 0.5 || scale >= 2) {
    return { error: `the two observed times imply a playback speed of ${scale.toFixed(3)}x, which is not a real release difference; check that observed_at is in the same order as anchor_cue` };
  }
  return { offset_ms: Math.round(o1 - a1 * scale), scale };
}
