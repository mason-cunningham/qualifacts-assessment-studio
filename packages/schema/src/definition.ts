import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDefinition: the single JSON document that fully describes an
// assessment. The Studio edits it, the AI generates it, the runner renders it,
// and @qq/engine scores it. Stored in "q-quiz-assessments".draft_definition and
// snapshotted into "q-quiz-versions".definition on publish.
//
// Bump SCHEMA_VERSION and add a migration in factory.ts#upgradeDefinition when
// making a breaking change.
// ─────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;

export const ACCENTS = ['teal', 'magenta', 'navy', 'amber'] as const;

export const BRAND_COLORS = {
  teal: '#00B2A9',
  tealDark: '#008F87',
  navy: '#2D2264',
  magenta: '#C6007E',
  magentaDark: '#A0006A',
  amber: '#E8A317',
  grey: '#B8B8C4',
} as const;

// ── Options & branching ─────────────────────────────────────────────────────

export const RecommendSchema = z.object({
  productIds: z.array(z.string()).default([]),
  /** Badge on the recommendation card, e.g. "Top Priority" / "Opportunity" */
  badge: z.string().optional(),
  /** Lower ranks sort first. Ties broken by product priority. */
  rank: z.number().optional(),
});

export const OptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Points earned when selected (points scoring). */
  points: z.number().optional(),
  /** Flags an operational gap (gaps scoring; also listed on results). */
  isGap: z.boolean().optional(),
  /** Selecting this removes the question from scoring. On a gate question, it marks the section not applicable. */
  notApplicable: z.boolean().optional(),
  /** Shows a free-text box when selected ("Other — please specify"). */
  allowOtherText: z.boolean().optional(),
  /** Recommend products when this option is selected. */
  recommend: RecommendSchema.optional(),
});

export const ConditionSchema = z.object({
  questionId: z.string(),
  op: z.enum(['in', 'notIn', 'answered', 'notAnswered', 'gte', 'lte']),
  optionIds: z.array(z.string()).optional(),
  value: z.number().optional(),
});

export const ShowIfSchema = z.object({
  mode: z.enum(['all', 'any']).default('all'),
  conditions: z.array(ConditionSchema).default([]),
});

// ── Questions & sections ────────────────────────────────────────────────────

export const QUESTION_TYPES = ['single', 'multi', 'dropdown', 'yesno', 'rating', 'text', 'longtext', 'number'] as const;
export const CHOICE_TYPES = ['single', 'multi', 'dropdown', 'yesno'] as const;

/**
 * scored  – counts toward the score
 * gate    – decides whether its section applies (options marked notApplicable)
 * segment – firmographic / profiling (org type, role…) – never scored, great for report filters
 * info    – collected but never scored (open-ended feedback etc.)
 */
export const QUESTION_ROLES = ['scored', 'gate', 'segment', 'info'] as const;

export const QuestionSchema = z.object({
  id: z.string(),
  sectionId: z.string(),
  type: z.enum(QUESTION_TYPES),
  role: z.enum(QUESTION_ROLES).default('scored'),
  text: z.string(),
  helpText: z.string().optional(),
  /** Short label used for export column headers and results lists. */
  shortLabel: z.string().optional(),
  required: z.boolean().default(true),
  weight: z.number().default(1),
  imageUrl: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(OptionSchema).default([]),
  scale: z
    .object({
      min: z.number().default(1),
      max: z.number().default(5),
      minLabel: z.string().optional(),
      maxLabel: z.string().optional(),
    })
    .optional(),
  showIf: ShowIfSchema.optional(),
});

export const SectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Relative weight when scoring.overall = 'weightedSections'. */
  weight: z.number().default(1),
  /** Products that solve this area (shown as "Solved by" on the section result). */
  productIds: z.array(z.string()).default([]),
  /**
   * When the section's gate question is answered "not applicable":
   * monitor – still show its answers on results as informational
   * exclude – hide the section's answers from results
   */
  naBehavior: z.enum(['monitor', 'exclude']).default('monitor'),
  showInResults: z.boolean().default(true),
});

// ── Scoring ─────────────────────────────────────────────────────────────────

