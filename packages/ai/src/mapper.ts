import {
  BRAND_COLORS,
  DEFAULT_LEAD_FIELDS,
  isChoiceType,
  newId,
  parseDefinition,
  type AssessmentDefinition,
  type Insight,
  type LeadField,
  type ProductSnapshot,
  type Question,
  type Section,
  type Tier,
} from '@qq/schema';
import { orderedQuestions, validateDefinition, type ValidationIssue } from '@qq/engine';
import type { AiDraft, AiInsight, AiTier } from './schemas';

const COLOR: Record<AiTier['color'], string> = {
  teal: BRAND_COLORS.teal,
  amber: BRAND_COLORS.amber,
  magenta: BRAND_COLORS.magenta,
  darkMagenta: BRAND_COLORS.magentaDark,
  navy: BRAND_COLORS.navy,
  grey: BRAND_COLORS.grey,
};

const LEAD_LABELS: Record<string, LeadField> = Object.fromEntries(
  [
    ...DEFAULT_LEAD_FIELDS,
    { key: 'phone', label: 'Phone', type: 'tel', required: false },
    { key: 'state', label: 'State', type: 'text', required: false },
  ].map((f) => [f.key, f as LeadField]),
);

const nn = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : undefined);

export interface DraftConversion {
  definition: AssessmentDefinition;
  issues: ValidationIssue[];
  /** Things the mapper had to repair (shown on the review screen) */
  repairs: string[];
}

/**
 * Convert Claude's flat AiDraft into a full AssessmentDefinition.
 * `products` are the library products the creator allowed. Any other product id is dropped.
 */
