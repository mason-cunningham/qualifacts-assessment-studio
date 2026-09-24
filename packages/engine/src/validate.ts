import { isChoiceType, type AssessmentDefinition } from '@qq/schema';
import { orderedQuestions } from './visibility';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  /** Where to jump in the editor */
  target?: { tab: 'content' | 'scoring' | 'results' | 'solutions' | 'lead' | 'branding' | 'settings'; id?: string };
}

const URL_RE = /^(https?:\/\/|mailto:)/i;

/** Pre-publish checklist. Errors block publishing; warnings don't. */
export function validateDefinition(def: AssessmentDefinition): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string, target?: ValidationIssue['target']) => issues.push({ level: 'error', message, target });
  const warn = (message: string, target?: ValidationIssue['target']) => issues.push({ level: 'warning', message, target });

  if (!def.meta.title.trim()) err('Give the assessment a title.', { tab: 'settings' });
  if (!def.intro.headline.trim()) warn('The intro screen has no headline.', { tab: 'content' });
  if (def.sections.length === 0) err('Add at least one section.', { tab: 'content' });
  if (def.questions.length === 0) err('Add at least one question.', { tab: 'content' });

  const ids = new Set<string>();
  const sectionIds = new Set(def.sections.map((s) => s.id));
  for (const s of def.sections) {
    if (ids.has(s.id)) err(`Duplicate section id "${s.id}".`, { tab: 'content', id: s.id });
    ids.add(s.id);
    if (!s.name.trim()) err('A section is missing a name.', { tab: 'content', id: s.id });
  }

  const ordered = orderedQuestions(def);
  const position = new Map(ordered.map((q, i) => [q.id, i]));
  const scoring = def.scoring.method;

  ordered.forEach((q, idx) => {
    const n = idx + 1;
    const t = { tab: 'content' as const, id: q.id };
    if (ids.has(q.id)) err(`Q${n}: duplicate id "${q.id}".`, t);
    ids.add(q.id);
    if (!sectionIds.has(q.sectionId)) err(`Q${n} belongs to a section that no longer exists.`, t);
    if (!q.text.trim()) err(`Q${n} has no question text.`, t);

    if (isChoiceType(q.type)) {
      if (q.options.length < 2) err(`Q${n} needs at least two answer choices.`, t);
      const optIds = new Set<string>();
      q.options.forEach((o, oi) => {
        if (!o.label.trim()) err(`Q${n}, choice ${oi + 1} has no label.`, t);
        if (optIds.has(o.id)) err(`Q${n} has duplicate choice ids.`, t);
        optIds.add(o.id);
      });
      if (q.role === 'scored' && scoring === 'points') {
        const scorable = q.options.filter((o) => !o.notApplicable);
        if (scorable.every((o) => o.points === undefined)) err(`Q${n} is scored but no choice has points.`, { tab: 'scoring', id: q.id });
        else if (scorable.every((o) => (o.points ?? 0) === (scorable[0].points ?? 0)))
          warn(`Q${n}: every choice is worth the same points, so it can't move the score.`, { tab: 'scoring', id: q.id });
      }
      if (q.role === 'scored' && scoring === 'gaps' && !q.options.some((o) => o.isGap))
        warn(`Q${n} is scored but no choice is flagged as a gap.`, { tab: 'scoring', id: q.id });
      if (q.role === 'gate' && !q.options.some((o) => o.notApplicable))
        warn(`Q${n} is a gate question but no choice is marked "not applicable".`, t);
    } else if (q.role === 'gate') {
      err(`Q${n}: gate questions must be multiple choice.`, t);
    }

    if (q.type === 'rating') {
      const min = q.scale?.min ?? 1;
      const max = q.scale?.max ?? 5;
      if (max <= min) err(`Q${n}: rating scale max must be greater than min.`, t);
    }

    for (const c of q.showIf?.conditions ?? []) {
      const p = position.get(c.questionId);
      if (p === undefined) err(`Q${n} has a branching rule that points to a deleted question.`, t);
      else if (p >= idx) err(`Q${n} can only depend on questions that come before it.`, t);
    }
  });

  if (scoring !== 'none') {
    if (!ordered.some((q) => q.role === 'scored')) warn('Scoring is on, but no question is marked as scored.', { tab: 'scoring' });
    if (def.scoring.tiers.length === 0) err('Add at least one score tier.', { tab: 'scoring' });
    else {
      const lowest = Math.min(...def.scoring.tiers.map((t) => t.min));
      if (lowest > 0) warn('No tier starts at 0, so the lowest scores fall into the bottom tier anyway.', { tab: 'scoring' });
      def.scoring.tiers.forEach((t) => {
        if (!t.label.trim()) err('A tier is missing a label.', { tab: 'scoring' });
        if (t.max < t.min) err(`Tier "${t.label}" has max below min.`, { tab: 'scoring' });
      });
    }
  }

  const productIds = new Set(def.products.map((p) => p.id));
  const missingProduct = (pid: string) => !productIds.has(pid);
  for (const q of ordered)
    for (const o of q.options)
      if (o.recommend?.productIds.some(missingProduct))
        err(`"${o.label || 'A choice'}" recommends a product that isn't attached to this assessment.`, { tab: 'solutions' });
  for (const r of def.recommendations.rules)
    if (missingProduct(r.productId)) err('A recommendation rule points to a product that isn\'t attached.', { tab: 'solutions' });
  for (const s of def.sections)
    if (s.productIds.some(missingProduct)) err(`Section "${s.name}" lists a product that isn't attached.`, { tab: 'solutions' });

  const lc = def.leadCapture;
  if (lc.position !== 'off') {
    if (lc.fields.length === 0) err('The lead form is on but has no fields.', { tab: 'lead' });
    if (!lc.fields.some((f) => f.key === 'email')) warn('The lead form has no email field.', { tab: 'lead' });
    const keys = new Set<string>();
    for (const f of lc.fields) {
      if (!/^[a-z][a-z0-9_]*$/.test(f.key)) err(`Lead field "${f.label}" has an invalid key (use lowercase_with_underscores).`, { tab: 'lead' });
      if (keys.has(f.key)) err(`Lead field key "${f.key}" is used twice.`, { tab: 'lead' });
      keys.add(f.key);
    }
  } else if (scoring !== 'none') {
    warn('Lead capture is off, so responses will be anonymous.', { tab: 'lead' });
  }

  for (const cta of [def.results.primaryCta, def.results.secondaryCta])
    if (cta && cta.label && !URL_RE.test(cta.url)) err(`Button "${cta.label}" needs a full URL (https://…).`, { tab: 'results' });

  return issues;
}
