import { z } from 'zod/v4';

// ─────────────────────────────────────────────────────────────────────────────
// Structured-output schemas for Claude.
//
// Constraints from the structured-outputs API that shape this file:
//  • At most 16 union-typed parameters per schema (nullable = union), so we use
//    NO nullables at all: "" means "none" for strings and 0 means "not set" for
//    numbers. `draftToDefinition()` interprets those sentinels.
//  • No numeric/string constraints, no recursion, additionalProperties:false.
//  (enforced by packages/ai/src/mapper.test.ts)
//
// AiDraft is too large for constrained decoding (the API rejects it with
// "compiled grammar is too large"), so generate/import send its JSON Schema as
// a prompt instruction instead and Studio validates the result with zod. The
// smaller editor-helper schemas below still use output_config.format.
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
  points: z.number().describe('Points for this answer when scoringMethod is "points"; 0 otherwise'),
  isGap: z.boolean().describe('True when this answer reveals an operational gap'),
  notApplicable: z.boolean().describe('On a gate question: marks the section not applicable. On a scored question: excludes it from scoring'),
  allowOtherText: z.boolean().describe('True for an "Other (please specify)" answer'),
  recommendProductId: z.string().describe('ID of a provided product that solves the need this answer reveals, or "" for none'),
  recommendBadge: z.string().describe('Short badge for the recommendation card, e.g. "Top Priority" or "Opportunity"; "" if no recommendation'),
  recommendRank: z.number().describe('Lower ranks sort first (0 for the weakest answer, 5 for a partial answer)'),
});

export const AiQuestionSchema = z.object({
  key: z.string().describe('Short unique key, e.g. "q1"'),
  sectionKey: z.string(),
  type: z.enum(AI_QUESTION_TYPES),
  role: z.enum(AI_ROLES),
  text: z.string(),
  shortLabel: z.string().describe('2–5 word label used in reports and results, e.g. "Denial tracking"'),
  helpText: z.string().describe('Optional help text; "" for none'),
  required: z.boolean(),
  options: z.array(AiOptionSchema).describe('Answer choices for single/multi/dropdown/yesno questions; empty for others'),
  ratingMin: z.number().describe('Rating questions only (usually 1); 0 otherwise'),
  ratingMax: z.number().describe('Rating questions only (usually 5); 0 otherwise'),
  ratingMinLabel: z.string().describe('Rating questions only; "" otherwise'),
  ratingMaxLabel: z.string().describe('Rating questions only; "" otherwise'),
  showIfQuestionKey: z.string().describe('Key of an EARLIER question that controls whether this one is shown; "" to always show'),
  showIfOptionLabels: z.array(z.string()).describe('Exact labels of the controlling question\'s answers that make this question appear'),
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
  body: z.string().describe('Guidance paragraph (Markdown; may use {{weakestSection}}, {{score}}); "" for none'),
});

export const AiInsightSchema = z.object({
  when: z.enum(['always', 'sectionsBelowCount', 'weakestInclude', 'overallBetween']),
  pct: z.number().describe('sectionsBelowCount: the percent threshold; 0 otherwise'),
  atLeast: z.number().describe('sectionsBelowCount: how many sections; 0 otherwise'),
  sectionKeys: z.array(z.string()).describe('weakestInclude: section keys; empty otherwise'),
  topN: z.number().describe('weakestInclude: among the N weakest sections; 0 otherwise'),
  min: z.number().describe('overallBetween: lower bound; 0 otherwise'),
  max: z.number().describe('overallBetween: upper bound; 0 otherwise'),
  body: z.string(),
});

export const AiDraftSchema = z.object({
  title: z.string(),
  description: z.string(),
  productLine: z.string().describe('"" if not specific to one product line'),
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
    intro: z.string().describe('"" for none'),
    emptyMessage: z.string().describe('Shown when nothing is recommended; "" for the default'),
  }),
  leadCapture: z.object({
    position: z.enum(['beforeResults', 'beforeQuestions', 'off']),
    heading: z.string(),
    body: z.string().describe('"" for none'),
    fieldKeys: z.array(z.enum(AI_LEAD_KEYS)),
    requiredKeys: z.array(z.enum(AI_LEAD_KEYS)),
  }),
  results: z.object({
    eyebrow: z.string(),
    headline: z.string().describe('Overrides tier summaries when set; usually ""'),
    body: z.string().describe('Extra results-page content; "" for none'),
    showSectionBreakdown: z.boolean(),
    showGapList: z.boolean(),
    showInsights: z.boolean(),
    showRecommendations: z.boolean(),
    primaryCtaLabel: z.string().describe('"" for no button'),
    primaryCtaUrl: z.string().describe('Full https:// URL, or ""'),
    footerNote: z.string().describe('"" for none'),
    thankYouHeadline: z.string().describe('Surveys only; "" otherwise'),
    thankYouBody: z.string().describe('Surveys only; "" otherwise'),
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
    points: z.number().describe('Points when scoring by points; 0 otherwise'),
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
    questionNumber: z.number().describe('1-based question number from the provided list, or 0 if not about one question'),
    message: z.string(),
    suggestion: z.string(),
  })),
});

export const KnowledgeExtractSchema = z.object({
  title: z.string(),
  kind: z.enum(['product_info', 'best_practices', 'messaging', 'reference']),
  topic: z.string(),
  productLine: z.string().describe('"" if not specific to one product line'),
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
