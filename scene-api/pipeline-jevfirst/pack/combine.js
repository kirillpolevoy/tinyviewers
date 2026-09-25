// v10 COMBINE: code-combined Jev bundles. Pure; no model calls.
//
// A v10 concept's Jev answer is an EXPRESSION over the per-scene answers of its Nouls (jev-set.js), written
// as JSON so the same object is scored on the dev films (assemble/*), frozen (freeze.js) and applied by
// select.js. Fuzzy logic, as in the phrasing tournament: OR = max, AND = min.
//
//   { q: '<key>' }                  the Noul's probability; 0 when it was not asked (e.g. a summary
//                                   question on a scene with no verified summary)
//   { max: [e, ...] }               OR
//   { min: [e, ...] }               AND
//   { gate: e1, at: x, then: e2 }   e2 when e1 >= x, else 0 (a question that only counts in context)
//   { score: 'danger', at: n, then: e }  e when Jev's v9 danger Score (expected level) >= n, else 0
//   { each: { type, group? }, of: e }    max of e over the film's generated items of that type (and
//                                   group); '{item}' in e's keys is replaced by each item id
//   { one: 1 }                      true (an Astra sub-condition folded into the wording or the state)
//
// A film-template concept (film:threatens / film:child_in_danger / film:danger) is evaluated once per
// generated film item, with ctx.item set, and gives that item's probability.

/** Evaluate one expression. ctx = { a: {key: p}, scores: {danger: n}, items: [film items], item? } */
export function evalExpr(e, ctx) {
  if (!e || typeof e !== 'object') throw new Error(`combine: bad expression ${JSON.stringify(e)}`);
  if (e.one) return 1;
  if (e.q !== undefined) {
    const k = ctx.item ? e.q.replaceAll('{item}', ctx.item.id) : e.q;
    if (k.includes('{item}')) throw new Error(`combine: ${e.q} needs a film item`);
    const p = ctx.a?.[k];
    return typeof p === 'number' ? p : 0;
  }
  if (e.max) return Math.max(0, ...e.max.map((x) => evalExpr(x, ctx)));
  if (e.min) return e.min.length ? Math.min(...e.min.map((x) => evalExpr(x, ctx))) : 0;
  if (e.gate) return evalExpr(e.gate, ctx) >= e.at ? evalExpr(e.then, ctx) : 0;
  if (e.score) return Number(ctx.scores?.[e.score] ?? 0) >= e.at ? evalExpr(e.then, ctx) : 0;
  if (e.each) {
    const its = (ctx.items ?? []).filter((it) => it.type === e.each.type && (!e.each.group || it.group === e.each.group));
    return Math.max(0, ...its.map((it) => evalExpr(e.of, { ...ctx, item: it })));
  }
  throw new Error(`combine: unknown node ${JSON.stringify(e)}`);
}

/** Every question key an expression reads ('{item}' left in template keys). */
export function keysOf(e, out = new Set()) {
  if (!e || typeof e !== 'object') return out;
  if (e.q !== undefined) out.add(e.q);
  for (const k of ['max', 'min']) if (Array.isArray(e[k])) e[k].forEach((x) => keysOf(x, out));
  if (e.gate) { keysOf(e.gate, out); keysOf(e.then, out); }
  if (e.score) keysOf(e.then, out);
  if (e.each) keysOf(e.of, out);
  return out;
}

/** Human-readable form, for logs and the split evidence. */
export function show(e) {
  if (e.one) return 'true';
  if (e.q !== undefined) return e.q;
  if (e.max) return e.max.length === 1 ? show(e.max[0]) : `max(${e.max.map(show).join(', ')})`;
  if (e.min) return `min(${e.min.map(show).join(', ')})`;
  if (e.gate) return `(${show(e.then)} if ${show(e.gate)} >= ${e.at})`;
  if (e.score) return `(${show(e.then)} if Score ${e.score} >= ${e.at})`;
  if (e.each) return `max over ${e.each.type}${e.each.group ? `/${e.each.group}` : ''} items of ${show(e.of)}`;
  return JSON.stringify(e);
}