export const TierSchema = z.object({
  id: z.string(),
  /** A score matches the tier with the highest `min` that is ≤ the score. */
  min: z.number(),
  max: z.number(),
  label: z.string(),
  color: z.string().default(BRAND_COLORS.teal),
  /** One-liner under the tier label. Markdown + merge tags. */
  summary: z.string().optional(),
  /** Longer guidance paragraph. Markdown + merge tags. */
  body: z.string().optional(),
});

export const ScoringSchema = z.object({
  method: z.enum(['points', 'gaps', 'none']).default('points'),
  /** allQuestions: total points ÷ total possible. weightedSections: weighted mean of section %. */
  overall: z.enum(['allQuestions', 'weightedSections']).default('allQuestions'),
  /** Whether overall tiers are matched against percent (0–100) or raw points. */
  tierBasis: z.enum(['percent', 'points']).default('percent'),
  /** How the headline score is shown. */
  display: z.enum(['percent', 'points']).default('percent'),
  tiers: z.array(TierSchema).default([]),
  sectionTiers: z.array(TierSchema).default([]),
});

// ── Recommendations & insights ──────────────────────────────────────────────

export const RuleWhenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sectionBelow'), sectionId: z.string(), pct: z.number() }),
  z.object({ type: z.literal('optionSelected'), questionId: z.string(), optionIds: z.array(z.string()) }),
  z.object({ type: z.literal('gapCountAtLeast'), sectionId: z.string().optional(), count: z.number() }),
  z.object({ type: z.literal('overallBelow'), value: z.number() }),
  z.object({ type: z.literal('always') }),
]);

export const RecommendationRuleSchema = z.object({
  id: z.string(),
  productId: z.string(),
  badge: z.string().optional(),
  rank: z.number().optional(),
  when: RuleWhenSchema,
});

export const RecommendationsSchema = z.object({
  enabled: z.boolean().default(false),
  heading: z.string().default('Recommended solutions'),
  intro: z.string().optional(),
  emptyMessage: z.string().optional(),
  maxShown: z.number().optional(),
  ctaLabel: z.string().optional(),
  rules: z.array(RecommendationRuleSchema).default([]),
});

export const InsightWhenSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('always') }),
  z.object({ type: z.literal('sectionsBelowCount'), pct: z.number(), atLeast: z.number() }),
  z.object({ type: z.literal('weakestInclude'), sectionIds: z.array(z.string()), topN: z.number() }),
  z.object({ type: z.literal('overallBetween'), min: z.number(), max: z.number() }),
  z.object({ type: z.literal('optionSelected'), questionId: z.string(), optionIds: z.array(z.string()) }),
]);

/** Conditional guidance paragraphs. The first matching insight is shown. */
export const InsightSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  when: InsightWhenSchema,
  body: z.string(),
});

// ── Screens ─────────────────────────────────────────────────────────────────

export const LeadFieldSchema = z.object({
  /** Standard keys map to Salesforce Lead fields: first_name, last_name, email, organization, job_title, phone, state. Anything else → lead_fields. */
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'email', 'tel', 'select', 'textarea']).default('text'),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
});

export const LeadCaptureSchema = z.object({
  position: z.enum(['beforeResults', 'beforeQuestions', 'off']).default('beforeResults'),
  heading: z.string().default('Where should we send your results?'),
  body: z.string().optional(),
  fields: z.array(LeadFieldSchema).default([]),
  consentText: z.string().optional(),
  privacyUrl: z.string().optional(),
  submitLabel: z.string().default('See My Results'),
});

export const CtaSchema = z.object({ label: z.string(), url: z.string() });

export const ResultsSchema = z.object({
  eyebrow: z.string().default('Your Results'),
  showScore: z.boolean().default(true),
  /** Headline under the score. Markdown + merge tags. Falls back to the tier summary. */
  headline: z.string().optional(),
  body: z.string().optional(),
  showSectionBreakdown: z.boolean().default(true),
  sectionBreakdownHeading: z.string().default('Breakdown by area'),
  showGapList: z.boolean().default(true),
  showInsights: z.boolean().default(true),
  insightsHeading: z.string().default('Where to focus'),
  showRecommendations: z.boolean().default(true),
  primaryCta: CtaSchema.optional(),
  secondaryCta: CtaSchema.optional(),
  footerNote: z.string().optional(),
  allowPdf: z.boolean().default(true),
  allowRetake: z.boolean().default(true),
  /** Pure surveys: show a thank-you message instead of scores. */
  thankYouOnly: z.boolean().default(false),
  thankYouHeadline: z.string().default('Thank you!'),
  thankYouBody: z.string().optional(),
});

