-- Qualifacts Assessment Studio — reserve site paths so no assessment can use them.
-- Run once in the Supabase SQL editor. Non-destructive (no DROP/DELETE); safe to re-run.
-- (Already included in schema.sql for fresh installs.)
do $$ begin
  alter table public."q-quiz-assessments"
    add constraint q_quiz_assessments_slug_reserved
    check (slug not in ('studio', 'assets', 'api', 'admin', 'favicon', 'index'));
exception when duplicate_object then null;
end $$;
