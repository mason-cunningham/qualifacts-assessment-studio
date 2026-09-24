import { z } from 'zod/v4';

// ─────────────────────────────────────────────────────────────────────────────
// Structured-output schemas for Claude.
//
// Deliberately flat and generation-friendly: every field is required (nullable
// instead of optional), no recursion, no numeric/string constraints. That keeps
// them inside the structured-outputs JSON Schema subset. `draftToDefinition()`
// converts an AiDraft into the app's full AssessmentDefinition.
//
// Imported by BOTH the Supabase Edge Function (bundled) and Studio. Keep this
// file free of Node/browser-specific imports.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_COLORS = ['teal', 'amber', 'magenta', 'darkMagenta', 'navy', 'grey'] as const;
export const AI_QUESTION_TYPES = ['single', 'multi', 'dropdown', 'yesno', 'rating', 'text', 'longtext'] as const;
export const AI_ROLES = ['scored', 'gate', 'segment', 'info'] as const;
export const AI_LEAD_KEYS = ['first_name', 'last_name', 'email', 'organization', 'job_title', 'phone', 'state'] as const;

export const AiOptionSchema = z.object({
  label: z.string().describe('Answer text shown to the respondent'),
  points: z.number().nullable().describe('Points for this answer when scoringMethod is "points"; null otherwise'),
  isGap: z.boolean().describe('True when this answer reveals an operational gap'),
  notApplicable: z.boolean().describe('On a gate question: marks the section not applicable. On a scored question: excludes it from scoring'),
  allowOtherText: z.boolean().describe('True for an "Other (please specify)" answer'),
  recommendProductId: z.string().nullable().describe('ID of a provided product that solves the need this answer reveals, or null'),
  recommendBadge: z.string().nullable().describe('Short badge for the recommendation card, e.g. "Top Priority" or "Opportunity"'),
  recommendRank: z.number().nullable().describe('Lower ranks sort first (e.g. 0 for the worst answer, 5 for a partial answer)'),
});

export const AiQuestionSchema = z.object({
  key: z.string().describe('Short unique key, e.g. "q1"'),
  sectionKey: z.string(),
  type: z.enum(AI_QUESTION_TYPES),
  role: z.enum(AI_ROLES),
  text: z.string(),
  shortLabel: z.string().describe('2–5 word label used in reports and results, e.g. "Denial tracking"'),
  helpText: z.string().nullable(),
  required: z.boolean(),
  options: z.array(AiOptionSchema).describe('Answer choices for single/multi/dropdown/yesno questions; empty for others'),
  ratingMin: z.number().nullable(),
  ratingMax: z.number().nullable(),
  ratingMinLabel: z.string().nullable(),
  ratingMaxLabel: z.string().nullable(),
  showIfQuestionKey: z.string().nullable().describe('Only show this question when an EARLIER question has one of showIfOptionLabels selected'),
  showIfOptionLabels: z.array(z.string()),
});

export const AiSectionSchema = z.object({
  key: z.string().describe('Short unique key, e.g. "s1"'),
  name: z.string(),
  productIds: z.array(z.string()).describe('IDs of provided products that solve this area (shown as "Solved by")'),
  showInResults: z.boolean(),
});

export const AiTierSchema = z.object({
  min: z.number(),
  max: z.number(),
  label: z.string(),
  color: z.enum(AI_COLORS),
  summary: z.string().describe('One sentence under the tier name'),
  body: z.string().nullable().describe('Optional guidance paragraph (Markdown; may use {{weakestSection}}, {{score}})'),
});

export const AiInsightSchema = z.object({
  when: z.enum(['always', 'sectionsBelowCount', 'weakestInclude', 'overallBetween']),
  pct: z.number().nullable(),
  atLeast: z.number().nullable(),
  sectionKeys: z.array(z.string()),
  topN: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  body: z.string(),
});

