-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 004: Knowledge Library + AI usage logging
-- Run once in the Supabase SQL editor (after schema.sql).
-- NON-DESTRUCTIVE: no DROP/DELETE. Safe to run more than once.
-- ════════════════════════════════════════════════════════════════════════════

-- Reusable context for AI generation: product facts, best practices, messaging…
create table if not exists public."q-quiz-knowledge" (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  kind             text not null default 'reference'
                     check (kind in ('product_info', 'best_practices', 'messaging', 'reference')),
  topic            text,                 -- e.g. "RCM", "Clinical documentation"
  product_line     text,                 -- e.g. "InSync", "CareLogic"
  content          text not null default '',
  source_filename  text,
  source_path      text,                 -- original upload in the private q-quiz-imports bucket
  char_count       int generated always as (char_length(content)) stored,
  tags             text[] not null default '{}',
  is_active        boolean not null default true,
  created_by       uuid references public."q-quiz-profiles"(id) on delete set null default auth.uid(),
  updated_by       uuid references public."q-quiz-profiles"(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists q_quiz_knowledge_topic_idx on public."q-quiz-knowledge" (topic, kind);

create or replace trigger q_quiz_knowledge_updated_at before update on public."q-quiz-knowledge"
  for each row execute function public.q_quiz_touch_updated_at();

alter table public."q-quiz-knowledge" enable row level security;
revoke all on public."q-quiz-knowledge" from anon;

select public.q_quiz_ensure_policy('public', 'q-quiz-knowledge', 'q_quiz_knowledge_select',
  $p$create policy q_quiz_knowledge_select on public."q-quiz-knowledge" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-knowledge', 'q_quiz_knowledge_insert',
  $p$create policy q_quiz_knowledge_insert on public."q-quiz-knowledge" for insert to authenticated with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-knowledge', 'q_quiz_knowledge_update',
  $p$create policy q_quiz_knowledge_update on public."q-quiz-knowledge" for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-knowledge', 'q_quiz_knowledge_delete',
  $p$create policy q_quiz_knowledge_delete on public."q-quiz-knowledge" for delete to authenticated using (public.q_quiz_is_admin())$p$);

-- AI usage log: timing + request details (tokens/model/status already exist)
alter table public."q-quiz-ai-requests"
  add column if not exists duration_ms  int,
  add column if not exists request_meta jsonb not null default '{}'::jsonb;
create index if not exists q_quiz_ai_requests_user_idx on public."q-quiz-ai-requests" (user_id, created_at desc);

-- AI settings (admins can change these in the q-quiz-config table)
insert into public."q-quiz-config" (key, value, description) values
  ('ai_enabled',              'true',   'Master switch for AI tools in Studio.'),
  ('ai_daily_limit_per_user', '25',     'Max AI requests per user per rolling 24 hours.'),
  ('ai_effort_generate',      '"high"', 'Claude effort for full generation/import: low | medium | high | xhigh | max.')
on conflict (key) do nothing;
