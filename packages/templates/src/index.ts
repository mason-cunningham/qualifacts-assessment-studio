import { parseDefinition, type AssessmentDefinition } from '@qq/schema';
import eligibility from './eligibility.json';
import insync from './insync-operational.json';
import ces from './ces-healthcheck.json';
import payment from './payment-posting-survey.json';

export interface TemplateInfo {
  key: string;
  name: string;
  description: string;
  scoringLabel: string;
  suggestedSlug: string;
  definition: AssessmentDefinition;
}

function load(raw: unknown, key: string): AssessmentDefinition {
  const res = parseDefinition(raw);
  if (!res.ok || !res.definition) {
    throw new Error(`Template "${key}" is invalid:\n${(res.errors ?? []).join('\n')}`);
  }
  return res.definition;
}

export const BUILT_IN_TEMPLATES: TemplateInfo[] = [
  {
    key: 'eligibility',
    name: 'Eligibility Health Check',
    description: '20 questions · points (1–3) · section scores · guidance by weakest areas',
    scoringLabel: 'Points',
    suggestedSlug: 'eligibility-health-check',
    definition: load(eligibility, 'eligibility'),
  },
  {
    key: 'insync-operational',
    name: 'InSync Operational Assessment',
    description: 'Gap flags by module · gate questions · add-on mapping',
    scoringLabel: 'Gaps',
    suggestedSlug: 'insync-operational-assessment',
    definition: load(insync, 'insync-operational'),
  },
  {
    key: 'ces-healthcheck',
    name: 'Client Engagement Health Check',
    description: 'Points (0/5/10) · feature cards recommended by answer, ranked by impact',
    scoringLabel: 'Points + recommendations',
    suggestedSlug: 'ces-healthcheck',
    definition: load(ces, 'ces-healthcheck'),
  },
  {
    key: 'payment-posting-survey',
    name: 'Patient Payment Posting Survey',
    description: 'Unscored survey · segments · 1–5 ratings · optional email up front',
    scoringLabel: 'Survey (no score)',
    suggestedSlug: 'payment-posting-survey',
    definition: load(payment, 'payment-posting-survey'),
  },
];
