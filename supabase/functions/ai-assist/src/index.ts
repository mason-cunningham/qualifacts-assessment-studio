// ─────────────────────────────────────────────────────────────────────────────
// Supabase Edge Function: ai-assist  (SOURCE, bundled by scripts/build-edge.mjs)
//
// The ONLY place the Anthropic API key is used. It is read from the Edge Function
// secret ANTHROPIC_API_KEY at request time. It never reaches browsers or git.
//
// Every request must come from an active Studio editor/admin (Supabase JWT), is
// rate-limited per user per day, and is logged to "q-quiz-ai-requests".
// Responses stream as Server-Sent Events so long generations don't time out.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import {
  MODEL,
  SYSTEM_PROMPT,
  contextBlocks,
  extractKnowledgeTask,
  generateTask,
  importTask,
  optionsTask,
  reviewTask,
  rewriteTask,
  tierCopyTask,
  type KnowledgeDoc,
  type PdfForPrompt,
  type ProductForPrompt,
} from '../../../../packages/ai/src/prompts';
import { AI_LIMITS, type AiEvent, type AiMode, type AiRequest, type StoredFile, type TextAttachment } from '../../../../packages/ai/src/requests';
import { extractJsonObject } from '../../../../packages/ai/src/json';
import { SCHEMAS } from './generated-schemas';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (req: Request) => Response | Promise<Response>): void };

const DEFAULT_ORIGINS = ['https://qualifacts-assess.netlify.app', 'http://localhost:5173', 'http://127.0.0.1:5173'];

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// constrained: false → the schema is too large for structured outputs ("compiled grammar
// is too large"), so it goes in the system prompt instead and Studio validates with zod.
const MODE_CONFIG: Record<AiMode, { schema: keyof typeof SCHEMAS; effort: Effort; maxTokens: number; constrained: boolean }> = {
  generate: { schema: 'AiDraft', effort: 'high', maxTokens: 32000, constrained: false },
  import: { schema: 'AiDraft', effort: 'high', maxTokens: 32000, constrained: false },
  extract_knowledge: { schema: 'KnowledgeExtract', effort: 'medium', maxTokens: 16000, constrained: true },
  rewrite: { schema: 'RewriteResult', effort: 'low', maxTokens: 4000, constrained: true },
  options: { schema: 'OptionsResult', effort: 'low', maxTokens: 4000, constrained: true },
  tier_copy: { schema: 'TierCopyResult', effort: 'medium', maxTokens: 8000, constrained: true },
  review: { schema: 'ReviewResult', effort: 'medium', maxTokens: 8000, constrained: true },
};

function schemaInstruction(schema: keyof typeof SCHEMAS): string {
  return 'Respond with ONLY a single JSON object (no prose, no code fences) that matches this JSON Schema. ' +
    'Include every property; use "" / 0 / [] / false for anything not applicable. ' +
    'Where a description says {enum: [...]}, use one of those exact values.\n\n' +
    JSON.stringify(SCHEMAS[schema]);
}