export const IntroSchema = z.object({
  eyebrow: z.string().optional(),
  headline: z.string().default(''),
  subheadline: z.string().optional(),
  body: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  startLabel: z.string().default('Start Your Assessment'),
  imageUrl: z.string().optional(),
  estimatedMinutes: z.number().optional(),
});

export const ThemeSchema = z.object({
  accent: z.enum(ACCENTS).default('teal'),
  logoUrl: z.string().optional(),
  coBrandLogoUrl: z.string().optional(),
  heroImageUrl: z.string().optional(),
  ogImageUrl: z.string().optional(),
});

export const ProductSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  productLine: z.string().optional(),
  tagline: z.string().optional(),
  whatItDoes: z.string().optional(),
  whyItMatters: z.string().optional(),
  benefits: z.array(z.string()).default([]),
  imageUrl: z.string().optional(),
  logoUrl: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaUrl: z.string().optional(),
  /** Lower = more important. Orders recommendation cards within the same rank. */
  priority: z.number().optional(),
});

export const AssessmentDefinitionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  meta: z.object({
    title: z.string().default('Untitled assessment'),
    description: z.string().optional(),
    productLine: z.string().optional(),
  }),
  theme: ThemeSchema.default({}),
  intro: IntroSchema.default({}),
  sections: z.array(SectionSchema).default([]),
  questions: z.array(QuestionSchema).default([]),
  scoring: ScoringSchema.default({}),
  recommendations: RecommendationsSchema.default({}),
  insights: z.array(InsightSchema).default([]),
  leadCapture: LeadCaptureSchema.default({}),
  results: ResultsSchema.default({}),
  /** Product snapshots. Studio refreshes these from "q-quiz-products" on publish. */
  products: z.array(ProductSnapshotSchema).default([]),
});

export type Recommend = z.infer<typeof RecommendSchema>;
export type Option = z.infer<typeof OptionSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type ShowIf = z.infer<typeof ShowIfSchema>;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type QuestionRole = (typeof QUESTION_ROLES)[number];
export type Question = z.infer<typeof QuestionSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Tier = z.infer<typeof TierSchema>;
export type Scoring = z.infer<typeof ScoringSchema>;
export type RuleWhen = z.infer<typeof RuleWhenSchema>;
export type RecommendationRule = z.infer<typeof RecommendationRuleSchema>;
export type Recommendations = z.infer<typeof RecommendationsSchema>;
export type InsightWhen = z.infer<typeof InsightWhenSchema>;
export type Insight = z.infer<typeof InsightSchema>;
export type LeadField = z.infer<typeof LeadFieldSchema>;
export type LeadCapture = z.infer<typeof LeadCaptureSchema>;
export type Cta = z.infer<typeof CtaSchema>;
export type Results = z.infer<typeof ResultsSchema>;
export type Intro = z.infer<typeof IntroSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Accent = (typeof ACCENTS)[number];
export type ProductSnapshot = z.infer<typeof ProductSnapshotSchema>;
export type AssessmentDefinition = z.infer<typeof AssessmentDefinitionSchema>;

export const isChoiceType = (t: QuestionType) => (CHOICE_TYPES as readonly string[]).includes(t);

/** Standard lead keys that have their own column in "q-quiz-responses" (and a Salesforce Lead field). */
export const STANDARD_LEAD_KEYS = {
  first_name: 'FirstName',
  last_name: 'LastName',
  email: 'Email',
  organization: 'Company',
  job_title: 'Title',
  phone: 'Phone',
  state: 'State',
} as const;
export type StandardLeadKey = keyof typeof STANDARD_LEAD_KEYS;
