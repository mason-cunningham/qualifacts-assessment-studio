// ─────────────────────────────────────────────────────────────────────────────
// Supabase Edge Function: report-pdf  (SOURCE, bundled by scripts/build-edge.mjs)
//
// Writes a personalized PDF report for one assessment response:
//   facts from the stored response + published version  →  Claude writes the narrative
//   (grounded in the assessment's Knowledge docs)  →  pdf-lib draws it in Ekster  →
//   uploaded to the public "q-quiz-reports" bucket  →  report_url saved on the response.
//
// Called by:
//   • the database (q_quiz_after_response_insert via pg_net), with header x-report-secret
//   • Studio (Generate / Regenerate / Preview), with the signed-in user's JWT
// Deploy with "Verify JWT" OFF: this function checks the secret or the user itself.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MODEL } from '../../../../packages/ai/src/prompts';
import {
  REPORT_SYSTEM_PROMPT,
  buildReportFacts,
  reportTask,
  tidyReportContent,
  type ReportDefinitionInput,
  type ReportResponseInput,
  type ReportSettings,
} from '../../../../packages/ai/src/report';
import { buildReportPdf } from '../../../../packages/ai/src/report-pdf';
import type { ReportContent } from '../../../../packages/ai/src/schemas';
import { extractJsonObject } from '../../../../packages/ai/src/json';
import { SCHEMAS } from '../../ai-assist/src/generated-schemas';
import { FONTS } from './generated-fonts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const BUCKET = 'q-quiz-reports';
const DEFAULT_ORIGINS = ['https://qualifacts-assess.netlify.app', 'http://localhost:5173', 'http://127.0.0.1:5173'];
const AI_TIMEOUT_MS = 110_000;
const STALE_GENERATING_MS = 3 * 60_000;
const MAX_KNOWLEDGE_CHARS = 300_000;

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_ORIGINS;
  const h: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (body: unknown, status: number, cors: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomHex = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

interface Body {
  response_id?: string;
  force?: boolean;
  /** Studio preview: a sample response built in the browser; nothing is saved to a response */
  preview?: { assessment_id: string; response: ReportResponseInput; definition: ReportDefinitionInput };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'The ANTHROPIC_API_KEY secret is missing.' }, 503, cors);
  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400, cors);
  }

  // ── Who is calling? The database (shared secret) or a Studio user (JWT) ──
  const secret = Deno.env.get('REPORT_WEBHOOK_SECRET');
  const fromDatabase = !!secret && req.headers.get('x-report-secret') === secret;
  let uid: string | null = null;
  if (!fromDatabase) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: 'Please sign in again.' }, 401, cors);
    uid = data.user.id;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const assessmentId = body.preview?.assessment_id
      ?? (await db.from('q-quiz-responses').select('assessment_id').eq('id', body.response_id ?? '').maybeSingle()).data?.assessment_id;
    if (!assessmentId) return json({ error: 'Response not found.' }, 404, cors);
    const { data: ok } = await asUser.rpc('q_quiz_can_edit_assessment', { p_id: assessmentId });
    if (!ok) return json({ error: "You don't have permission to generate reports for this assessment." }, 403, cors);
  } else if (body.preview) {
    return json({ error: 'Previews need a signed-in user.' }, 403, cors);
  }

  // ── Preview: generate synchronously and return the link ──
  if (body.preview) {
    try {
      const { data: a } = await db.from('q-quiz-assessments').select('id,title,slug,product_line,settings').eq('id', body.preview.assessment_id).single();
      if (!a) return json({ error: 'Assessment not found.' }, 404, cors);
      const out = await generate(db, apiKey, {
        assessment: a,
        response: body.preview.response,
        definition: body.preview.definition,
        uid,
        path: `previews/${a.slug}/${randomHex(10)}.pdf`,
      });
      return json({ url: out.url }, 200, cors);
    } catch (e) {
      return json({ error: friendly(e) }, 500, cors);
    }
  }

  if (!body.response_id) return json({ error: 'Missing response_id.' }, 400, cors);

  // ── A response: claim it, then work in the background so callers return fast ──
  const { data: r } = await db.from('q-quiz-responses').select('id,report_status,report_started_at,report_path').eq('id', body.response_id).maybeSingle();
  if (!r) return json({ error: 'Response not found.' }, 404, cors);
  const startedAgo = r.report_started_at ? Date.now() - new Date(r.report_started_at).getTime() : Infinity;
  if (!body.force && (r.report_status === 'ready' || (r.report_status === 'generating' && startedAgo < STALE_GENERATING_MS))) {
    return json({ status: r.report_status }, 200, cors);
  }
  await db.from('q-quiz-responses').update({ report_status: 'generating', report_started_at: new Date().toISOString(), report_error: null }).eq('id', r.id);

  const job = runForResponse(db, apiKey, r.id, r.report_path, uid);
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(job);
    return json({ status: 'generating' }, 202, cors);
  }
  await job;
  const { data: done } = await db.from('q-quiz-responses').select('report_status,report_url,report_error').eq('id', r.id).single();
  return json(done, 200, cors);
});

