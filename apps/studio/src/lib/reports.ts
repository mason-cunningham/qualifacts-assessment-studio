import type { AssessmentDefinition } from '@qq/schema';
import { buildSubmission, computeResults } from '@qq/engine';
import type { ReportResponseInput } from '@qq/ai';
import { sampleAnswers } from '../pages/editor/helpers';
import { supabase, errorMessage } from './supabase';
import type { ReportStatus } from './types';

// Client for the report-pdf Edge Function (AI-written PDF report per response).

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('report-pdf', { body });
  if (error) {
    // The function returns { error } with a non-2xx status; surface its message
    let msg = errorMessage(error);
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) msg = ((await ctx.json()) as { error?: string }).error ?? msg;
    } catch { /* keep the generic message */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = "The report-pdf Edge Function isn't deployed yet.";
    throw new Error(msg);
  }
  return data as T;
}

/** Start (or restart, with force) the report for a response. It finishes in the background. */
export function requestReport(responseId: string, force = false) {
  return invoke<{ status: ReportStatus; report_url?: string }>({ response_id: responseId, force });
}

/** Build a report from sample answers on the current draft, without saving a response. */
export async function previewReport(assessmentId: string, def: AssessmentDefinition, mode: 'best' | 'worst' | 'random' = 'random') {
  const answers = sampleAnswers(def, mode);
  const results = computeResults(def, answers);
  const sub = buildSubmission({
    def,
    assessmentId,
    sessionId: crypto.randomUUID(),
    answers,
    results,
    lead: { first_name: 'Sample', last_name: 'Respondent', organization: 'Sample Organization', job_title: 'Director of Operations' },
  });
  const response = { ...sub, completed_at: new Date().toISOString() } as unknown as ReportResponseInput;
  return invoke<{ url: string }>({ preview: { assessment_id: assessmentId, response, definition: def } });
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  none: 'No report',
  pending: 'Queued…',
  generating: 'Writing report…',
  ready: 'Ready',
  failed: 'Failed',
};

export const reportInProgress = (s: ReportStatus | null | undefined) => s === 'pending' || s === 'generating';
