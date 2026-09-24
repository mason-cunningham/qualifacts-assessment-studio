import {
  STANDARD_LEAD_KEYS,
  type AnswerRecord,
  type Answers,
  type AssessmentDefinition,
  type LeadValues,
  type SubmissionPayload,
} from '@qq/schema';
import { answerLabel, scoreQuestion, type AssessmentResults } from './scoring';
import { isAnswered, isVisible, orderedQuestions } from './visibility';

/** One record per question (visible or skipped) for storage and export. */
export function buildAnswerRecords(
  def: AssessmentDefinition,
  answers: Answers,
  results: AssessmentResults,
): AnswerRecord[] {
  const sectionName = new Map(def.sections.map((s) => [s.id, s.name]));
  const applicable = new Map(results.sections.map((s) => [s.sectionId, s.applicable]));

  return orderedQuestions(def).map((q) => {
    const visible = isVisible(q, def, answers);
    const a = answers[q.id];
    const answered = visible && isAnswered(q, a);
    const s = answered ? scoreQuestion(q, a, def.scoring.method) : null;
    const counted = !!s?.counted && (applicable.get(q.sectionId) ?? true);
    const value =
      !answered ? null
      : a?.optionIds ? (q.type === 'multi' ? a.optionIds : a.optionIds[0])
      : a?.value ?? a?.text ?? null;
    return {
      question_id: q.id,
      section_id: q.sectionId,
      section_name: sectionName.get(q.sectionId) ?? '',
      question_text: q.text,
      short_label: q.shortLabel || q.text,
      type: q.type,
      role: q.role,
      answer_label: answered ? answerLabel(q, a) : null,
      value,
      other_text: answered ? a?.otherText ?? null : null,
      points: s && s.counted ? s.points : null,
      max_points: s && s.counted ? s.max : null,
      is_gap: s && s.counted ? s.isGap : null,
      counted,
      skipped: !visible || !answered,
    };
  });
}

export interface Attribution {
  source?: string | null;
  rep_code?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
}

/** Assemble the q_quiz_submit_response() payload. */
export function buildSubmission(args: {
  def: AssessmentDefinition;
  assessmentId: string;
  versionId?: string | null;
  sessionId: string;
  answers: Answers;
  results: AssessmentResults;
  lead: LeadValues;
  consent?: boolean | null;
  attribution?: Attribution;
  startedAt?: string | null;
  honeypot?: string;
  isTest?: boolean;
}): SubmissionPayload {
  const { def, results, lead } = args;
  const standard: Record<string, string> = {};
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead)) {
    if (!v) continue;
    if (k in STANDARD_LEAD_KEYS) standard[k] = v.trim();
    else custom[k] = v.trim();
  }
  const scored = def.scoring.method !== 'none';

  return {
    assessment_id: args.assessmentId,
    version_id: args.versionId ?? null,
    session_id: args.sessionId,
    hp: args.honeypot ?? '',
    is_test: args.isTest ?? false,
    ...standard,
    lead_fields: custom,
    consent: args.consent ?? null,
    score_pct: scored ? results.pct : null,
    score_points: scored ? results.points : null,
    score_max: scored ? results.max : null,
    tier_key: results.tier?.id ?? null,
    tier_label: results.tier?.label ?? null,
    section_scores: results.sections
      .filter((s) => s.hasScoredQuestions)
      .map((s) => ({
        section_id: s.sectionId,
        section: s.name,
        points: s.points,
        max: s.max,
        pct: s.pct,
        gap_count: s.gapCount,
        counted: s.countedCount,
        applicable: s.applicable,
        gate_answer: s.gateAnswerLabel,
        tier: s.tier?.label ?? null,
      })),
    answers: buildAnswerRecords(def, args.answers, results),
    recommendations: results.recommendations.map((r) => ({
      product_id: r.productId,
      name: r.product.name,
      badge: r.badge ?? null,
      rank: r.rank,
    })),
    ...args.attribution,
    started_at: args.startedAt ?? null,
  };
}
