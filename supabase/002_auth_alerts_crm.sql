-- ⚠️⚠️ SUPERSEDED: DO NOT RUN. Use supabase/schema.sql instead (non-destructive, all-in-one). ⚠️⚠️
-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 002: approval-based sign-up, in-app alerts,
-- outbox queue (email + future Salesforce), app config.
--
-- Run AFTER 001_q_quiz_schema.sql. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- 1. APP CONFIG (key/value)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-config" (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

drop trigger if exists q_quiz_config_updated_at on public."q-quiz-config";
create trigger q_quiz_config_updated_at before update on public."q-quiz-config"
  for each row execute function public.q_quiz_touch_updated_at();

insert into public."q-quiz-config" (key, value, description) values
  ('public_base_url',      '"https://qualifacts-assess.netlify.app"', 'Base URL of the public runner. Change when assess.qualifacts.com is live.'),
  ('email_alerts_enabled', 'false',        'When true, new leads also enqueue an email alert in q-quiz-outbox.'),
  ('crm_enabled',          'false',        'Master switch for CRM sync jobs.'),
  ('crm_provider',         '"salesforce"', 'CRM target for crm_sync jobs.')
on conflict (key) do nothing;

create or replace function public.q_quiz_config_bool(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public."q-quiz-config" where key = p_key), false);
$$;

alter table public."q-quiz-config" enable row level security;
revoke all on public."q-quiz-config" from anon;

drop policy if exists q_quiz_config_select on public."q-quiz-config";
create policy q_quiz_config_select on public."q-quiz-config"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_config_write on public."q-quiz-config";
create policy q_quiz_config_write on public."q-quiz-config"
  for all to authenticated using (public.q_quiz_is_admin()) with check (public.q_quiz_is_admin());


-- ════════════════════════════════════════════════════════════════════════════
-- 2. PROFILES: approval-based sign-up
--    New @qualifacts.com users start pending (is_active = false) until an admin
--    approves them. The very first user becomes an active admin automatically.
-- ════════════════════════════════════════════════════════════════════════════
alter table public."q-quiz-profiles" alter column is_active set default false;

create or replace function public.q_quiz_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first boolean;
begin
  if lower(new.email) like '%@qualifacts.com' then
    select not exists (select 1 from public."q-quiz-profiles" where role = 'admin' and is_active) into v_first;

    insert into public."q-quiz-profiles" (id, email, full_name, role, is_active)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
      case when v_first then 'admin' else 'editor' end,
      v_first
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- Users can read their own profile even while pending (so the app can show "Awaiting approval")
drop policy if exists q_quiz_profiles_select_own on public."q-quiz-profiles";
create policy q_quiz_profiles_select_own on public."q-quiz-profiles"
  for select to authenticated using (id = auth.uid());

-- Users can edit their own name/title; the guard trigger below protects role and is_active
drop policy if exists q_quiz_profiles_update_own on public."q-quiz-profiles";
create policy q_quiz_profiles_update_own on public."q-quiz-profiles"
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.q_quiz_guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the SQL editor and the service role; allow those.
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.email is distinct from old.email)
     and not public.q_quiz_is_admin() then
    raise exception 'Only admins can change role, approval or email' using errcode = '42501';
  end if;
  -- Never let the last active admin demote or deactivate themselves
  if (old.role = 'admin' and old.is_active)
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public."q-quiz-profiles"
                     where role = 'admin' and is_active and id <> old.id) then
    raise exception 'At least one active admin is required' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists q_quiz_guard_profile_role on public."q-quiz-profiles";
create trigger q_quiz_guard_profile_role before update on public."q-quiz-profiles"
  for each row execute function public.q_quiz_guard_profile_role();


-- ════════════════════════════════════════════════════════════════════════════
-- 3. RESPONSES: owner snapshot + CRM (Salesforce) readiness
-- ════════════════════════════════════════════════════════════════════════════
alter table public."q-quiz-responses"
  add column if not exists owner_id        uuid references public."q-quiz-profiles"(id) on delete set null,
  add column if not exists crm_sync_status text not null default 'not_configured',
  add column if not exists crm_external_id text,
  add column if not exists crm_synced_at   timestamptz,
  add column if not exists crm_error       text;

