// The detail behind one flag reason, for the live demo's "one scene up close": the question(s) as the
// model was asked them, the answer each one got, Jev's line (an answer at or above it counts as a yes),
// and the policy rule that let the answer count. Everything comes from the frozen pack's own definitions
// (questions.js, combine.js, mortal.js, sonnet-questions.js, policy.json) and the run's own answers;
// nothing is invented. A reason whose question cannot be found gets question: null, never a made-up one.
//
// Provenance: many of Jev's reasons are a COMBINATION of answers (combine.js: max = any of, min = all of,
// gate = counts only when another answer passes). The reason's number is the combination's, so showing
// it next to one question would say that question got an answer it did not. Given the scene's raw
// answers, each reason lists the questions that were combined, each with its OWN answer, marks the one(s)
// that decided the number, and says how they were combined. Without the raw answers (an older run) a
// combined reason shows no per-question answer rather than a borrowed one.
import { JEV_CONCEPTS, JEV_QUESTIONS, JEV_THRESHOLDS, filmQuestions } from './pack/questions.js';
import { MORTAL_QS, MORTAL_REASONS } from './pack/mortal.js';
import { questionDef } from './pack/sonnet-questions.js';
import { POLICY } from './stages/common.js';
import { reasonCategory } from './stages/ingest.js';

/** The pack's question text, readable: `scene` placeholders in plain words, the [P]/[R] markers dropped. */
export const plainQuestion = (t) => {
  const s = String(t ?? '')
    .replace(/^In (?:`scene`|this scene), /, '')
    .replace(/`scene\.lines`/g, 'the lines').replace(/`scene\.summary`/g, 'the summary')
    .replace(/`scene`/g, 'this scene').replace(/`cast`/g, 'the cast list')
    .replace(/\s*\[[PR]\]\s*$/, '')
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : null;
};

const mortalThreshold = (q) => {
  const qs = POLICY.flag?.mortal?.questions;
  const hit = Array.isArray(qs) ? qs.find((x) => x.q === q) : qs?.[q];
  return hit?.t ?? hit?.threshold ?? null;
};