export const AiDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  productLine: z.string().nullable(),
  intro: z.object({
    eyebrow: z.string(),
    headline: z.string(),
    subheadline: z.string(),
    body: z.string(),
    bullets: z.array(z.string()),
    startLabel: z.string(),
    estimatedMinutes: z.number(),
  }),
  scoringMethod: z.enum(['points', 'gaps', 'none']),
  tierBasis: z.enum(['percent', 'points']),
  display: z.enum(['percent', 'points']),
  sections: z.array(AiSectionSchema),
  questions: z.array(AiQuestionSchema),
  tiers: z.array(AiTierSchema),
  sectionTiers: z.array(AiTierSchema),
  insights: z.array(AiInsightSchema).describe('Ordered guidance rules; the first match is shown. End with an "always" fallback'),
  recommendations: z.object({
    enabled: z.boolean(),
    heading: z.string(),
    intro: z.string().nullable(),
    emptyMessage: z.string().nullable(),
  }),
  leadCapture: z.object({
    position: z.enum(['beforeResults', 'beforeQuestions', 'off']),
    heading: z.string(),
    body: z.string().nullable(),
    fieldKeys: z.array(z.enum(AI_LEAD_KEYS)),
    requiredKeys: z.array(z.enum(AI_LEAD_KEYS)),
  }),
  results: z.object({
    eyebrow: z.string(),
    headline: z.string().nullable(),
    body: z.string().nullable(),
    showSectionBreakdown: z.boolean(),
    showGapList: z.boolean(),
    showInsights: z.boolean(),
    showRecommendations: z.boolean(),
    primaryCtaLabel: z.string().nullable(),
    primaryCtaUrl: z.string().nullable(),
    footerNote: z.string().nullable(),
    thankYouHeadline: z.string().nullable(),
    thankYouBody: z.string().nullable(),
  }),
  designNotes: z.string().describe('2–4 sentences for the creator explaining the structure and scoring choices'),
});

// ── Editor helpers ──────────────────────────────────────────────────────────

export const RewriteResultSchema = z.object({
  alternatives: z.array(z.object({ text: z.string(), shortLabel: z.string(), why: z.string() })),
});

export const OptionsResultSchema = z.object({
  options: z.array(z.object({
    label: z.string(),
    points: z.number().nullable(),
    isGap: z.boolean(),
    notApplicable: z.boolean(),
  })),
  rationale: z.string(),
});

export const TierCopyResultSchema = z.object({
  tiers: z.array(z.object({ label: z.string(), summary: z.string(), body: z.string() })),
});

export const ReviewResultSchema = z.object({
  overall: z.string(),
  issues: z.array(z.object({
    severity: z.enum(['high', 'medium', 'low']),
    area: z.enum(['content', 'scoring', 'results', 'lead', 'branding', 'other']),
    questionNumber: z.number().nullable().describe('1-based question number from the provided list, or null'),
    message: z.string(),
    suggestion: z.string(),
  })),
});

export const KnowledgeExtractSchema = z.object({
  title: z.string(),
  kind: z.enum(['product_info', 'best_practices', 'messaging', 'reference']),
  topic: z.string(),
  productLine: z.string().nullable(),
  content: z.string().describe('Clean, well-structured Markdown notes capturing every useful fact'),
  summary: z.string(),
});

export type AiOption = z.infer<typeof AiOptionSchema>;
export type AiQuestion = z.infer<typeof AiQuestionSchema>;
export type AiSection = z.infer<typeof AiSectionSchema>;
export type AiTier = z.infer<typeof AiTierSchema>;
export type AiInsight = z.infer<typeof AiInsightSchema>;
export type AiDraft = z.infer<typeof AiDraftSchema>;
export type RewriteResult = z.infer<typeof RewriteResultSchema>;
export type OptionsResult = z.infer<typeof OptionsResultSchema>;
export type TierCopyResult = z.infer<typeof TierCopyResultSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
export type KnowledgeExtract = z.infer<typeof KnowledgeExtractSchema>;