async function runForResponse(db: SupabaseClient, apiKey: string, responseId: string, oldPath: string | null, uid: string | null) {
  try {
    const { data: resp, error } = await db.from('q-quiz-responses').select('*').eq('id', responseId).single();
    if (error || !resp) throw new Error('Response not found.');
    const { data: a } = await db.from('q-quiz-assessments').select('id,title,slug,product_line,settings,draft_definition').eq('id', resp.assessment_id).single();
    if (!a) throw new Error('Assessment not found.');
    let definition: ReportDefinitionInput = a.draft_definition;
    if (resp.version_id) {
      const { data: v } = await db.from('q-quiz-versions').select('definition').eq('id', resp.version_id).maybeSingle();
      if (v?.definition) definition = v.definition;
    }
    const out = await generate(db, apiKey, {
      assessment: a,
      response: resp,
      definition,
      uid,
      path: `${a.slug}/${responseId}-${randomHex(8)}.pdf`,
    });
    await db.from('q-quiz-responses').update({
      report_status: 'ready', report_url: out.url, report_path: out.path, report_error: null, report_generated_at: new Date().toISOString(),
    }).eq('id', responseId);
    if (oldPath && oldPath !== out.path) await db.storage.from(BUCKET).remove([oldPath]);
  } catch (e) {
    console.error('report failed', e);
    await db.from('q-quiz-responses').update({ report_status: 'failed', report_error: friendly(e).slice(0, 500) }).eq('id', responseId);
  }
}

async function generate(
  db: SupabaseClient,
  apiKey: string,
  args: {
    assessment: { id: string; title: string; slug: string; product_line: string | null; settings: { report?: Partial<ReportSettings>; ai_brief?: { knowledgeIds?: string[] } } | null };
    response: ReportResponseInput;
    definition: ReportDefinitionInput;
    uid: string | null;
    path: string;
  },
): Promise<{ url: string; path: string }> {
  const started = Date.now();
  const settings = args.assessment.settings?.report ?? {};
  const facts = buildReportFacts({ response: args.response, definition: args.definition, settings, assessment: args.assessment });

  // Knowledge docs that ground the narrative
  const knowledgeIds = (settings.knowledgeIds?.length ? settings.knowledgeIds : args.assessment.settings?.ai_brief?.knowledgeIds) ?? [];
  let knowledgeText = '';
  if (knowledgeIds.length) {
    const { data } = await db.from('q-quiz-knowledge').select('title,kind,topic,content').in('id', knowledgeIds.slice(0, 20)).eq('is_active', true);
    knowledgeText = (data ?? [])
      .map((k: { title: string; kind: string; topic: string | null; content: string }) => `<document title="${k.title}" kind="${k.kind}"${k.topic ? ` topic="${k.topic}"` : ''}>\n${k.content}\n</document>`)
      .join('\n\n')
      .slice(0, MAX_KNOWLEDGE_CHARS);
  }

  // ── Claude writes the narrative (labels and numbers come from the facts) ──
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), AI_TIMEOUT_MS);
  let usage = { input: 0, output: 0 };
  let status: 'ok' | 'error' = 'ok';
  let errorMsg: string | null = null;
  let content: ReportContent;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMAS.Report } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: REPORT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          ...(knowledgeText ? [{ type: 'text' as const, text: `<reference_documents>\n${knowledgeText}\n</reference_documents>`, cache_control: { type: 'ephemeral' as const } }] : []),
          { type: 'text' as const, text: reportTask(facts, settings.guidance) },
        ],
      }],
    }, { signal: abort.signal });
    const msg = await stream.finalMessage();
    usage = { input: msg.usage.input_tokens ?? 0, output: msg.usage.output_tokens ?? 0 };
    if (msg.stop_reason === 'refusal') throw new Error('Claude declined to write this report.');
    if (msg.stop_reason === 'max_tokens') throw new Error('The report was too long to finish.');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    content = tidyReportContent(extractJsonObject(text) as ReportContent, facts);
  } catch (e) {
    status = 'error';
    errorMsg = abort.signal.aborted ? 'Writing the report took too long.' : friendly(e);
    throw new Error(errorMsg);
  } finally {
    clearTimeout(timer);
    await db.from('q-quiz-ai-requests').insert({
      user_id: args.uid, assessment_id: args.assessment.id, mode: 'report', model: MODEL,
      input_tokens: usage.input, output_tokens: usage.output, status, error: errorMsg,
      duration_ms: Date.now() - started, request_meta: { knowledge: knowledgeIds.length, sections: facts.analyzeIds.length },
    }).then(({ error }) => error && console.error('log failed', error.message));
  }

  // ── Draw and upload ──
  const logoPng = await loadLogo(db);
  const pdf = await buildReportPdf(facts, content, {
    regular: fromB64(FONTS.regular), bold: fromB64(FONTS.bold), extraBold: fromB64(FONTS.extraBold), logoPng,
  });
  const { error: upErr } = await db.storage.from(BUCKET).upload(args.path, pdf, { contentType: 'application/pdf', upsert: true, cacheControl: '3600' });
  if (upErr) throw new Error(`Couldn't save the PDF: ${upErr.message}`);
  return { url: db.storage.from(BUCKET).getPublicUrl(args.path).data.publicUrl, path: args.path };
}

/** White logo for the dark header. Configurable via q-quiz-config "report_logo_url". */
async function loadLogo(db: SupabaseClient): Promise<Uint8Array | null> {
  const { data } = await db.from('q-quiz-config').select('value').eq('key', 'report_logo_url').maybeSingle();
  const configured = typeof data?.value === 'string' ? data.value : '';
  const src = configured || `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/assets/${encodeURIComponent('Qualifacts_Logo_Trademark_RGB_SecondaryColor.png')}`;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function friendly(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is busy. Try again in a minute.';
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key is invalid.';
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? 'network'}).`;
  return (e as Error)?.message || 'Something went wrong.';
}
