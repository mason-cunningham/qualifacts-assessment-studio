import type { AiDraft, AiPlan, AiQuestion } from './schemas';

/**
 * Combine the staged-generation results (one plan + one question list per section) into
 * the same AiDraft that single-shot generation produced, so draftToDefinition() is unchanged.
 * - Questions follow the plan's section order and are forced into their section.
 * - Question keys are made unique across sections; branching inside a section is remapped.
 */
export function mergeStages(plan: AiPlan, questionsBySection: Record<string, AiQuestion[]>): AiDraft {
  const { sections: planSections, ...rest } = plan;
  const used = new Set<string>();
  const questions: AiQuestion[] = [];

  for (const s of planSections) {
    const rename = new Map<string, string>();
    const list = questionsBySection[s.key] ?? [];
    for (const q of list) {
      let key = q.key.trim() || `${s.key}-q${questions.length + 1}`;
      if (used.has(key)) {
        let n = 2;
        const base = `${s.key}-${key}`;
        key = base;
        while (used.has(key)) key = `${base}-${n++}`;
      }
      used.add(key);
      rename.set(q.key, key);
    }
    for (const q of list) {
      questions.push({
        ...q,
        key: rename.get(q.key)!,
        sectionKey: s.key,
        showIfQuestionKey: q.showIfQuestionKey ? (rename.get(q.showIfQuestionKey) ?? q.showIfQuestionKey) : '',
      });
    }
  }

  return {
    ...rest,
    sections: planSections.map(({ key, name, productIds, showInResults }) => ({ key, name, productIds, showInResults })),
    questions,
  };
}

/** A previous draft's questions for one section (used when revising section by section). */
export function sectionQuestionsFromDraft(draft: AiDraft | null | undefined, sectionKey: string): AiQuestion[] {
  return (draft?.questions ?? []).filter((q) => q.sectionKey === sectionKey);
}