const GENERATE_PHASES: [string, string][] = [
  ['"designNotes"', 'Finishing up'],
  ['"results"', 'Writing the results page'],
  ['"leadCapture"', 'Setting up the lead form'],
  ['"recommendations"', 'Mapping solutions'],
  ['"insights"', 'Writing guidance'],
  ['"tiers"', 'Designing score tiers'],
  ['"questions"', 'Writing questions'],
  ['"sections"', 'Planning sections'],
  ['"intro"', 'Writing the intro'],
];

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

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: "AI isn't set up yet. An admin needs to add the ANTHROPIC_API_KEY secret in Supabase." }, 503, cors);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(url, service, { auth: { persistSession: false } });

  // ── Who is calling? ──
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Please sign in again.' }, 401, cors);
  const uid = userData.user.id;
  const { data: me } = await db.from('q-quiz-profiles').select('role,is_active').eq('id', uid).maybeSingle();
  if (!me || !me.is_active || !['admin', 'editor'].includes(me.role)) {
    return json({ error: 'AI tools are available to editors and admins only.' }, 403, cors);
  }

  // ── Config: enabled flag, daily limit, effort override ──
  const { data: cfgRows } = await db.from('q-quiz-config').select('key,value').in('key', ['ai_enabled', 'ai_daily_limit_per_user', 'ai_effort_generate']);
  const cfg = new Map((cfgRows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  if (cfg.get('ai_enabled') === false) return json({ error: 'AI tools are turned off by an admin.' }, 403, cors);
  const dailyLimit = Number(cfg.get('ai_daily_limit_per_user') ?? 25);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from('q-quiz-ai-requests').select('id', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', since);
  if ((count ?? 0) >= dailyLimit) {
    return json({ error: `You've reached today's limit of ${dailyLimit} AI requests. It resets on a rolling 24-hour basis.` }, 429, cors);
  }

  // ── Parse request ──
  let body: AiRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400, cors);
  }
  const mode = body?.mode as AiMode;
  const conf = MODE_CONFIG[mode];
  if (!conf) return json({ error: `Unknown mode "${String(mode)}".` }, 400, cors);
  let effort = conf.effort;
  const effortOverride = cfg.get('ai_effort_generate');
  if ((mode === 'generate' || mode === 'import') && typeof effortOverride === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effortOverride)) {
    effort = effortOverride as Effort;
  }

  // ── Load context (knowledge, products, files) ──
  let content: Anthropic.Beta.BetaContentBlockParam[];
  const meta: Record<string, unknown> = {};
  try {
    content = await buildContent(db, body, meta);
  } catch (e) {
    return json({ error: (e as Error).message }, 400, cors);
  }

  // ── Stream from Claude ──
  const started = Date.now();
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AiEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 15000);
      let status: 'ok' | 'error' = 'ok';
      let errorMsg: string | null = null;
      let usage = { input: 0, output: 0, cacheRead: 0 };
      let model = MODEL;
      try {
        const s = client.beta.messages.stream({
          model: MODEL,
          max_tokens: conf.maxTokens,
          thinking: { type: 'adaptive' },
          output_config: conf.constrained
            ? { effort, format: { type: 'json_schema', schema: SCHEMAS[conf.schema] } }
            : { effort },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: conf.constrained
            ? [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]
            : [
                { type: 'text', text: SYSTEM_PROMPT },
                { type: 'text', text: schemaInstruction(conf.schema), cache_control: { type: 'ephemeral' } },
              ],
          messages: [{ role: 'user', content }],
        });

        let text = '';
        let lastPhase = '';
        let lastSent = 0;
        send({ type: 'progress', phase: 'Reading your context', chars: 0 });
        for await (const ev of s) {
          if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking' && lastPhase !== 'Thinking it through') {
            lastPhase = 'Thinking it through';
            send({ type: 'progress', phase: lastPhase, chars: text.length });
          } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            const phase = conf.schema === 'AiDraft'
              ? GENERATE_PHASES.find(([k]) => text.includes(k))?.[1] ?? 'Drafting'
              : 'Writing';
            if (phase !== lastPhase || Date.now() - lastSent > 700) {
              lastPhase = phase;
              lastSent = Date.now();
              send({ type: 'progress', phase, chars: text.length });
            }
          }
        }
        const msg = await s.finalMessage();
        model = msg.model ?? MODEL;
        usage = {
          input: msg.usage.input_tokens ?? 0,
          output: msg.usage.output_tokens ?? 0,
          cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        };
        if (msg.stop_reason === 'refusal') throw new Error("Claude declined this request. Try rephrasing the brief or removing sensitive content from the context.");
        if (msg.stop_reason === 'max_tokens') throw new Error('The response was too long to finish. Try fewer questions or less context.');
        const out = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
        let data: unknown;
        try {
          data = extractJsonObject(out);
        } catch {
          throw new Error("Claude's response couldn't be read. Please try again.");
        }
        send({ type: 'result', data, requestId: msg.id ?? null, usage });
      } catch (e) {
        status = 'error';
        errorMsg = friendlyError(e);
        send({ type: 'error', message: errorMsg });
      } finally {
        clearInterval(ping);
        await db.from('q-quiz-ai-requests').insert({
          user_id: uid,
          mode,
          model,
          input_tokens: usage.input,
          output_tokens: usage.output,
          status,
          error: errorMsg,
          duration_ms: Date.now() - started,
          request_meta: { ...meta, effort, cache_read_tokens: usage.cacheRead },
        }).then(({ error }) => error && console.error('log failed', error.message));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
});

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is busy right now. Please try again in a minute.';
  if (e instanceof Anthropic.AuthenticationError) return 'The Anthropic API key is invalid or revoked. Ask an admin to update the ANTHROPIC_API_KEY secret.';
  if (e instanceof Anthropic.PermissionDeniedError) return "The Anthropic API key doesn't have access to this model.";
  if (e instanceof Anthropic.BadRequestError) return `The AI service rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status ?? 'network'}). Please try again.`;
  return (e as Error)?.message || 'Something went wrong.';
}

