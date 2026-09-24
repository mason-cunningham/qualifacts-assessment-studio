import type { AnswerRecord } from '@qq/schema';

export type Role = 'admin' | 'editor' | 'viewer';
export type AssessmentStatus = 'draft' | 'published' | 'paused' | 'archived';
export type FollowUpStatus = 'new' | 'contacted' | 'qualified' | 'disqualified' | 'customer';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface AssessmentSettings {
  alerts?: { enabled?: boolean; extra_recipients?: string[] };
  crm?: { enabled?: boolean; object?: string; lead_source?: string; campaign_id?: string | null; field_map?: Record<string, string> };
  response_cap?: number | null;
  closed_message?: string;
}

export interface AssessmentRow {
  id: string;
  slug: string;
  title: string;
  internal_name: string | null;
  description: string | null;
  product_line: string | null;
  status: AssessmentStatus;
  draft_definition: unknown;
  published_version_id: string | null;
  settings: AssessmentSettings;
  is_template: boolean;
  closes_at: string | null;
  published_at: string | null;
  owner_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  assessment_id: string;
  version_number: number;
  definition: unknown;
  change_note: string | null;
  published_by: string | null;
  published_at: string;
}

export interface StatsRow {
  assessment_id: string;
  slug: string;
  title: string;
  status: AssessmentStatus;
  responses: number;
  responses_30d: number;
  avg_score: number | null;
  last_response_at: string | null;
  views: number;
  starts: number;
  completion_rate: number | null;
}

export interface SectionScore {
  section_id: string;
  section: string;
  points: number;
  max: number;
  pct: number | null;
  gap_count: number;
  counted: number;
  applicable: boolean;
  gate_answer: string | null;
  tier: string | null;
}

export interface ResponseRow {
  id: string;
  assessment_id: string;
  version_id: string | null;
  session_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  organization: string | null;
  job_title: string | null;
  phone: string | null;
  state: string | null;
  lead_fields: Record<string, string>;
  consent: boolean | null;
  score_pct: number | null;
  score_points: number | null;
  score_max: number | null;
  tier_key: string | null;
  tier_label: string | null;
  section_scores: SectionScore[];
  answers: AnswerRecord[];
  recommendations: { product_id: string; name: string; badge: string | null; rank: number }[];
  source: string | null;
  rep_code: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  user_agent: string | null;
  started_at: string | null;
  completed_at: string;
  follow_up_status: FollowUpStatus;
  assigned_to: string | null;
  internal_notes: string | null;
  is_test: boolean;
  owner_id: string | null;
  crm_sync_status: string;
  crm_external_id: string | null;
  created_at: string;
}

export interface ProductRow {
  id: string;
  name: string;
  product_line: string | null;
  category: string | null;
  tagline: string | null;
  what_it_does: string | null;
  why_it_matters: string | null;
  benefits: string[];
  image_url: string | null;
  logo_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  tags: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  assessment_id: string | null;
  response_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export type KnowledgeKind = 'product_info' | 'best_practices' | 'messaging' | 'reference';

export interface KnowledgeRow {
  id: string;
  title: string;
  kind: KnowledgeKind;
  topic: string | null;
  product_line: string | null;
  content: string;
  source_filename: string | null;
  source_path: string | null;
  char_count: number;
  tags: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  product_info: 'Product info',
  best_practices: 'Best practices',
  messaging: 'Messaging',
  reference: 'Reference',
};

export interface AiRequestRow {
  id: string;
  user_id: string | null;
  mode: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  status: 'ok' | 'error';
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export const FOLLOW_UP_LABELS: Record<FollowUpStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  customer: 'Customer',
};

export const PRODUCT_LINES = ['InSync', 'CareLogic', 'Credible', 'Streamline', 'Qualifacts iQ', 'RCMS', 'CES', 'Greenspace', 'Other'];
