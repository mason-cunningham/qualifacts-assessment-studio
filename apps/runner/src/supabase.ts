import { createClient } from '@supabase/supabase-js';
import type { SubmissionPayload } from '@qq/schema';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// Guard against email/security gateways (e.g. Mimecast URL Protect) rewriting the
// Supabase URL inside a built bundle, which silently breaks every save.
export const SUPABASE_HOST_OK = typeof url === 'string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url);

// The runner never signs anyone in; it only calls the three public RPCs.
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export interface PublishedAssessment {
  assessment_id: string;
  version_id: string;
  slug: string;
  title: string;
  is_open: boolean;
  closed_message: string | null;
  definition: unknown | null;
}

export async function getPublished(slug: string): Promise<PublishedAssessment | null> {
  const { data, error } = await supabase.rpc('q_quiz_get_published', { p_slug: slug });
  if (error) throw error;
  return (data as PublishedAssessment | null) ?? null;
}

export async function submitResponse(payload: SubmissionPayload): Promise<string | null> {
  if (!SUPABASE_HOST_OK) throw new Error('Supabase URL looks corrupted');
  const { data, error } = await supabase.rpc('q_quiz_submit_response', { p_payload: payload });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export function trackEvent(args: {
  assessmentId: string;
  versionId?: string | null;
  sessionId: string;
  type: 'view' | 'start' | 'answer' | 'lead_form_view' | 'complete' | 'cta_click' | 'results_download' | 'product_click';
  questionId?: string;
  meta?: Record<string, unknown>;
}) {
  // Fire and forget: analytics must never block or break the experience
  supabase
    .rpc('q_quiz_track_event', {
      p_assessment_id: args.assessmentId,
      p_session_id: args.sessionId,
      p_event_type: args.type,
      p_question_id: args.questionId ?? null,
      p_meta: args.meta ?? {},
      p_version_id: args.versionId ?? null,
    })
    .then(({ error }) => {
      if (error) console.debug('track failed', error.message);
    });
}