// ── Context assembly ─────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function buildContent(db: any, body: AiRequest, meta: Record<string, unknown>): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  switch (body.mode) {
    case 'generate':
    case 'import': {
      const ctx = await loadContext(db, body.knowledgeIds ?? [], body.productIds ?? [], body.files ?? [], body.attachments ?? [], body.notes ?? '');
      meta.knowledge = ctx.knowledge.length;
      meta.products = ctx.products.length;
      meta.files = ctx.pdfs.length + ctx.attachments.length;
      if (body.mode === 'import' && ctx.pdfs.length + ctx.attachments.length === 0) throw new Error('Upload the questionnaire you want to import.');
      const task = body.mode === 'import'
        ? importTask(body.brief)
        : generateTask(body.brief, body.revisionNotes ? { notes: body.revisionNotes, previous: body.previousDraft } : undefined);
      return [...contextBlocks(ctx), { type: 'text', text: task }];
    }
    case 'extract_knowledge': {
      const ctx = await loadContext(db, [], [], body.files ?? [], body.attachments ?? [], '');
      if (ctx.pdfs.length + ctx.attachments.length === 0) throw new Error('Upload a file to extract.');
      meta.files = ctx.pdfs.length + ctx.attachments.length;
      return [...contextBlocks({ ...ctx, products: [], knowledge: [] }, { includeProducts: false }), { type: 'text', text: extractKnowledgeTask(body) }];
    }
    case 'rewrite':
      return [{ type: 'text', text: rewriteTask(body) }];
    case 'options':
      return [{ type: 'text', text: optionsTask(body) }];
    case 'tier_copy':
      return [{ type: 'text', text: tierCopyTask(body) }];
    case 'review':
      if (!body.outline || body.outline.length > 200_000) throw new Error('Nothing to review.');
      return [{ type: 'text', text: reviewTask(body.outline) }];
  }
}

// deno-lint-ignore no-explicit-any
async function loadContext(db: any, knowledgeIds: string[], productIds: string[], files: StoredFile[], attachments: TextAttachment[], notes: string) {
  let knowledge: KnowledgeDoc[] = [];
  if (knowledgeIds.length) {
    const { data, error } = await db.from('q-quiz-knowledge').select('id,title,kind,topic,product_line,content').in('id', knowledgeIds.slice(0, 50)).eq('is_active', true);
    if (error) throw new Error(`Couldn't load knowledge documents: ${error.message}`);
    knowledge = data ?? [];
  }
  let products: ProductForPrompt[] = [];
  if (productIds.length) {
    const { data, error } = await db.from('q-quiz-products').select('id,name,product_line,category,tagline,what_it_does,why_it_matters,benefits').in('id', productIds.slice(0, 100));
    if (error) throw new Error(`Couldn't load products: ${error.message}`);
    products = (data ?? []).map((p: ProductForPrompt) => ({ ...p, benefits: Array.isArray(p.benefits) ? p.benefits : [] }));
  }

  if (files.length + attachments.length > AI_LIMITS.maxFiles) throw new Error(`Attach at most ${AI_LIMITS.maxFiles} files at a time.`);
  const pdfs: PdfForPrompt[] = [];
  const texts: TextAttachment[] = attachments.map((a) => ({ name: String(a.name).slice(0, 200), text: String(a.text) }));
  for (const f of files) {
    if (typeof f.path !== 'string' || f.path.includes('..')) throw new Error('Invalid file reference.');
    const { data, error } = await db.storage.from('q-quiz-imports').download(f.path);
    if (error || !data) throw new Error(`Couldn't read ${f.name}.`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (bytes.length > AI_LIMITS.maxFileBytes) throw new Error(`${f.name} is larger than 20 MB.`);
    if ((f.mediaType || '').includes('pdf') || f.name.toLowerCase().endsWith('.pdf')) pdfs.push({ name: f.name, base64: toBase64(bytes) });
    else texts.push({ name: f.name, text: new TextDecoder().decode(bytes) });
  }

  const size = knowledge.reduce((s, k) => s + (k.content?.length ?? 0), 0) + texts.reduce((s, t) => s + t.text.length, 0) + notes.length;
  if (size > AI_LIMITS.maxContextChars) {
    throw new Error(`That's too much context (${Math.round(size / 1000)}k characters; the limit is ${AI_LIMITS.maxContextChars / 1000}k). Remove a document or two.`);
  }
  return { knowledge, products, notes, attachments: texts, pdfs };
}
