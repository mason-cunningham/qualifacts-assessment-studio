-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 006: product feature sets
-- Run once in the Supabase SQL editor (after 005). NON-DESTRUCTIVE; safe to re-run.
--
-- features: [{ id, name, solves, summary, benefits: [], mediaUrl, mediaAlt }]
-- Answers can point to specific features; the results card then shows only those,
-- each with its own image or GIF. Snapshots are copied into assessments on publish.
-- ════════════════════════════════════════════════════════════════════════════

alter table public."q-quiz-products"
  add column if not exists features jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public."q-quiz-products"
    add constraint q_quiz_products_features_chk check (jsonb_typeof(features) = 'array');
exception when duplicate_object then null;
end $$;
