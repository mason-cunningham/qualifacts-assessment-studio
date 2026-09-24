import {
  AssessmentDefinitionSchema,
  BRAND_COLORS,
  SCHEMA_VERSION,
  type AssessmentDefinition,
  type LeadField,
  type Option,
  type Question,
  type QuestionType,
  type Section,
  type Tier,
} from './definition';

/** Short, URL-safe, collision-resistant id for sections/questions/options. */
export function newId(prefix = ''): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return prefix ? `${prefix}_${rand}` : rand;
}

export const DEFAULT_LEAD_FIELDS: LeadField[] = [
  { key: 'first_name', label: 'First name', type: 'text', required: true },
  { key: 'last_name', label: 'Last name', type: 'text', required: true },
  { key: 'email', label: 'Work email', type: 'email', required: true },
  { key: 'organization', label: 'Organization', type: 'text', required: true },
  { key: 'job_title', label: 'Job title', type: 'text', required: false },
];

export const DEFAULT_TIERS: Tier[] = [
  { id: 'tier_strong', min: 80, max: 100, label: 'Strong Foundation', color: BRAND_COLORS.teal,
    summary: "You're in great shape. A few refinements could close the remaining gaps." },
  { id: 'tier_room', min: 60, max: 79, label: 'Room to Improve', color: BRAND_COLORS.amber,
    summary: 'Good practices are in place, but meaningful gaps are likely costing you time and revenue.' },
  { id: 'tier_gaps', min: 0, max: 59, label: 'Significant Opportunity', color: BRAND_COLORS.magenta,
    summary: 'Several areas show real gaps. The good news: they are very solvable.' },
];

export const DEFAULT_SECTION_TIERS: Tier[] = [
  { id: 'st_solid', min: 90, max: 100, label: 'Solid', color: BRAND_COLORS.teal, body: 'This area looks solid. Keep it up.' },
  { id: 'st_some', min: 60, max: 89, label: 'Some Gaps', color: BRAND_COLORS.amber, body: 'Some gaps here, worth tightening up.' },
  { id: 'st_priority', min: 0, max: 59, label: 'Priority', color: BRAND_COLORS.magenta, body: 'This is a priority area.' },
];

export function createOption(label = '', points?: number): Option {
  return { id: newId('o'), label, ...(points !== undefined ? { points } : {}) };
}

export function createQuestion(sectionId: string, type: QuestionType = 'single'): Question {
  const base: Question = {
    id: newId('q'),
    sectionId,
    type,
    role: 'scored',
    text: '',
    required: true,
    weight: 1,
    options: [],
  };
  if (type === 'yesno') {
    base.options = [
      { id: newId('o'), label: 'Yes', points: 1 },
      { id: newId('o'), label: 'No', points: 0, isGap: true },
    ];
  } else if (type === 'single' || type === 'multi' || type === 'dropdown') {
    base.options = [createOption('', 3), createOption('', 2), createOption('', 1)];
  } else if (type === 'rating') {
    base.scale = { min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very much' };
  } else {
    base.role = 'info';
  }
  return base;
}

export function createSection(name = 'New section'): Section {
  return { id: newId('s'), name, weight: 1, productIds: [], naBehavior: 'monitor', showInResults: true };
}

export function createBlankDefinition(title = 'Untitled assessment'): AssessmentDefinition {
  const section = createSection('Section 1');
  const q = createQuestion(section.id, 'single');
  return AssessmentDefinitionSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    meta: { title },
    theme: { accent: 'teal' },
    intro: {
      eyebrow: 'Free Assessment',
      headline: title,
      subheadline: '',
      body: '',
      startLabel: 'Start Your Assessment',
      estimatedMinutes: 3,
    },
    sections: [section],
    questions: [q],
    scoring: {
      method: 'points',
      overall: 'allQuestions',
      tierBasis: 'percent',
      display: 'percent',
      tiers: DEFAULT_TIERS,
      sectionTiers: DEFAULT_SECTION_TIERS,
    },
    leadCapture: { position: 'beforeResults', fields: DEFAULT_LEAD_FIELDS },
    results: {},
  });
}

export interface ParseResult {
  ok: boolean;
  definition?: AssessmentDefinition;
  errors?: string[];
}

/** Parse untrusted JSON (DB rows, uploads, AI output) into a fully-defaulted definition. */
export function parseDefinition(input: unknown): ParseResult {
  const upgraded = upgradeDefinition(input);
  const res = AssessmentDefinitionSchema.safeParse(upgraded);
  if (res.success) return { ok: true, definition: res.data };
  return {
    ok: false,
    errors: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/** Hook for future schema migrations. v1 is current, so this only fills a missing version. */
export function upgradeDefinition(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const obj = { ...(input as Record<string, unknown>) };
  if (obj.schemaVersion === undefined) obj.schemaVersion = SCHEMA_VERSION;
  if (!obj.meta) obj.meta = { title: 'Untitled assessment' };
  return obj;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
