import type {
  AnswerValue,
  Answers,
  AssessmentDefinition,
  Insight,
  InsightWhen,
  Option,
  ProductSnapshot,
  Question,
  RuleWhen,
  Section,
  Tier,
} from '@qq/schema';
import { isAnswered, isVisible, orderedQuestions } from './visibility';

// ─────────────────────────────────────────────────────────────────────────────
// Scoring model
//
// Every scored question produces (points, max). The gaps method is expressed in
// the same terms: a non-gap answer earns `weight`, a gap earns 0, max = weight.
// Section % and overall % are therefore always points ÷ max.
//
// Legacy parity:
//   Eligibility  → points 1–3, tierBasis 'points', display 'points'
//   InSync       → gaps, gate questions + naBehavior 'monitor', hard gates via showIf
//   CES          → points 0/5/10, option.recommend → feature cards, rank then product priority
//   Payment      → method 'none', results.thankYouOnly
// ─────────────────────────────────────────────────────────────────────────────

export interface ItemResult {
  questionId: string;
  shortLabel: string;
  answerLabel: string;
  points: number;
  max: number;
  isGap: boolean;
  /** false when the section is not applicable or the answer was "not applicable" */
  counted: boolean;
}

export interface SectionResult {
  sectionId: string;
  name: string;
  points: number;
  max: number;
  /** Unrounded 0–100, or null if nothing in the section was counted */
  pctExact: number | null;
  /** Rounded 0–100, or null */
  pct: number | null;
  gapCount: number;
  countedCount: number;
  applicable: boolean;
  gateAnswerLabel: string | null;
  tier: Tier | null;
  items: ItemResult[];
  productIds: string[];
  hasScoredQuestions: boolean;
}

export interface RecommendationResult {
  productId: string;
  product: ProductSnapshot;
  badge?: string;
  rank: number;
}

export interface AssessmentResults {
  method: AssessmentDefinition['scoring']['method'];
  points: number;
  max: number;
  pctExact: number | null;
  pct: number | null;
  /** The number the tier was matched against (pct or points per tierBasis) */
  tierValue: number | null;
  tier: Tier | null;
  gapCount: number;
  countedCount: number;
  sections: SectionResult[];
  recommendations: RecommendationResult[];
  insight: Insight | null;
  weakestSection: SectionResult | null;
}