do $$ begin
  alter table public."q-quiz-responses"
    add constraint q_quiz_responses_crm_status_chk
    check (crm_sync_status in ('not_configured', 'pending', 'synced', 'failed', 'skipped'));
exception when duplicate_object then null;
end $$;

create index if not exists q_quiz_responses_owner_idx on public."q-quiz-responses" (owner_id, completed_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 4. IN-APP NOTIFICATIONS
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-notifications" (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public."q-quiz-profiles"(id) on delete cascade,
  assessment_id  uuid references public."q-quiz-assessments"(id) on delete cascade,
  response_id    uuid references public."q-quiz-responses"(id) on delete cascade,
  kind           text not null default 'new_lead',
  title          text not null,
  body           text,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists q_quiz_notifications_user_idx
  on public."q-quiz-notifications" (user_id, created_at desc);

alter table public."q-quiz-notifications" enable row level security;
revoke all on public."q-quiz-notifications" from anon;

drop policy if exists q_quiz_notifications_select on public."q-quiz-notifications";
create policy q_quiz_notifications_select on public."q-quiz-notifications"
  for select to authenticated using (user_id = auth.uid());
drop policy if exists q_quiz_notifications_update on public."q-quiz-notifications";
create policy q_quiz_notifications_update on public."q-quiz-notifications"
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists q_quiz_notifications_delete on public."q-quiz-notifications";
create policy q_quiz_notifications_delete on public."q-quiz-notifications"
  for delete to authenticated using (user_id = auth.uid());

-- Live badge updates in Studio
do $$ begin
  alter publication supabase_realtime add table public."q-quiz-notifications";
exception when duplicate_object then null;
          when undefined_object then null;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. OUTBOX (job queue: lead alert emails now-ish, Salesforce later)
--    Processed by the process-outbox Edge Function using the service role.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-outbox" (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('lead_alert_email', 'crm_sync')),
  status         text not null default 'pending'
                   check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  response_id    uuid references public."q-quiz-responses"(id) on delete cascade,
  assessment_id  uuid references public."q-quiz-assessments"(id) on delete cascade,
  recipient      text,
  payload        jsonb not null default '{}'::jsonb,
  attempts       int not null default 0,
  last_error     text,
  run_after      timestamptz not null default now(),
  processed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists q_quiz_outbox_pending_idx
  on public."q-quiz-outbox" (status, run_after) where status in ('pending', 'failed');

alter table public."q-quiz-outbox" enable row level security;
revoke all on public."q-quiz-outbox" from anon;

drop policy if exists q_quiz_outbox_select on public."q-quiz-outbox";
create policy q_quiz_outbox_select on public."q-quiz-outbox"
  for select to authenticated using (public.q_quiz_is_staff());


-- ════════════════════════════════════════════════════════════════════════════
-- 6. RESPONSE TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

-- BEFORE INSERT: snapshot the owner, set CRM status
create or replace function public.q_quiz_before_response_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public."q-quiz-assessments"%rowtype;
begin
  select * into a from public."q-quiz-assessments" where id = new.assessment_id;
  new.owner_id := coalesce(new.owner_id, a.owner_id, a.created_by);

  if new.is_test then
    new.crm_sync_status := 'skipped';
  elsif public.q_quiz_config_bool('crm_enabled')
        and coalesce((a.settings #>> '{crm,enabled}')::boolean, false) then
    new.crm_sync_status := 'pending';
  else
    new.crm_sync_status := 'not_configured';
  end if;
  return new;
end $$;

drop trigger if exists q_quiz_before_response_insert on public."q-quiz-responses";
create trigger q_quiz_before_response_insert before insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_before_response_insert();

-- AFTER INSERT: in-app notification + outbox jobs
create or replace function public.q_quiz_after_response_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a        public."q-quiz-assessments"%rowtype;
  v_who    text;
  v_title  text;
  v_body   text;
  v_email  text;
  v_extra  text;
begin
  if new.is_test then
    return new;
  end if;

  select * into a from public."q-quiz-assessments" where id = new.assessment_id;

  -- Per-assessment opt-out: settings.alerts.enabled = false
  if coalesce((a.settings #>> '{alerts,enabled}')::boolean, true) = false then
    null;
  elsif new.owner_id is not null then
    v_who := nullif(trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_title := 'New lead: ' || coalesce(v_who, new.email, 'Anonymous')
               || coalesce(' (' || nullif(new.organization, '') || ')', '');
    v_body := a.title
              || coalesce(' · ' || round(new.score_pct)::text || '%', '')
              || coalesce(' · ' || new.tier_label, '');

    insert into public."q-quiz-notifications" (user_id, assessment_id, response_id, title, body)
    values (new.owner_id, new.assessment_id, new.id, v_title, v_body);

    -- Email alert only when globally enabled, so no backlog builds while email is off
    if public.q_quiz_config_bool('email_alerts_enabled') then
      select email into v_email from public."q-quiz-profiles" where id = new.owner_id;
      if v_email is not null then
        insert into public."q-quiz-outbox" (kind, response_id, assessment_id, recipient, payload)
        values ('lead_alert_email', new.id, new.assessment_id, v_email,
                jsonb_build_object('title', v_title, 'body', v_body));
      end if;
      for v_extra in
        select jsonb_array_elements_text(coalesce(a.settings #> '{alerts,extra_recipients}', '[]'::jsonb))
      loop
        insert into public."q-quiz-outbox" (kind, response_id, assessment_id, recipient, payload)
        values ('lead_alert_email', new.id, new.assessment_id, lower(v_extra),
                jsonb_build_object('title', v_title, 'body', v_body));
      end loop;
    end if;
  end if;

  if new.crm_sync_status = 'pending' then
    insert into public."q-quiz-outbox" (kind, response_id, assessment_id, payload)
    values ('crm_sync', new.id, new.assessment_id,
            jsonb_build_object('provider', (select value #>> '{}' from public."q-quiz-config" where key = 'crm_provider'),
                               'settings', coalesce(a.settings -> 'crm', '{}'::jsonb)));
  end if;

  return new;
end $$;

drop trigger if exists q_quiz_after_response_insert on public."q-quiz-responses";
create trigger q_quiz_after_response_insert after insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_after_response_insert();


-- ════════════════════════════════════════════════════════════════════════════
-- 7. ASSESSMENT DEFAULTS: owner = creator
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.q_quiz_before_assessment_insert()
returns trigger language plpgsql as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.owner_id   := coalesce(new.owner_id, new.created_by);
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end $$;

drop trigger if exists q_quiz_before_assessment_insert on public."q-quiz-assessments";
create trigger q_quiz_before_assessment_insert before insert on public."q-quiz-assessments"
  for each row execute function public.q_quiz_before_assessment_insert();

create or replace function public.q_quiz_before_assessment_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists q_quiz_before_assessment_update on public."q-quiz-assessments";
create trigger q_quiz_before_assessment_update before update on public."q-quiz-assessments"
  for each row execute function public.q_quiz_before_assessment_update();


-- ════════════════════════════════════════════════════════════════════════════
-- Assessment settings conventions (documented, not enforced):
-- {
--   "alerts": { "enabled": true, "extra_recipients": [] },
--   "crm":    { "enabled": false, "object": "Lead", "lead_source": "Assessment",
--               "campaign_id": null, "field_map": {} },
--   "response_cap": null,
--   "closed_message": "This assessment is no longer accepting responses."
-- }
--
-- Lead field keys → Salesforce Lead fields:
--   first_name→FirstName  last_name→LastName  email→Email  organization→Company
--   job_title→Title       phone→Phone         state→State
-- ════════════════════════════════════════════════════════════════════════════
