import type { Answers, AssessmentDefinition, Option, Question } from '@qq/schema';
import { isChoiceType } from '@qq/schema';
import { isVisible, orderedQuestions } from '@qq/engine';

export interface EditorProps {
  def: AssessmentDefinition;
  update: (fn: (d: AssessmentDefinition) => void) => void;
  readOnly: boolean;
}

export function move<T>(arr: T[], index: number, dir: -1 | 1): void {
  const j = index + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[index], arr[j]] = [arr[j], arr[index]];
}

function optionValue(def: AssessmentDefinition, o: Option): number {
  if (def.scoring.method === 'gaps') return o.isGap ? 0 : 1;
  return o.points ?? 0;
}

/**
 * Build a full set of answers for previewing results.
 * Walks questions in order so branching is respected.
 */
export function sampleAnswers(def: AssessmentDefinition, mode: 'best' | 'worst' | 'random'): Answers {
  const answers: Answers = {};
  for (const q of orderedQuestions(def)) {
    if (!isVisible(q, def, answers)) continue;
    answers[q.id] = sampleFor(def, q, mode);
  }
  return answers;
}

function sampleFor(def: AssessmentDefinition, q: Question, mode: 'best' | 'worst' | 'random') {
  if (isChoiceType(q.type) && q.options.length) {
    let pool = q.options;
    if (q.role === 'gate') {
      // Keep gated sections open in best/worst so every section shows up
      const applicable = q.options.filter((o) => !o.notApplicable);
      if (mode !== 'random' && applicable.length) pool = applicable;
    } else if (mode !== 'random') {
      const scorable = q.options.filter((o) => !o.notApplicable);
      if (scorable.length) pool = scorable;
    }
    let pick: Option;
    if (mode === 'random') pick = pool[Math.floor(Math.random() * pool.length)];
    else {
      const sorted = [...pool].sort((a, b) => optionValue(def, b) - optionValue(def, a));
      pick = mode === 'best' ? sorted[0] : sorted[sorted.length - 1];
    }
    return { optionIds: [pick.id], otherText: pick.allowOtherText ? 'Sample' : undefined };
  }
  if (q.type === 'rating') {
    const min = q.scale?.min ?? 1;
    const max = q.scale?.max ?? 5;
    const v = mode === 'best' ? max : mode === 'worst' ? min : min + Math.floor(Math.random() * (max - min + 1));
    return { value: v };
  }
  if (q.type === 'number') return { value: 10 };
  return { text: 'Sample answer' };
}

export const QUESTION_TYPE_LABELS: Record<Question['type'], string> = {
  single: 'Multiple choice (one answer)',
  multi: 'Checkboxes (many answers)',
  dropdown: 'Dropdown',
  yesno: 'Yes / No',
  rating: 'Rating scale',
  text: 'Short text',
  longtext: 'Long text',
  number: 'Number',
};

export const ROLE_LABELS: Record<Question['role'], string> = {
  scored: 'Scored',
  gate: 'Gate (decides if section applies)',
  segment: 'Segment (profiling, not scored)',
  info: 'Info only (not scored)',
};