/** Highest tier whose min ≤ value. Robust to gaps/overlaps between bands. */
export function matchTier(tiers: Tier[], value: number | null): Tier | null {
  if (value === null || tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  return sorted.find((t) => value >= t.min) ?? sorted[sorted.length - 1];
}

function selectedOptions(q: Question, a: AnswerValue | undefined): Option[] {
  if (!a?.optionIds) return [];
  return a.optionIds.map((id) => q.options.find((o) => o.id === id)).filter((o): o is Option => !!o);
}

export function answerLabel(q: Question, a: AnswerValue | undefined): string {
  if (!a) return '';
  switch (q.type) {
    case 'rating':
    case 'number':
      return a.value === undefined ? '' : String(a.value);
    case 'text':
    case 'longtext':
      return a.text ?? '';
    default: {
      const opts = selectedOptions(q, a);
      return opts
        .map((o) => (o.allowOtherText && a.otherText ? `${o.label}: ${a.otherText}` : o.label))
        .join('; ');
    }
  }
}

interface QuestionScore {
  points: number;
  max: number;
  isGap: boolean;
  counted: boolean;
}

/** Score one answered, visible, scored question (ignores section applicability). */
export function scoreQuestion(
  q: Question,
  a: AnswerValue | undefined,
  method: AssessmentDefinition['scoring']['method'],
): QuestionScore {
  const w = q.weight ?? 1;
  const none: QuestionScore = { points: 0, max: 0, isGap: false, counted: false };
  if (method === 'none' || q.role !== 'scored' || !isAnswered(q, a)) return none;

  if (q.type === 'rating') {
    const min = q.scale?.min ?? 1;
    const max = q.scale?.max ?? 5;
    const v = Math.min(max, Math.max(min, a!.value!));
    if (method === 'gaps') return none; // ratings have no gap semantics
    return { points: (v - min) * w, max: (max - min) * w, isGap: false, counted: max > min };
  }

  if (q.type === 'text' || q.type === 'longtext' || q.type === 'number') return none;

  const sel = selectedOptions(q, a);
  const scorable = sel.filter((o) => !o.notApplicable);
  if (scorable.length === 0) return none; // only "N/A" selected → not counted
  const isGap = scorable.some((o) => !!o.isGap);

  if (method === 'gaps') {
    return { points: isGap ? 0 : w, max: w, isGap, counted: true };
  }

  const eligible = q.options.filter((o) => !o.notApplicable);
  let points: number;
  let max: number;
  if (q.type === 'multi') {
    points = scorable.reduce((s, o) => s + (o.points ?? 0), 0);
    max = eligible.reduce((s, o) => s + Math.max(0, o.points ?? 0), 0);
    points = Math.min(points, max);
  } else {
    points = scorable[0].points ?? 0;
    max = eligible.reduce((m, o) => Math.max(m, o.points ?? 0), 0);
  }
  return { points: points * w, max: max * w, isGap, counted: true };
}

function sectionGate(def: AssessmentDefinition, section: Section, answers: Answers) {
  const gate = def.questions.find((q) => q.sectionId === section.id && q.role === 'gate');
  if (!gate || !isVisible(gate, def, answers)) return { applicable: true, label: null as string | null };
  const a = answers[gate.id];
  if (!isAnswered(gate, a)) return { applicable: true, label: null };
  const sel = selectedOptions(gate, a);
  return { applicable: !sel.some((o) => o.notApplicable), label: answerLabel(gate, a) };
}

const round = (n: number) => Math.round(n);

export function computeResults(def: AssessmentDefinition, answers: Answers): AssessmentResults {
  const method = def.scoring.method;
  const ordered = orderedQuestions(def);

  const sections: SectionResult[] = def.sections.map((section) => {
    const { applicable, label } = sectionGate(def, section, answers);
    const qs = ordered.filter((q) => q.sectionId === section.id);
    const items: ItemResult[] = [];
    let points = 0;
    let max = 0;
    let gapCount = 0;
    let countedCount = 0;

    for (const q of qs) {
      if (q.role !== 'scored') continue;
      if (!isVisible(q, def, answers)) continue; // hard-gated / branched away
      const a = answers[q.id];
      if (!isAnswered(q, a)) continue;
      const s = scoreQuestion(q, a, method);
      const counted = s.counted && applicable;
      if (counted) {
        points += s.points;
        max += s.max;
        countedCount++;
        if (s.isGap) gapCount++;
      }
      if (applicable || section.naBehavior === 'monitor') {
        items.push({
          questionId: q.id,
          shortLabel: q.shortLabel || q.text,
          answerLabel: answerLabel(q, a),
          points: s.points,
          max: s.max,
          isGap: s.isGap,
          counted,
        });
      }
    }

    const pctExact = max > 0 ? (points / max) * 100 : null;
    const pct = pctExact === null ? null : round(pctExact);
    return {
      sectionId: section.id,
      name: section.name,
      points,
      max,
      pctExact,
      pct,
      gapCount,
      countedCount,
      applicable,
      gateAnswerLabel: label,
      tier: matchTier(def.scoring.sectionTiers, pct),
      items,
      productIds: section.productIds,
      hasScoredQuestions: qs.some((q) => q.role === 'scored'),
    };
  });

  const points = sections.reduce((s, x) => s + x.points, 0);
  const max = sections.reduce((s, x) => s + x.max, 0);
  let pctExact: number | null = null;
  if (method !== 'none') {
    if (def.scoring.overall === 'weightedSections') {
      const weighted = sections
        .map((s) => ({ s, w: def.sections.find((d) => d.id === s.sectionId)?.weight ?? 1 }))
        .filter((x) => x.s.pctExact !== null && x.w > 0);
      const wsum = weighted.reduce((t, x) => t + x.w, 0);
      pctExact = wsum > 0 ? weighted.reduce((t, x) => t + x.s.pctExact! * x.w, 0) / wsum : null;
    } else {
      pctExact = max > 0 ? (points / max) * 100 : null;
    }
  }
  const pct = pctExact === null ? null : round(pctExact);
  const tierValue = method === 'none' ? null : def.scoring.tierBasis === 'points' ? points : pct;
  const tier = matchTier(def.scoring.tiers, tierValue);

  const scoredSections = sections.filter((s) => s.pctExact !== null);
  // Stable sort: ties keep section order (matches legacy Array.prototype.sort behavior)
  const byWeakness = [...scoredSections].sort((a, b) => a.pctExact! - b.pctExact!);

  const base: AssessmentResults = {
    method,
    points,
    max,
    pctExact,
    pct,
    tierValue,
    tier,
    gapCount: sections.reduce((s, x) => s + x.gapCount, 0),
    countedCount: sections.reduce((s, x) => s + x.countedCount, 0),
    sections,
    recommendations: [],
    insight: null,
    weakestSection: byWeakness[0] ?? null,
  };

  base.recommendations = computeRecommendations(def, answers, base);
  base.insight = pickInsight(def, answers, base, byWeakness);
  return base;
}

// ── Recommendations ─────────────────────────────────────────────────────────

function ruleMatches(when: RuleWhen, def: AssessmentDefinition, answers: Answers, r: AssessmentResults): boolean {
  switch (when.type) {
    case 'always':
      return true;
    case 'sectionBelow': {
      const s = r.sections.find((x) => x.sectionId === when.sectionId);
      return !!s && s.pctExact !== null && s.pctExact < when.pct;
    }
    case 'optionSelected':
      return optionSelected(def, answers, when.questionId, when.optionIds);
    case 'gapCountAtLeast': {
      const n = when.sectionId
        ? r.sections.find((x) => x.sectionId === when.sectionId)?.gapCount ?? 0
        : r.gapCount;
      return n >= when.count;
    }
    case 'overallBelow':
      return r.tierValue !== null && r.tierValue < when.value;
  }
}

function optionSelected(def: AssessmentDefinition, answers: Answers, questionId: string, optionIds: string[]) {
  const q = def.questions.find((x) => x.id === questionId);
  if (!q || !isVisible(q, def, answers)) return false;
  return !!answers[questionId]?.optionIds?.some((id) => optionIds.includes(id));
}

export function computeRecommendations(
  def: AssessmentDefinition,
  answers: Answers,
  r: AssessmentResults,
): RecommendationResult[] {
  if (!def.recommendations.enabled) return [];
  const products = new Map(def.products.map((p, i) => [p.id, { p, i }]));
  const best = new Map<string, { badge?: string; rank: number }>();
  const consider = (productId: string, rank: number | undefined, badge: string | undefined) => {
    if (!products.has(productId)) return;
    const rk = rank ?? 100;
    const cur = best.get(productId);
    if (!cur || rk < cur.rank) best.set(productId, { rank: rk, badge });
  };

  // Option-level recommendations (CES style)
  for (const q of orderedQuestions(def)) {
    if (!isVisible(q, def, answers)) continue;
    const a = answers[q.id];
    if (!isAnswered(q, a)) continue;
    for (const o of selectedOptions(q, a)) {
      if (!o.recommend) continue;
      for (const pid of o.recommend.productIds) consider(pid, o.recommend.rank, o.recommend.badge);
    }
  }

  // Rule-based recommendations
  for (const rule of def.recommendations.rules) {
    if (ruleMatches(rule.when, def, answers, r)) consider(rule.productId, rule.rank, rule.badge);
  }

  const list = [...best.entries()]
    .map(([productId, v]) => {
      const { p, i } = products.get(productId)!;
      return { productId, product: p, badge: v.badge, rank: v.rank, _order: i };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.product.priority ?? 100) - (b.product.priority ?? 100) ||
        a._order - b._order,
    )
    .map(({ _order, ...rest }) => rest);

  return def.recommendations.maxShown ? list.slice(0, def.recommendations.maxShown) : list;
}

// ── Insights (first match wins) ─────────────────────────────────────────────

function insightMatches(
  when: InsightWhen,
  def: AssessmentDefinition,
  answers: Answers,
  r: AssessmentResults,
  byWeakness: SectionResult[],
): boolean {
  switch (when.type) {
    case 'always':
      return true;
    case 'sectionsBelowCount':
      return r.sections.filter((s) => s.pctExact !== null && s.pctExact < when.pct).length >= when.atLeast;
    case 'weakestInclude': {
      const top = byWeakness.slice(0, when.topN).map((s) => s.sectionId);
      return when.sectionIds.every((id) => top.includes(id));
    }
    case 'overallBetween':
      return r.tierValue !== null && r.tierValue >= when.min && r.tierValue <= when.max;
    case 'optionSelected':
      return optionSelected(def, answers, when.questionId, when.optionIds);
  }
}

function pickInsight(
  def: AssessmentDefinition,
  answers: Answers,
  r: AssessmentResults,
  byWeakness: SectionResult[],
): Insight | null {
  return def.insights.find((i) => insightMatches(i.when, def, answers, r, byWeakness)) ?? null;
}