export function draftToDefinition(draft: AiDraft, products: ProductSnapshot[]): DraftConversion {
  const repairs: string[] = [];
  const method = draft.scoringMethod;
  const allowed = new Map(products.map((p) => [p.id, p]));

  // Sections
  const sectionId = new Map<string, string>();
  const sections: Section[] = draft.sections.map((s) => {
    const id = newId('s');
    sectionId.set(s.key, id);
    const productIds = s.productIds.filter((p) => allowed.has(p));
    if (productIds.length < s.productIds.length) repairs.push(`Removed unknown products from section "${s.name}".`);
    return { id, name: s.name, weight: 1, productIds, naBehavior: 'monitor', showInResults: s.showInResults };
  });
  if (sections.length === 0) {
    const id = newId('s');
    sections.push({ id, name: 'Questions', weight: 1, productIds: [], naBehavior: 'monitor', showInResults: true });
    repairs.push('Added a default section.');
  }
  const fallbackSection = sections[0].id;

  // Questions: first pass assigns ids so branching can reference earlier questions
  const questionId = new Map<string, string>();
  const optionIdsByQuestion = new Map<string, Map<string, string>>();
  const questions: Question[] = draft.questions.map((q, idx) => {
    const id = newId('q');
    questionId.set(q.key, id);
    const sid = sectionId.get(q.sectionKey) ?? fallbackSection;
    if (!sectionId.has(q.sectionKey)) repairs.push(`Q${idx + 1} pointed to an unknown section; moved to "${sections[0].name}".`);

    let role: Question['role'] = q.role;
    const choice = isChoiceType(q.type);
    if (role === 'gate' && !choice) role = 'info';
    if (role === 'scored' && (q.type === 'text' || q.type === 'longtext')) role = 'info';
    if (method === 'none' && role === 'scored') role = 'info';

    const optMap = new Map<string, string>();
    const options = choice
      ? q.options.map((o, oi) => {
          const oid = newId('o');
          optMap.set(o.label.trim().toLowerCase(), oid);
          let points: number | undefined;
          if (method === 'points' && role === 'scored' && !o.notApplicable) {
            // Fallback: descending points by position if Claude omitted them
            points = o.points ?? Math.max(0, q.options.length - 1 - oi);
          }
          const rec = o.recommendProductId && allowed.has(o.recommendProductId)
            ? { productIds: [o.recommendProductId], badge: text(o.recommendBadge), rank: nn(o.recommendRank) }
            : undefined;
          if (o.recommendProductId && !allowed.has(o.recommendProductId)) repairs.push(`Dropped a recommendation to an unknown product on Q${idx + 1}.`);
          return {
            id: oid,
            label: o.label,
            ...(points !== undefined ? { points } : {}),
            ...(o.isGap ? { isGap: true } : {}),
            ...(o.notApplicable ? { notApplicable: true } : {}),
            ...(o.allowOtherText ? { allowOtherText: true } : {}),
            ...(rec ? { recommend: rec } : {}),
          };
        })
      : [];
    optionIdsByQuestion.set(q.key, optMap);

    const question: Question = {
      id,
      sectionId: sid,
      type: q.type,
      role,
      text: q.text,
      shortLabel: text(q.shortLabel),
      helpText: text(q.helpText),
      required: q.required,
      weight: 1,
      options,
    };
    if (q.type === 'rating') {
      const min = q.ratingMin ?? 1;
      const max = q.ratingMax !== null && q.ratingMax > min ? q.ratingMax : min + 4;
      question.scale = { min, max, minLabel: text(q.ratingMinLabel), maxLabel: text(q.ratingMaxLabel) };
    }
    return question;
  });

  // Order questions by section so "earlier" matches what respondents see
  const sectionOrder = new Map(sections.map((s, i) => [s.id, i]));
  questions.sort((a, b) => (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0));
  const position = new Map(questions.map((q, i) => [q.id, i]));

  // Second pass: branching (only on earlier choice questions)
  draft.questions.forEach((q, idx) => {
    if (!q.showIfQuestionKey) return;
    const targetId = questionId.get(q.showIfQuestionKey);
    const selfId = questionId.get(q.key)!;
    const target = questions.find((x) => x.id === targetId);
    const self = questions.find((x) => x.id === selfId)!;
    if (!target || !isChoiceType(target.type) || (position.get(target.id) ?? 0) >= (position.get(selfId) ?? 0)) {
      repairs.push(`Removed a branching rule on Q${idx + 1} that pointed to a later or missing question.`);
      return;
    }
    const optMap = optionIdsByQuestion.get(q.showIfQuestionKey)!;
    const optionIds = q.showIfOptionLabels.map((l) => optMap.get(l.trim().toLowerCase())).filter((x): x is string => !!x);
    if (!optionIds.length) {
      repairs.push(`Removed a branching rule on Q${idx + 1} whose answer labels didn't match.`);
      return;
    }
    self.showIf = { mode: 'all', conditions: [{ questionId: target.id, op: 'in', optionIds }] };
  });

  const toTier = (t: AiTier): Tier => ({
    id: newId('t'),
    min: t.min,
    max: t.max,
    label: t.label,
    color: COLOR[t.color] ?? BRAND_COLORS.teal,
    summary: text(t.summary),
    body: text(t.body),
  });

  const toInsight = (i: AiInsight): Insight | null => {
    const body = i.body.trim();
    if (!body) return null;
    const id = newId('i');
    switch (i.when) {
      case 'sectionsBelowCount':
        return { id, body, when: { type: 'sectionsBelowCount', pct: i.pct ?? 60, atLeast: i.atLeast ?? 2 } };
      case 'weakestInclude': {
        const ids = i.sectionKeys.map((k) => sectionId.get(k)).filter((x): x is string => !!x);
        return ids.length ? { id, body, when: { type: 'weakestInclude', sectionIds: ids, topN: i.topN ?? 3 } } : null;
      }
      case 'overallBetween':
        return { id, body, when: { type: 'overallBetween', min: i.min ?? 0, max: i.max ?? 100 } };
      default:
        return { id, body, when: { type: 'always' } };
    }
  };

  const fields = (draft.leadCapture.fieldKeys.length ? draft.leadCapture.fieldKeys : ['first_name', 'last_name', 'email', 'organization'])
    .filter((k, i, all) => all.indexOf(k) === i)
    .map((k) => ({ ...LEAD_LABELS[k], required: draft.leadCapture.requiredKeys.includes(k as never) }));

  // Only snapshot products actually used (sections or options), plus keep the picked order
  const used = new Set<string>([
    ...sections.flatMap((s) => s.productIds),
    ...questions.flatMap((q) => q.options.flatMap((o) => o.recommend?.productIds ?? [])),
  ]);
  const snapshots = products.filter((p) => used.has(p.id)).map((p, i) => ({ ...p, priority: p.priority ?? i + 1 }));

  const raw = {
    schemaVersion: 1,
    meta: { title: draft.title, description: text(draft.description), productLine: text(draft.productLine) },
    theme: { accent: 'teal' },
    intro: {
      eyebrow: text(draft.intro.eyebrow),
      headline: draft.intro.headline || draft.title,
      subheadline: text(draft.intro.subheadline),
      body: text(draft.intro.body),
      bullets: draft.intro.bullets.filter((b) => b.trim()),
      startLabel: draft.intro.startLabel || 'Start Your Assessment',
      estimatedMinutes: draft.intro.estimatedMinutes > 0 ? Math.round(draft.intro.estimatedMinutes) : undefined,
    },
    sections,
    questions,
    scoring: {
      method,
      overall: 'allQuestions',
      tierBasis: draft.tierBasis,
      display: draft.display,
      tiers: method === 'none' ? [] : draft.tiers.map(toTier),
      sectionTiers: method === 'none' ? [] : draft.sectionTiers.map(toTier),
    },
    insights: method === 'none' ? [] : draft.insights.map(toInsight).filter((x): x is Insight => !!x),
    recommendations: {
      enabled: draft.recommendations.enabled && snapshots.length > 0,
      heading: draft.recommendations.heading || 'Recommended solutions',
      intro: text(draft.recommendations.intro),
      emptyMessage: text(draft.recommendations.emptyMessage),
      rules: [],
    },
    leadCapture: {
      position: draft.leadCapture.position,
      heading: draft.leadCapture.heading || 'Where should we send your results?',
      body: text(draft.leadCapture.body),
      fields,
      submitLabel: draft.leadCapture.position === 'beforeQuestions' ? 'Start' : 'See My Results',
    },
    results: {
      eyebrow: draft.results.eyebrow || 'Your Results',
      headline: text(draft.results.headline),
      body: text(draft.results.body),
      showSectionBreakdown: draft.results.showSectionBreakdown,
      showGapList: draft.results.showGapList,
      showInsights: draft.results.showInsights,
      showRecommendations: draft.results.showRecommendations && snapshots.length > 0,
      primaryCta:
        text(draft.results.primaryCtaLabel) && /^https?:\/\//i.test(draft.results.primaryCtaUrl ?? '')
          ? { label: draft.results.primaryCtaLabel!.trim(), url: draft.results.primaryCtaUrl!.trim() }
          : undefined,
      footerNote: text(draft.results.footerNote),
      thankYouOnly: method === 'none',
      thankYouHeadline: text(draft.results.thankYouHeadline) ?? 'Thank you!',
      thankYouBody: text(draft.results.thankYouBody),
    },
    products: snapshots,
  };

  if (method !== 'none' && raw.scoring.tiers.length === 0) {
    raw.scoring.tiers = [
      { id: newId('t'), min: 80, max: 100, label: 'Strong', color: BRAND_COLORS.teal, summary: undefined, body: undefined },
      { id: newId('t'), min: 60, max: 79, label: 'Room to Improve', color: BRAND_COLORS.amber, summary: undefined, body: undefined },
      { id: newId('t'), min: 0, max: 59, label: 'Significant Opportunity', color: BRAND_COLORS.magenta, summary: undefined, body: undefined },
    ];
    repairs.push('Added default score tiers.');
  }

  const parsed = parseDefinition(raw);
  if (!parsed.ok || !parsed.definition) {
    throw new Error(`The AI draft couldn't be converted: ${(parsed.errors ?? []).slice(0, 3).join('; ')}`);
  }
  return { definition: parsed.definition, issues: validateDefinition(parsed.definition), repairs };
}

