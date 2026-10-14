-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 009: AI-generated PDF reports per response
-- Run once in the Supabase SQL editor (after 008). NON-DESTRUCTIVE; safe to re-run.
--
-- When an assessment has settings.report.enabled = true, every completed (non-test)
-- response gets a PDF written by the report-pdf Edge Function. The database calls the
-- function with pg_net, authenticated by a shared secret kept in Supabase Vault.
--
-- ONE-TIME SETUP (see the rollout notes):
--   1. Vault → New secret, name: report_webhook_secret, value: a long random string
--   2. Edge Functions → Secrets: REPORT_WEBHOOK_SECRET = the same value
--   3. Deploy the report-pdf function with "Verify JWT" OFF
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── Public bucket for report PDFs (unguessable file names) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('q-quiz-reports', 'q-quiz-reports', true, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- ── Report status on each response ──
alter table public."q-quiz-responses"
  add column if not exists report_status       text not null default 'none',
  add column if not exists report_url          text,
  add column if not exists report_path         text,
  add column if not exists report_error        text,
  add column if not exists report_started_at   timestamptz,
  add column if not exists report_generated_at timestamptz;
do $$ begin
  alter table public."q-quiz-responses"
    add constraint q_quiz_responses_report_status_chk
    check (report_status in ('none', 'pending', 'generating', 'ready', 'failed'));
exception when duplicate_object then null;
end $$;

-- Where the database sends report jobs (change if the project URL changes)
insert into public."q-quiz-config" (key, value, description) values
  ('report_function_url', '"https://thjclunkjqnknsozlyyj.supabase.co/functions/v1/report-pdf"', 'URL of the report-pdf Edge Function that writes PDF reports.'),
  ('report_logo_url', '""', 'Optional PNG logo for the dark PDF header. Empty = the white Qualifacts logo in the "assets" bucket.')
on conflict (key) do nothing;

-- Mark new responses as pending when their assessment has reports turned on
create or replace function public.q_quiz_before_response_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.is_test and exists (
    select 1 from public."q-quiz-assessments" a
     where a.id = new.assessment_id and coalesce((a.settings #>> '{report,enabled}')::boolean, false)
  ) then
    new.report_status := 'pending';
  end if;
  return new;
end $$;

create or replace trigger q_quiz_before_response_report before insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_before_response_report();

-- ...then ask the Edge Function to write it. Never blocks or fails the response.
create or replace function public.q_quiz_after_response_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url    text;
  v_secret text;
begin
  if new.report_status <> 'pending' then
    return new;
  end if;
  begin
    select value #>> '{}' into v_url from public."q-quiz-config" where key = 'report_function_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'report_webhook_secret' limit 1;
    if coalesce(v_url, '') <> '' and coalesce(v_secret, '') <> '' then
      perform net.http_post(
        url := v_url,
        body := jsonb_build_object('response_id', new.id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-report-secret', v_secret),
        timeout_milliseconds := 10000
      );
    end if;
  exception when others then
    -- pg_net / Vault not set up yet: the report stays "pending" and can be generated from Studio
    raise warning 'report job not queued: %', sqlerrm;
  end;
  return new;
end $$;

create or replace trigger q_quiz_after_response_report after insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_after_response_report();

revoke execute on function public.q_quiz_before_response_report() from public, anon, authenticated;
revoke execute on function public.q_quiz_after_response_report()  from public, anon, authenticated;