const SLOT_WORDS = ['<name>', '<danger>', '<villain>', '<child>', '{NAME}', '{DANGER}'];
/** A Jev question key's text, a film template's slots filled with the item's name. */
function keyQuestion(key, item) {
  const template = item ? key.replaceAll(item.id, '{item}') : key;
  const def = JEV_QUESTIONS[key] ?? JEV_QUESTIONS[template];
  if (!def) return null;
  let text = def.q?.instructions ?? null;
  if (text && item) for (const slot of SLOT_WORDS) text = text.replaceAll(slot, item.who ?? item.name ?? '');
  return plainQuestion(text);
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Evaluate a combine.js expression the way the pipeline did (combine.js evalExpr), keeping which
 * answers took part. Returns { p, parts: [{ key, p, asked, decides, role? }], how } -- `how` is the top
 * node's combination ('one' | 'any' | 'all' | 'gate' | 'score' | 'each'). Pure.
 */
export function contributors(e, ctx) {
  if (!e || typeof e !== 'object') return { p: 0, parts: [], how: 'one' };
  if (e.one) return { p: 1, parts: [], how: 'one' };
  if (e.q !== undefined) {
    const key = ctx.item ? e.q.replaceAll('{item}', ctx.item.id) : e.q;
    const v = ctx.a?.[key];
    const asked = typeof v === 'number';
    return { p: asked ? v : 0, parts: [{ key, p: asked ? r3(v) : null, asked, decides: true, item: ctx.item ?? null }], how: 'one' };
  }
  if (e.max || e.min) {
    const kids = (e.max ?? e.min).map((x) => contributors(x, ctx));
    if (!kids.length) return { p: 0, parts: [], how: e.max ? 'any' : 'all' };
    if (e.min) return { p: Math.min(...kids.map((k) => k.p)), parts: kids.flatMap((k) => k.parts), how: 'all' };
    const p = Math.max(0, ...kids.map((k) => k.p));
    const best = kids.findIndex((k) => k.p === p);
    return { p, parts: kids.flatMap((k, i) => k.parts.map((x) => ({ ...x, decides: i === best && x.decides }))), how: 'any' };
  }
  if (e.gate) {
    const g = contributors(e.gate, ctx);
    const passed = g.p >= e.at;
    const then = contributors(e.then, ctx);
    return { p: passed ? then.p : 0, parts: [...g.parts.map((x) => ({ ...x, decides: false, role: 'condition', at: e.at })), ...then.parts.map((x) => ({ ...x, decides: passed && x.decides }))], how: 'gate' };
  }
  if (e.score) {
    const then = contributors(e.then, ctx);
    const passed = Number(ctx.scores?.[e.score] ?? 0) >= e.at;
    return { p: passed ? then.p : 0, parts: then.parts.map((x) => ({ ...x, decides: passed && x.decides })), how: 'score' };
  }
  if (e.each) {
    const its = (ctx.items ?? []).filter((it) => it.type === e.each.type && (!e.each.group || it.group === e.each.group));
    const kids = its.map((it) => contributors(e.of, { ...ctx, item: it }));
    const p = Math.max(0, ...kids.map((k) => k.p));
    const best = kids.findIndex((k) => k.p === p);
    return { p, parts: best >= 0 ? kids[best].parts : [], how: 'each' };
  }
  return { p: 0, parts: [], how: 'one' };
}

/** The Jev concept target a reason id comes from, and the film item it is about (film templates). */
function targetFor(id, items) {
  const item = items.find((i) => i.id === id) ?? null;
  for (const c of Object.values(JEV_CONCEPTS)) {
    for (const t of c.targets ?? []) {
      if (item && t.layer === 'film' && t.type === item.type) return { target: t, item };
      if (!item && t.id === id && t.layer !== 'film') return { target: t, item: null };
    }
  }
  return { target: null, item };
}

/**
 * { question, act, answers, how } for one reason, answered by `by` ('jev' | 'sonnet'). `raw` is the
 * scene's classify answers ({ q, fpl, fps, s, ... }) when the caller has them; `reason` the flag reason
 * (its `source` names a mortal question exactly). Pure.
 */
export function questionFor(id, by, items = [], { raw = null, reason = null } = {}) {
  if (by === 'sonnet') {
    try { return { question: plainQuestion(questionDef(id).text), act: null, answers: [], how: 'one' }; } catch { return { question: null, act: null, answers: [], how: 'one' }; }
  }
  // A mortal-danger question: the reason's source names the question that answered (two questions can
  // raise the same reason).
  const mortalKey = /^mortal:([^@]+)@/.exec(reason?.source ?? '')?.[1] ?? Object.entries(MORTAL_REASONS).find(([, r]) => r.id === id)?.[0];
  if (mortalKey && MORTAL_QS[mortalKey]) {
    const question = plainQuestion(MORTAL_QS[mortalKey].instructions);
    return { question, act: mortalThreshold(mortalKey), answers: reason?.p != null ? [{ question, p: reason.p, decides: true }] : [], how: 'one' };
  }
  const { target, item } = targetFor(id, items);
  // A film character's presence: the lines question and the summary question; the higher one counts.
  if (item && item.type === 'presence') {
    const fq = filmQuestions([{ ...item, who: item.who ?? item.name }]);
    const answers = [
      { question: plainQuestion(fq[`fpl.${item.id}`]?.instructions), p: typeof raw?.fpl?.[item.id] === 'number' ? r3(raw.fpl[item.id]) : null },
      { question: plainQuestion(fq[`fps.${item.id}`]?.instructions), p: typeof raw?.fps?.[item.id] === 'number' ? r3(raw.fps[item.id]) : null },
    ].filter((a) => a.question);
    const top = Math.max(...answers.map((a) => a.p ?? -1));
    answers.forEach((a) => { a.decides = Boolean(raw) && a.p === top; });
    return { question: raw ? answers.find((a) => a.decides)?.question ?? null : null, act: JEV_THRESHOLDS[`cf.${item.type}`] ?? null, answers: raw ? answers : [], how: 'any' };
  }
  if (target) {
    const act = item ? JEV_THRESHOLDS[`cf.${item.type}`] ?? target.act ?? null : target.act ?? null;
    if (!raw) {
      // No raw answers: name the question only when there is exactly one, and never borrow a number.
      const single = target.expr?.q !== undefined;
      return { question: single ? keyQuestion(item ? target.expr.q.replaceAll('{item}', item.id) : target.expr.q, item) : null, act, answers: [], how: single ? 'one' : null };
    }
    const c = contributors(target.expr, { a: raw.q ?? {}, scores: { danger: Number(raw.s?.danger?.score ?? 0) }, items, item });
    const answers = c.parts.map((x) => ({ question: keyQuestion(x.key, x.item), p: x.p, decides: x.decides, ...(x.role ? { role: x.role, at: x.at } : {}) })).filter((a) => a.question);
    const decider = answers.find((a) => a.decides && a.role !== 'condition');
    return { question: decider?.question ?? null, act, answers, how: c.how };
  }
  return { question: null, act: JEV_THRESHOLDS[`c.${id}`] ?? null, answers: [], how: null };
}

/**
 * A flagged scene's why, in the shape the web's scene view reads:
 * { line, tags: [{ label, category, by, p, rule, question, act, answers, how, with? }] }. `sc` is a
 * select3 scene; `raw` its classify answers (the run's own), which make every answer shown its own.
 */
export function whyDetail(sc, items = [], raw = null) {
  const tags = sc.why_tags?.tags ?? [];
  const reasons = sc.flag_reasons ?? [];
  const labelOf = (rid) => reasons.find((x) => x.id === rid)?.label;
  return {
    line: sc.why_tags?.line ?? tags.map((t) => t.label).join(' · '),
    tags: tags.map((t) => {
      const rid = t.ids?.[0];
      const by = (t.by ?? []).filter((b) => b === 'jev' || b === 'sonnet');
      const r = reasons.find((x) => x.id === rid && (x.by ?? 'jev') === (by[0] ?? 'jev')) ?? reasons.find((x) => x.id === rid);
      const detail = rid ? questionFor(rid, by[0] ?? 'jev', items, { raw, reason: r }) : { question: null, act: null, answers: [], how: null };
      const withLabels = (r?.cooccur ?? []).map(labelOf).filter(Boolean);
      const rule = t.rule ?? r?.rule ?? null;
      return {
        label: t.label, category: reasonCategory(rule), by, p: t.p ?? null, rule,
        question: detail.question, act: detail.act, answers: detail.answers, how: detail.how,
        ...(withLabels.length ? { with: withLabels } : {}),
      };
    }),
  };
}
