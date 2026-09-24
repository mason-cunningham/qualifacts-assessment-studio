/**
 * A respondent's answer to one question.
 *  single / dropdown / yesno / multi → optionIds
 *  rating / number                  → value
 *  text / longtext                  → text
 *  otherText                        → free text for an option with allowOtherText
 */
export interface AnswerValue {
  optionIds?: string[];
  value?: number;
  text?: string;
  otherText?: string;
}

export type Answers = Record<string, AnswerValue | undefined>;

/** Lead form values keyed by LeadField.key */
export type LeadValues = Record<string, string>;

/** Shape stored per answer in "q-quiz-responses".answers (and exposed by the q-quiz-response-answers view). */
export interface AnswerRecord {
  question_id: string;
  section_id: string;
  section_name: string;
  question_text: string;
  short_label: string;
  type: string;
  role: string;
  answer_label: string | null;
  value: unknown;
  other_text?: string | null;
  points: number | null;
  max_points: number | null;
  is_gap: boolean | null;
  counted: boolean;
  skipped: boolean;
}

/** Payload sent to q_quiz_submit_response(). */
export interface SubmissionPayload {
  assessment_id: string;
  version_id?: string | null;
  session_id?: string;
  hp?: string;
  is_test?: boolean;
  first_name?: string;
  last_name?: string;
  email?: string;
  organization?: string;
  job_title?: string;
  phone?: string;
  state?: string;
  lead_fields?: Record<string, string>;
  consent?: boolean | null;
  score_pct?: number | null;
  score_points?: number | null;
  score_max?: number | null;
  tier_key?: string | null;
  tier_label?: string | null;
  section_scores?: unknown[];
  answers?: AnswerRecord[];
  recommendations?: unknown[];
  source?: string | null;
  rep_code?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  started_at?: string | null;
}
