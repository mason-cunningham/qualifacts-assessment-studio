import type { AssessmentDefinition, LeadValues } from '@qq/schema';
import type { AssessmentResults } from './scoring';

export const MERGE_TAGS = [
  { tag: '{{score}}', help: 'Headline score as displayed (e.g. 72% or 41)' },
  { tag: '{{pct}}', help: 'Overall percent (0–100)' },
  { tag: '{{points}}', help: 'Points earned' },
  { tag: '{{maxPoints}}', help: 'Points possible' },
  { tag: '{{tier}}', help: 'Overall tier label' },
  { tag: '{{gapCount}}', help: 'Number of gaps flagged' },
  { tag: '{{onTrackCount}}', help: 'Counted questions without a gap' },
  { tag: '{{countedCount}}', help: 'Questions counted toward the score' },
  { tag: '{{weakestSection}}', help: 'Name of the lowest-scoring section' },
  { tag: '{{recommendationCount}}', help: 'Number of recommended solutions' },
  { tag: '{{firstName}}', help: "Respondent's first name" },
  { tag: '{{organization}}', help: "Respondent's organization" },
  { tag: '{{title}}', help: 'Assessment title' },
] as const;

export function formatScore(def: AssessmentDefinition, r: AssessmentResults): string {
  if (r.pct === null && r.max === 0) return '';
  return def.scoring.display === 'points' ? String(round2(r.points)) : `${r.pct ?? 0}%`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildMergeContext(
  def: AssessmentDefinition,
  r: AssessmentResults | null,
  lead: LeadValues = {},
): Record<string, string> {
  return {
    score: r ? formatScore(def, r) : '',
    pct: r?.pct != null ? String(r.pct) : '',
    points: r ? String(round2(r.points)) : '',
    maxPoints: r ? String(round2(r.max)) : '',
    tier: r?.tier?.label ?? '',
    gapCount: r ? String(r.gapCount) : '',
    onTrackCount: r ? String(r.countedCount - r.gapCount) : '',
    countedCount: r ? String(r.countedCount) : '',
    weakestSection: r?.weakestSection?.name ?? '',
    recommendationCount: r ? String(r.recommendations.length) : '',
    firstName: lead.first_name ?? '',
    organization: lead.organization || 'your organization',
    title: def.meta.title,
  };
}

/**
 * Replace {{tags}} in a string. Unknown tags are left as-is so typos are visible in preview.
 * "{{score}}%" doesn't double the sign: when a value already ends in "%", a "%" right after the tag is dropped.
 */
export function renderTemplate(text: string | undefined, ctx: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/\{\{\s*(\w+)\s*\}\}(%?)/g, (m, key: string, pct: string) => {
    if (!(key in ctx)) return m;
    const v = ctx[key];
    return pct && v.endsWith('%') ? v : v + pct;
  });
}
