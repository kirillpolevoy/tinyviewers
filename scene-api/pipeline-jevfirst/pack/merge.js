// v9: merge Sonnet's answers (sonnetq.js) into Jev's (classify.js) for the questions split.json assigns
// to Sonnet, so select.js reads ONE answers object exactly as in v8. Pure.
//   event q     answers.e[q] = Sonnet's probability
//   presence q  answers.pl[q] = p, and answers.ps[q] = p when the scene has a verified summary (select
//               takes max(pl, ps), so the tag's p is Sonnet's; its source reads 'both' / 'lines')
// A scene Sonnet has no answer for (missing) keeps whatever Jev answered (Jev is not asked the
// Sonnet questions in v9, so those questions simply produce no tag there) and is marked.
// answers.by = { q: 'sonnet' } records provenance for every merged question.
import { PRESENCE } from './questions.js';
import { P_UNLISTED } from './sonnet-questions.js';

const PRES = new Set(PRESENCE.map((p) => p.id));

export function mergeAnswers(jev, sonnetRow, used) {
  if (!jev) return jev;
  const a = structuredClone(jev);
  a.by = {};
  if (sonnetRow === null || sonnetRow === undefined) { a.sonnet_missing = true; return a; }
  const hasSummary = a.ps !== null && a.ps !== undefined;
  for (const q of used) {
    const p = sonnetRow[q]?.p ?? P_UNLISTED;
    if (PRES.has(q)) {
      a.pl ??= {}; a.pl[q] = p;
      if (hasSummary) a.ps[q] = p;
    } else {
      a.e ??= {}; a.e[q] = p;
    }
    a.by[q] = 'sonnet';
  }
  return a;
}