/** Compact, readable outline of an assessment for the "review" helper. */
export function summarizeDefinition(def: AssessmentDefinition): string {
  const lines: string[] = [];
  lines.push(`Title: ${def.meta.title}`);
  if (def.intro.subheadline) lines.push(`Subheadline: ${def.intro.subheadline}`);
  lines.push(`Scoring: ${def.scoring.method}${def.scoring.method !== 'none' ? ` (tiers on ${def.scoring.tierBasis})` : ''}`);
  lines.push(`Lead capture: ${def.leadCapture.position} [${def.leadCapture.fields.map((f) => f.key).join(', ')}]`);
  const sectionName = new Map(def.sections.map((s) => [s.id, s.name]));
  orderedQuestions(def).forEach((q, i) => {
    lines.push('');
    lines.push(`Q${i + 1} [${sectionName.get(q.sectionId) ?? '?'}] (${q.type}, ${q.role}${q.required ? '' : ', optional'}${q.showIf ? ', conditional' : ''}): ${q.text}`);
    for (const o of q.options) {
      const flags = [
        o.points !== undefined ? `${o.points} pts` : '',
        o.isGap ? 'gap' : '',
        o.notApplicable ? 'N/A' : '',
        o.recommend ? `recommends ${o.recommend.productIds.map((id) => def.products.find((p) => p.id === id)?.name ?? id).join(', ')}` : '',
      ].filter(Boolean);
      lines.push(`   - ${o.label}${flags.length ? ` (${flags.join(', ')})` : ''}`);
    }
  });
  if (def.scoring.tiers.length) {
    lines.push('', 'Tiers:');
    for (const t of def.scoring.tiers) lines.push(`- ${t.label} ${t.min}–${t.max}: ${t.summary ?? ''}`);
  }
  if (def.insights.length) {
    lines.push('', 'Guidance rules:');
    def.insights.forEach((i, n) => lines.push(`${n + 1}. [${i.when.type}] ${i.body}`));
  }
  return lines.join('\n');
}
