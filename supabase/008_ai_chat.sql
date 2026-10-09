-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 008: editor AI assistant chat history
-- Run once in the Supabase SQL editor (after 007). NON-DESTRUCTIVE; safe to re-run.
--
-- One row per message in an assessment's AI chat. Assistant rows carry the proposed
-- changes and what happened to them (applied / discarded). Anyone who can view the
-- assessment can read its chat; anyone who can edit it can add to it.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public."q-quiz-assessment-ai-chat" (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  user_id        uuid references public."q-quiz-profiles"(id) on delete set null default auth.uid(),
  role           text not null check (role in ('user', 'assistant')),
  content        text not null default '',
  images         jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  changes        jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  status         text not null default 'answered'
                   check (status in ('proposed', 'applied', 'partly_applied', 'discarded', 'answered', 'undone')),
  created_at     timestamptz not null default now()
);
create index if not exists q_quiz_ai_chat_assessment_idx on public."q-quiz-assessment-ai-chat" (assessment_id, created_at);

alter table public."q-quiz-assessment-ai-chat" enable row level security;
revoke all on public."q-quiz-assessment-ai-chat" from anon;

select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-ai-chat', 'q_quiz_ai_chat_select',
  $p$create policy q_quiz_ai_chat_select on public."q-quiz-assessment-ai-chat" for select to authenticated using (public.q_quiz_can_view_assessment(assessment_id))$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-ai-chat', 'q_quiz_ai_chat_insert',
  $p$create policy q_quiz_ai_chat_insert on public."q-quiz-assessment-ai-chat" for insert to authenticated with check (public.q_quiz_can_edit_assessment(assessment_id) and user_id = auth.uid())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-ai-chat', 'q_quiz_ai_chat_update',
  $p$create policy q_quiz_ai_chat_update on public."q-quiz-assessment-ai-chat" for update to authenticated using (public.q_quiz_can_edit_assessment(assessment_id)) with check (public.q_quiz_can_edit_assessment(assessment_id))$p$);
