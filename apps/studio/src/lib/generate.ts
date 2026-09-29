import {
  AI_LIMITS,
  AiDraftSchema,
  mergeStages,
  sectionQuestionsFromDraft,
  type AiDraft,
  type AiQuestion,
  type ContextPayload,
  type GenerateBrief,
} from '@qq/ai';
import { AiError, runAi } from './ai';

export interface GenerateProgress {
  /** Headline shown on the generating card */
  phase: string;
  /** Characters written so far in the current step(s) */
  chars: number;
  sectionsDone: number;
  sectionsTotal: number;
}

/**
 * Staged AI generation that fits Supabase Free's 150 s Edge Function limit:
 *   1. one plan call (structure, scoring, results copy, a brief per section)
 *   2. one call per section for its questions, a few at a time, each retried once
 *   3. merge into the same AiDraft the old single-shot call returned
 */
export async function generateDraft(
  base: ContextPayload & { brief: GenerateBrief },
  opts: {
    importMode?: boolean;
    revision?: { notes: string; previous: AiDraft };
    onProgress?: (p: GenerateProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ draft: AiDraft; requestId: string | null }> {
  const report = (p: GenerateProgress) => opts.onProgress?.(p);
  const revisionNotes = opts.revision?.notes;

  // 1. Plan
  report({ phase: 'Planning the assessment', chars: 0, sectionsDone: 0, sectionsTotal: 0 });
  const planRes = await runAi(
    {
      mode: 'generate_plan',
      ...base,
      importMode: opts.importMode,
      ...(opts.revision ? { revisionNotes, previousDraft: opts.revision.previous } : {}),
    },
    {
      signal: opts.signal,
      onProgress: (phase, chars) => report({ phase: `Planning: ${phase.toLowerCase()}`, chars, sectionsDone: 0, sectionsTotal: 0 }),
    },
  );
  const plan = planRes.data;
  if (!plan.sections.length) throw new AiError('The AI plan had no sections. Please try again.');

  // 2. Sections, a few at a time
  const total = plan.sections.length;
  const bySection: Record<string, AiQuestion[]> = {};
  const chars = new Map<string, number>();
  let done = 0;
  const tick = () => report({
    phase: `Writing questions: ${done} of ${total} sections done`,
    chars: [...chars.values()].reduce((a, b) => a + b, 0),
    sectionsDone: done,
    sectionsTotal: total,
  });
  tick();

  const runSection = async (sectionKey: string) => {
    const req = {
      mode: 'generate_section' as const,
      ...base,
      importMode: opts.importMode,
      plan,
      sectionKey,
      ...(opts.revision ? { revisionNotes, previousQuestions: sectionQuestionsFromDraft(opts.revision.previous, sectionKey) } : {}),
    };
    const onProgress = (_: string, c: number) => { chars.set(sectionKey, c); tick(); };
    try {
      return (await runAi(req, { signal: opts.signal, onProgress })).data.questions;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      chars.set(sectionKey, 0);
      return (await runAi(req, { signal: opts.signal, onProgress })).data.questions; // one retry
    }
  };

  const queue = plan.sections.map((s) => s.key);
  let failed = false;
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined && !failed; key = queue.shift()) {
      try {
        bySection[key] = await runSection(key);
      } catch (e) {
        failed = true; // don't start more sections once one has failed twice
        throw e;
      }
      done++;
      tick();
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_LIMITS.sectionConcurrency, total) }, worker));

  // 3. Merge + validate
  const merged = mergeStages(plan, bySection);
  const parsed = AiDraftSchema.safeParse(merged);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join('.');
    throw new AiError(`The AI returned an unexpected format${path ? ` (${path})` : ''}. Please try again.`);
  }
  if (!parsed.data.questions.length) throw new AiError('The AI didn\'t write any questions. Please try again.');
  return { draft: parsed.data, requestId: planRes.requestId };
}
