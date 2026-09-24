import type { AnswerValue, Answers, AssessmentDefinition, Condition, Question } from '@qq/schema';

export function isAnswered(q: Question, a: AnswerValue | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case 'single':
    case 'dropdown':
    case 'yesno':
    case 'multi':
      return !!a.optionIds && a.optionIds.length > 0;
    case 'rating':
    case 'number':
      return typeof a.value === 'number' && !Number.isNaN(a.value);
    case 'text':
    case 'longtext':
      return !!a.text && a.text.trim().length > 0;
  }
}

/** Answered, or optional and therefore skippable. */
export function canAdvance(q: Question, a: AnswerValue | undefined): boolean {
  if (!q.required) return true;
  if (!isAnswered(q, a)) return false;
  // An "Other" option that requires text must have text
  if (a?.optionIds) {
    for (const id of a.optionIds) {
      const opt = q.options.find((o) => o.id === id);
      if (opt?.allowOtherText && !(a.otherText && a.otherText.trim())) return false;
    }
  }
  return true;
}

function evalCondition(c: Condition, def: AssessmentDefinition, answers: Answers): boolean {
  const target = def.questions.find((q) => q.id === c.questionId);
  if (!target) return true; // dangling reference: fail open so respondents are never stuck
  const a = answers[c.questionId];
  const answered = isAnswered(target, a) && isVisible(target, def, answers);
  switch (c.op) {
    case 'answered':
      return answered;
    case 'notAnswered':
      return !answered;
    case 'in':
      return answered && !!a?.optionIds?.some((id) => c.optionIds?.includes(id));
    case 'notIn':
      return !answered || !a?.optionIds?.some((id) => c.optionIds?.includes(id));
    case 'gte':
      return answered && typeof a?.value === 'number' && a.value >= (c.value ?? 0);
    case 'lte':
      return answered && typeof a?.value === 'number' && a.value <= (c.value ?? 0);
  }
}

const visitGuard = new WeakMap<object, Set<string>>();

/** Whether a question is shown given the current answers (evaluates showIf, recursively). */
export function isVisible(q: Question, def: AssessmentDefinition, answers: Answers): boolean {
  if (!q.showIf || q.showIf.conditions.length === 0) return true;

  // Cycle protection (A shows if B, B shows if A): treat a cycle as visible.
  let seen = visitGuard.get(answers);
  if (!seen) {
    seen = new Set();
    visitGuard.set(answers, seen);
  }
  if (seen.has(q.id)) return true;
  seen.add(q.id);
  try {
    const results = q.showIf.conditions.map((c) => evalCondition(c, def, answers));
    return q.showIf.mode === 'any' ? results.some(Boolean) : results.every(Boolean);
  } finally {
    seen.delete(q.id);
  }
}

/** Questions in display order (section order, then question order within the section) that are currently visible. */
export function orderedQuestions(def: AssessmentDefinition): Question[] {
  const sectionOrder = new Map(def.sections.map((s, i) => [s.id, i]));
  return def.questions
    .map((q, i) => ({ q, i }))
    .sort((a, b) => {
      const sa = sectionOrder.get(a.q.sectionId) ?? Number.MAX_SAFE_INTEGER;
      const sb = sectionOrder.get(b.q.sectionId) ?? Number.MAX_SAFE_INTEGER;
      return sa - sb || a.i - b.i;
    })
    .map((x) => x.q);
}

export function visibleQuestions(def: AssessmentDefinition, answers: Answers): Question[] {
  return orderedQuestions(def).filter((q) => isVisible(q, def, answers));
}
