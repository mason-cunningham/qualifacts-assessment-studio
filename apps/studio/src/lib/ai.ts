import {
  AiDraftSchema,
  KnowledgeExtractSchema,
  OptionsResultSchema,
  ReviewResultSchema,
  RewriteResultSchema,
  TierCopyResultSchema,
  type AiDraft,
  type AiEvent,
  type AiRequest,
  type ExtractKnowledgeRequest,
  type GenerateRequest,
  type ImportRequest,
  type KnowledgeExtract,
  type OptionsRequest,
  type OptionsResult,
  type ReviewRequest,
  type ReviewResult,
  type RewriteRequest,
  type RewriteResult,
  type TierCopyRequest,
  type TierCopyResult,
} from '@qq/ai';
import { supabase, SUPABASE_URL } from './supabase';

const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

type ResultFor<R extends AiRequest> =
  R extends GenerateRequest | ImportRequest ? AiDraft
  : R extends ExtractKnowledgeRequest ? KnowledgeExtract
  : R extends RewriteRequest ? RewriteResult
  : R extends OptionsRequest ? OptionsResult
  : R extends TierCopyRequest ? TierCopyResult
  : R extends ReviewRequest ? ReviewResult
  : never;

const SCHEMA = {
  generate: AiDraftSchema,
  import: AiDraftSchema,
  extract_knowledge: KnowledgeExtractSchema,
  rewrite: RewriteResultSchema,
  options: OptionsResultSchema,
  tier_copy: TierCopyResultSchema,
  review: ReviewResultSchema,
} as const;

export interface AiRunResult<T> {
  data: T;
  requestId: string | null;
  usage: { input: number; output: number; cacheRead: number };
}

export class AiError extends Error {}

/**
 * Call the ai-assist Edge Function and stream progress.
 * The Anthropic key never touches the browser; this only sends the user's Supabase session.
 */
export async function runAi<R extends AiRequest>(
  req: R,
  opts: { onProgress?: (phase: string, chars: number) => void; signal?: AbortSignal } = {},
): Promise<AiRunResult<ResultFor<R>>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new AiError('Please sign in again.');

  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-assist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError("Couldn't reach the AI service. Is the ai-assist Edge Function deployed?");
  }

  if (!res.ok || !res.body) {
    let msg = `AI request failed (${res.status}).`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
      else if (j?.message) msg = j.message;
    } catch {
      /* not JSON */
    }
    if (res.status === 404) msg = 'The ai-assist Edge Function isn’t deployed yet.';
    throw new AiError(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: Extract<AiEvent, { type: 'result' }> | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6)) as AiEvent;
      if (ev.type === 'progress') opts.onProgress?.(ev.phase, ev.chars);
      else if (ev.type === 'error') throw new AiError(ev.message);
      else if (ev.type === 'result') final = ev;
    }
  }

  if (!final) throw new AiError('The AI response ended early (the request may have timed out). Try again with fewer questions or less context.');
  const parsed = SCHEMA[req.mode].safeParse(final.data);
  if (!parsed.success) throw new AiError('The AI returned an unexpected format. Please try again.');
  return { data: parsed.data as ResultFor<R>, requestId: final.requestId, usage: final.usage };
}
