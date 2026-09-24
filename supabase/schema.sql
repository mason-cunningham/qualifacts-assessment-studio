-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — complete Supabase schema
-- Project: https://thjclunkjqnknsozlyyj.supabase.co
--
-- Paste the whole file into the Supabase SQL editor and click Run.
--
-- NON-DESTRUCTIVE: this script contains no DROP or DELETE statements. It only
-- creates things that don't exist yet and replaces function bodies. It never
-- touches your existing tables (eligibility_leads, insync_addons_readiness_leads,
-- rcms_patient_pay_leads, …). Safe to run more than once, and safe if an earlier
-- 001/002 script was already run (fully or partially).
--
-- Naming: tables/views use the "q-quiz-" prefix. Because of the hyphen, raw SQL
-- must double-quote them, e.g. select * from "q-quiz-responses";
-- Functions, triggers and policies use the q_quiz_ prefix.
--
-- Security model:
--   • Staff = signed-in @qualifacts.com users with an ACTIVE row in "q-quiz-profiles".
--     New sign-ups start pending until an admin approves them in Studio → Users.
--   • Prospects (anon) have NO table access. They can only call three functions:
--       q_quiz_get_published(slug) · q_quiz_submit_response(payload) · q_quiz_track_event(...)
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Helper: create a policy only if it doesn't already exist (avoids DROP POLICY).
create or replace function public.q_quiz_ensure_policy(p_schema text, p_table text, p_name text, p_ddl text)
returns void language plpgsql as $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = p_schema and tablename = p_table and policyname = p_name
  ) then
    execute p_ddl;
  end if;
end $$;
revoke all on function public.q_quiz_ensure_policy(text, text, text, text) from public, anon, authenticated;

-- Shared trigger: keep updated_at current
create or replace function public.q_quiz_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. TABLES
-- ════════════════════════════════════════════════════════════════════════════

-- Staff profiles (one per Studio user)
create table if not exists public."q-quiz-profiles" (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  title       text,
  role        text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public."q-quiz-profiles" alter column is_active set default false;

-- Solutions / products library (shared across assessments)
create table if not exists public."q-quiz-products" (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  product_line    text,
  category        text,
  tagline         text,
  what_it_does    text,
  why_it_matters  text,
  benefits        jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  image_url       text,
  logo_url        text,
  cta_label       text,
  cta_url         text,
  tags            text[] not null default '{}',
  is_active       boolean not null default true,
  created_by      uuid references public."q-quiz-profiles"(id) on delete set null,
  updated_by      uuid references public."q-quiz-profiles"(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Assessments (holds the working draft)
create table if not exists public."q-quiz-assessments" (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                 text not null,
  internal_name         text,
  description           text,
  product_line          text,
  status                text not null default 'draft'
                          check (status in ('draft', 'published', 'paused', 'archived')),
  draft_definition      jsonb not null default '{}'::jsonb,
  published_version_id  uuid,
  settings              jsonb not null default '{}'::jsonb,
  is_template           boolean not null default false,
  closes_at             timestamptz,
  published_at          timestamptz,
  owner_id              uuid references public."q-quiz-profiles"(id) on delete set null,
  created_by            uuid references public."q-quiz-profiles"(id) on delete set null,
  updated_by            uuid references public."q-quiz-profiles"(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists q_quiz_assessments_status_idx on public."q-quiz-assessments" (status);

-- Site paths that can't be assessment links (Studio lives at /studio on the same site)
do $$ begin
  alter table public."q-quiz-assessments"
    add constraint q_quiz_assessments_slug_reserved
    check (slug not in ('studio', 'assets', 'api', 'admin', 'favicon', 'index'));
exception when duplicate_object then null;
end $$;

-- Versions (immutable snapshot on every publish)
create table if not exists public."q-quiz-versions" (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  version_number  int  not null,
  definition      jsonb not null,
  change_note     text,
  published_by    uuid references public."q-quiz-profiles"(id) on delete set null,
  published_at    timestamptz not null default now(),
  unique (assessment_id, version_number)
);

do $$ begin
  alter table public."q-quiz-assessments"
    add constraint q_quiz_assessments_published_version_fk
    foreign key (published_version_id) references public."q-quiz-versions"(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- Responses (one row per completed assessment / lead)
create table if not exists public."q-quiz-responses" (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  version_id        uuid references public."q-quiz-versions"(id) on delete set null,
  session_id        uuid,
  first_name        text,
  last_name         text,
  email             text,
  organization      text,
  job_title         text,
  phone             text,
  state             text,
  lead_fields       jsonb not null default '{}'::jsonb,
  consent           boolean,
  score_pct         numeric(5,2),
  score_points      numeric,
  score_max         numeric,
  tier_key          text,
  tier_label        text,
  section_scores    jsonb not null default '[]'::jsonb check (jsonb_typeof(section_scores) = 'array'),
  answers           jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  recommendations   jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),
  source            text,
  rep_code          text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  referrer          text,
  user_agent        text,
  started_at        timestamptz,
  completed_at      timestamptz not null default now(),
  follow_up_status  text not null default 'new'
                      check (follow_up_status in ('new', 'contacted', 'qualified', 'disqualified', 'customer')),
  assigned_to       uuid references public."q-quiz-profiles"(id) on delete set null,
  internal_notes    text,
  is_test           boolean not null default false,
  owner_id          uuid references public."q-quiz-profiles"(id) on delete set null,
  crm_sync_status   text not null default 'not_configured',
  crm_external_id   text,
  crm_synced_at     timestamptz,
  crm_error         text,
  created_at        timestamptz not null default now()
);
-- Columns added after the first version of this schema (no-ops on a fresh DB)
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

create index if not exists q_quiz_responses_assessment_idx on public."q-quiz-responses" (assessment_id, completed_at desc);
create index if not exists q_quiz_responses_email_idx      on public."q-quiz-responses" (lower(email));
create index if not exists q_quiz_responses_completed_idx  on public."q-quiz-responses" (completed_at desc);
create index if not exists q_quiz_responses_owner_idx      on public."q-quiz-responses" (owner_id, completed_at desc);

-- Funnel events (views → starts → completions, drop-off by question)
create table if not exists public."q-quiz-events" (
  id              bigint generated always as identity primary key,
  assessment_id   uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  version_id      uuid references public."q-quiz-versions"(id) on delete set null,
  session_id      uuid not null,
  event_type      text not null check (event_type in
                    ('view', 'start', 'answer', 'lead_form_view', 'complete', 'cta_click', 'results_download', 'product_click')),
  question_id     text,
  meta            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists q_quiz_events_assessment_idx on public."q-quiz-events" (assessment_id, event_type, created_at desc);
create index if not exists q_quiz_events_session_idx    on public."q-quiz-events" (session_id);

-- AI request log (phase 2; written by an Edge Function with the service role)
create table if not exists public."q-quiz-ai-requests" (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public."q-quiz-profiles"(id) on delete set null,
  assessment_id   uuid references public."q-quiz-assessments"(id) on delete set null,
  mode            text not null,
  model           text,
  input_tokens    int,
  output_tokens   int,
  status          text not null default 'ok' check (status in ('ok', 'error')),
  error           text,
  created_at      timestamptz not null default now()
);

-- App config (key/value)
create table if not exists public."q-quiz-config" (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);
insert into public."q-quiz-config" (key, value, description) values
  ('public_base_url',      '"https://qualifacts-assess.netlify.app"', 'Base URL of the public runner. Change when assess.qualifacts.com is live.'),
  ('email_alerts_enabled', 'false',        'When true, new leads also enqueue an email alert in q-quiz-outbox.'),
  ('crm_enabled',          'false',        'Master switch for CRM (Salesforce) sync jobs.'),
  ('crm_provider',         '"salesforce"', 'CRM target for crm_sync jobs.')
on conflict (key) do nothing;

-- In-app notifications (lead alerts)
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
create index if not exists q_quiz_notifications_user_idx on public."q-quiz-notifications" (user_id, created_at desc);

-- Outbox job queue (email alerts later, Salesforce later)
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


-- ════════════════════════════════════════════════════════════════════════════
-- 2. ROLE HELPERS
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.q_quiz_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public."q-quiz-profiles" where id = auth.uid() and is_active;
$$;

create or replace function public.q_quiz_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_role() is not null, false);
$$;

create or replace function public.q_quiz_can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_role() in ('admin', 'editor'), false);
$$;

create or replace function public.q_quiz_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_role() = 'admin', false);
$$;

create or replace function public.q_quiz_config_bool(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public."q-quiz-config" where key = p_key), false);
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

-- updated_at
create or replace trigger q_quiz_profiles_updated_at    before update on public."q-quiz-profiles"    for each row execute function public.q_quiz_touch_updated_at();
create or replace trigger q_quiz_products_updated_at    before update on public."q-quiz-products"    for each row execute function public.q_quiz_touch_updated_at();
create or replace trigger q_quiz_assessments_updated_at before update on public."q-quiz-assessments" for each row execute function public.q_quiz_touch_updated_at();
create or replace trigger q_quiz_config_updated_at      before update on public."q-quiz-config"      for each row execute function public.q_quiz_touch_updated_at();

-- New @qualifacts.com sign-ups get a profile: the first ever becomes an active admin,
-- everyone else starts pending (is_active = false) until an admin approves them.
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

create or replace trigger q_quiz_on_auth_user_created after insert on auth.users
  for each row execute function public.q_quiz_handle_new_user();

-- Only admins may change role / approval / email; never remove the last active admin.
create or replace function public.q_quiz_guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null in the SQL editor and for the service role; allow those.
  if auth.uid() is not null
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active
          or new.email is distinct from old.email)
     and not public.q_quiz_is_admin() then
    raise exception 'Only admins can change role, approval or email' using errcode = '42501';
  end if;
  if (old.role = 'admin' and old.is_active)
     and (new.role <> 'admin' or not new.is_active)
     and not exists (select 1 from public."q-quiz-profiles"
                     where role = 'admin' and is_active and id <> old.id) then
    raise exception 'At least one active admin is required' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace trigger q_quiz_guard_profile_role before update on public."q-quiz-profiles"
  for each row execute function public.q_quiz_guard_profile_role();

-- Assessments: owner defaults to the creator; track who edited last
create or replace function public.q_quiz_before_assessment_insert()
returns trigger language plpgsql as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.owner_id   := coalesce(new.owner_id, new.created_by);
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end $$;

create or replace trigger q_quiz_before_assessment_insert before insert on public."q-quiz-assessments"
  for each row execute function public.q_quiz_before_assessment_insert();

create or replace function public.q_quiz_before_assessment_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create or replace trigger q_quiz_before_assessment_update before update on public."q-quiz-assessments"
  for each row execute function public.q_quiz_before_assessment_update();

-- Responses BEFORE INSERT: snapshot the owner, set CRM status
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

create or replace trigger q_quiz_before_response_insert before insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_before_response_insert();

-- Responses AFTER INSERT: in-app alert for the owner + outbox jobs (only when switched on)
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

  if coalesce((a.settings #>> '{alerts,enabled}')::boolean, true) and new.owner_id is not null then
    v_who := nullif(trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '')), '');
    v_title := 'New lead: ' || coalesce(v_who, new.email, 'Anonymous')
               || coalesce(' (' || nullif(new.organization, '') || ')', '');
    v_body := a.title
              || coalesce(' · ' || round(new.score_pct)::text || '%', '')
              || coalesce(' · ' || new.tier_label, '');

    insert into public."q-quiz-notifications" (user_id, assessment_id, response_id, title, body)
    values (new.owner_id, new.assessment_id, new.id, v_title, v_body);

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

create or replace trigger q_quiz_after_response_insert after insert on public."q-quiz-responses"
  for each row execute function public.q_quiz_after_response_insert();


-- ════════════════════════════════════════════════════════════════════════════
-- 4. BOOTSTRAP EXISTING USERS
-- ════════════════════════════════════════════════════════════════════════════
-- Any @qualifacts.com users already in this project get a (pending) profile.
insert into public."q-quiz-profiles" (id, email, full_name, role, is_active)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), 'editor', false
from auth.users u
where lower(u.email) like '%@qualifacts.com'
on conflict (id) do nothing;

-- If there's no active admin yet and Mason already has an account, make him the admin.
-- (Otherwise the first person to sign up in Studio becomes admin automatically.)
update public."q-quiz-profiles"
   set role = 'admin', is_active = true
 where email = 'mason.cunningham@qualifacts.com'
   and not exists (select 1 from public."q-quiz-profiles" where role = 'admin' and is_active);


-- ════════════════════════════════════════════════════════════════════════════
-- 5. REPORTING VIEWS  (security_invoker → they obey the table RLS)
-- ════════════════════════════════════════════════════════════════════════════
create or replace view public."q-quiz-response-answers"
with (security_invoker = true) as
select
  r.id                                      as response_id,
  r.assessment_id,
  r.version_id,
  r.completed_at,
  r.email,
  r.organization,
  r.tier_label,
  r.is_test,
  a->>'question_id'                         as question_id,
  a->>'section_id'                          as section_id,
  a->>'section_name'                        as section_name,
  a->>'question_text'                       as question_text,
  a->>'type'                                as question_type,
  a->>'answer_label'                        as answer_label,
  a->'value'                                as answer_value,
  (a->>'points')::numeric                   as points,
  (a->>'max_points')::numeric               as max_points,
  (a->>'is_gap')::boolean                   as is_gap,
  coalesce((a->>'skipped')::boolean, false) as skipped
from public."q-quiz-responses" r
cross join lateral jsonb_array_elements(r.answers) a;

create or replace view public."q-quiz-assessment-stats"
with (security_invoker = true) as
select
  a.id                              as assessment_id,
  a.slug,
  a.title,
  a.status,
  coalesce(r.responses, 0)          as responses,
  coalesce(r.responses_30d, 0)      as responses_30d,
  r.avg_score,
  r.last_response_at,
  coalesce(e.views, 0)              as views,
  coalesce(e.starts, 0)             as starts,
  case when coalesce(e.starts, 0) > 0
       then round(100.0 * coalesce(r.responses, 0) / e.starts, 1) end as completion_rate
from public."q-quiz-assessments" a
left join (
  select assessment_id,
         count(*)                                                          as responses,
         count(*) filter (where completed_at > now() - interval '30 days') as responses_30d,
         round(avg(score_pct), 1)                                          as avg_score,
         max(completed_at)                                                 as last_response_at
  from public."q-quiz-responses"
  where not is_test
  group by assessment_id
) r on r.assessment_id = a.id
left join (
  select assessment_id,
         count(distinct session_id) filter (where event_type = 'view')  as views,
         count(distinct session_id) filter (where event_type = 'start') as starts
  from public."q-quiz-events"
  group by assessment_id
) e on e.assessment_id = a.id;


-- ════════════════════════════════════════════════════════════════════════════
-- 6. ROW LEVEL SECURITY + PRIVILEGES
-- ════════════════════════════════════════════════════════════════════════════
alter table public."q-quiz-profiles"      enable row level security;
alter table public."q-quiz-products"      enable row level security;
alter table public."q-quiz-assessments"   enable row level security;
alter table public."q-quiz-versions"      enable row level security;
alter table public."q-quiz-responses"     enable row level security;
alter table public."q-quiz-events"        enable row level security;
alter table public."q-quiz-ai-requests"   enable row level security;
alter table public."q-quiz-config"        enable row level security;
alter table public."q-quiz-notifications" enable row level security;
alter table public."q-quiz-outbox"        enable row level security;

-- Prospects (anon) never touch tables directly
revoke all on
  public."q-quiz-profiles", public."q-quiz-products", public."q-quiz-assessments",
  public."q-quiz-versions", public."q-quiz-responses", public."q-quiz-events",
  public."q-quiz-ai-requests", public."q-quiz-config", public."q-quiz-notifications",
  public."q-quiz-outbox", public."q-quiz-response-answers", public."q-quiz-assessment-stats"
from anon;

-- Profiles
select public.q_quiz_ensure_policy('public', 'q-quiz-profiles', 'q_quiz_profiles_select',
  $p$create policy q_quiz_profiles_select on public."q-quiz-profiles" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-profiles', 'q_quiz_profiles_select_own',
  $p$create policy q_quiz_profiles_select_own on public."q-quiz-profiles" for select to authenticated using (id = auth.uid())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-profiles', 'q_quiz_profiles_admin_update',
  $p$create policy q_quiz_profiles_admin_update on public."q-quiz-profiles" for update to authenticated using (public.q_quiz_is_admin()) with check (public.q_quiz_is_admin())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-profiles', 'q_quiz_profiles_update_own',
  $p$create policy q_quiz_profiles_update_own on public."q-quiz-profiles" for update to authenticated using (id = auth.uid()) with check (id = auth.uid())$p$);

-- Products
select public.q_quiz_ensure_policy('public', 'q-quiz-products', 'q_quiz_products_select',
  $p$create policy q_quiz_products_select on public."q-quiz-products" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-products', 'q_quiz_products_insert',
  $p$create policy q_quiz_products_insert on public."q-quiz-products" for insert to authenticated with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-products', 'q_quiz_products_update',
  $p$create policy q_quiz_products_update on public."q-quiz-products" for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-products', 'q_quiz_products_delete',
  $p$create policy q_quiz_products_delete on public."q-quiz-products" for delete to authenticated using (public.q_quiz_is_admin())$p$);

-- Assessments
select public.q_quiz_ensure_policy('public', 'q-quiz-assessments', 'q_quiz_assessments_select',
  $p$create policy q_quiz_assessments_select on public."q-quiz-assessments" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessments', 'q_quiz_assessments_insert',
  $p$create policy q_quiz_assessments_insert on public."q-quiz-assessments" for insert to authenticated with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessments', 'q_quiz_assessments_update',
  $p$create policy q_quiz_assessments_update on public."q-quiz-assessments" for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessments', 'q_quiz_assessments_delete',
  $p$create policy q_quiz_assessments_delete on public."q-quiz-assessments" for delete to authenticated using (public.q_quiz_is_admin())$p$);

-- Versions (immutable; created only through q_quiz_publish)
select public.q_quiz_ensure_policy('public', 'q-quiz-versions', 'q_quiz_versions_select',
  $p$create policy q_quiz_versions_select on public."q-quiz-versions" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-versions', 'q_quiz_versions_delete',
  $p$create policy q_quiz_versions_delete on public."q-quiz-versions" for delete to authenticated using (public.q_quiz_is_admin())$p$);

-- Responses (created only through q_quiz_submit_response)
select public.q_quiz_ensure_policy('public', 'q-quiz-responses', 'q_quiz_responses_select',
  $p$create policy q_quiz_responses_select on public."q-quiz-responses" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-responses', 'q_quiz_responses_update',
  $p$create policy q_quiz_responses_update on public."q-quiz-responses" for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-responses', 'q_quiz_responses_delete',
  $p$create policy q_quiz_responses_delete on public."q-quiz-responses" for delete to authenticated using (public.q_quiz_is_admin())$p$);

-- Events, AI log, outbox: staff can read
select public.q_quiz_ensure_policy('public', 'q-quiz-events', 'q_quiz_events_select',
  $p$create policy q_quiz_events_select on public."q-quiz-events" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-ai-requests', 'q_quiz_ai_select',
  $p$create policy q_quiz_ai_select on public."q-quiz-ai-requests" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-outbox', 'q_quiz_outbox_select',
  $p$create policy q_quiz_outbox_select on public."q-quiz-outbox" for select to authenticated using (public.q_quiz_is_staff())$p$);

-- Config: staff read, admins write
select public.q_quiz_ensure_policy('public', 'q-quiz-config', 'q_quiz_config_select',
  $p$create policy q_quiz_config_select on public."q-quiz-config" for select to authenticated using (public.q_quiz_is_staff())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-config', 'q_quiz_config_write',
  $p$create policy q_quiz_config_write on public."q-quiz-config" for all to authenticated using (public.q_quiz_is_admin()) with check (public.q_quiz_is_admin())$p$);

-- Notifications: each user sees and manages only their own
select public.q_quiz_ensure_policy('public', 'q-quiz-notifications', 'q_quiz_notifications_select',
  $p$create policy q_quiz_notifications_select on public."q-quiz-notifications" for select to authenticated using (user_id = auth.uid())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-notifications', 'q_quiz_notifications_update',
  $p$create policy q_quiz_notifications_update on public."q-quiz-notifications" for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-notifications', 'q_quiz_notifications_delete',
  $p$create policy q_quiz_notifications_delete on public."q-quiz-notifications" for delete to authenticated using (user_id = auth.uid())$p$);

-- Live notification badge in Studio
do $$ begin
  alter publication supabase_realtime add table public."q-quiz-notifications";
exception when duplicate_object then null;
          when undefined_object then null;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 7. RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- Publish: snapshot a definition as a new immutable version and go live (editors/admins)
create or replace function public.q_quiz_publish(
  p_assessment_id uuid,
  p_definition    jsonb,
  p_change_note   text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_next int;
  v_version_id uuid;
begin
  if not public.q_quiz_can_edit() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public."q-quiz-versions" where assessment_id = p_assessment_id;

  insert into public."q-quiz-versions" (assessment_id, version_number, definition, change_note, published_by)
  values (p_assessment_id, v_next, p_definition, p_change_note, auth.uid())
  returning id into v_version_id;

  update public."q-quiz-assessments"
     set published_version_id = v_version_id,
         status               = 'published',
         published_at         = now(),
         updated_by           = auth.uid()
   where id = p_assessment_id;

  return v_version_id;
end $$;

-- Public read: what the live URL calls. Definition is null when paused/closed.
create or replace function public.q_quiz_get_published(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'assessment_id',  a.id,
    'version_id',     v.id,
    'slug',           a.slug,
    'title',          a.title,
    'is_open',        (a.status = 'published' and (a.closes_at is null or a.closes_at > now())),
    'closed_message', a.settings->>'closed_message',
    'definition',     case when a.status = 'published' and (a.closes_at is null or a.closes_at > now())
                           then v.definition end
  )
  from public."q-quiz-assessments" a
  join public."q-quiz-versions" v on v.id = a.published_version_id
  where a.slug = lower(p_slug)
    and a.status in ('published', 'paused');
$$;

-- Public write: submit a completed assessment
create or replace function public.q_quiz_submit_response(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_assessment  public."q-quiz-assessments"%rowtype;
  v_version_id  uuid;
  v_is_staff    boolean := public.q_quiz_is_staff();
  v_is_test     boolean;
  v_cap         int;
  v_id          uuid;
begin
  if octet_length(p_payload::text) > 250000 then
    raise exception 'Payload too large' using errcode = '22023';
  end if;

  -- Honeypot: bots fill the hidden field; accept silently, store nothing
  if coalesce(p_payload->>'hp', '') <> '' then
    return null;
  end if;

  select * into v_assessment
  from public."q-quiz-assessments"
  where id = nullif(p_payload->>'assessment_id', '')::uuid;

  if not found then
    raise exception 'Assessment not found' using errcode = 'P0002';
  end if;

  v_is_test := v_is_staff and (coalesce((p_payload->>'is_test')::boolean, false) or v_assessment.status <> 'published');

  if not v_is_test and not (v_assessment.status = 'published'
                            and (v_assessment.closes_at is null or v_assessment.closes_at > now())) then
    raise exception 'This assessment is not accepting responses' using errcode = 'P0001';
  end if;

  v_cap := nullif(v_assessment.settings->>'response_cap', '')::int;
  if v_cap is not null and not v_is_test and
     (select count(*) from public."q-quiz-responses" where assessment_id = v_assessment.id and not is_test) >= v_cap then
    raise exception 'This assessment has reached its response limit' using errcode = 'P0001';
  end if;

  select id into v_version_id
  from public."q-quiz-versions"
  where id = nullif(p_payload->>'version_id', '')::uuid
    and assessment_id = v_assessment.id;
  v_version_id := coalesce(v_version_id, v_assessment.published_version_id);

  insert into public."q-quiz-responses" (
    assessment_id, version_id, session_id,
    first_name, last_name, email, organization, job_title, phone, state, lead_fields, consent,
    score_pct, score_points, score_max, tier_key, tier_label,
    section_scores, answers, recommendations,
    source, rep_code, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referrer, user_agent,
    started_at, is_test
  ) values (
    v_assessment.id, v_version_id, nullif(p_payload->>'session_id', '')::uuid,
    left(p_payload->>'first_name', 200), left(p_payload->>'last_name', 200),
    lower(left(p_payload->>'email', 320)), left(p_payload->>'organization', 300),
    left(p_payload->>'job_title', 200), left(p_payload->>'phone', 50), left(p_payload->>'state', 100),
    coalesce(p_payload->'lead_fields', '{}'::jsonb),
    (p_payload->>'consent')::boolean,
    (p_payload->>'score_pct')::numeric, (p_payload->>'score_points')::numeric, (p_payload->>'score_max')::numeric,
    left(p_payload->>'tier_key', 100), left(p_payload->>'tier_label', 200),
    coalesce(p_payload->'section_scores', '[]'::jsonb),
    coalesce(p_payload->'answers', '[]'::jsonb),
    coalesce(p_payload->'recommendations', '[]'::jsonb),
    left(p_payload->>'source', 200), left(p_payload->>'rep_code', 100),
    left(p_payload->>'utm_source', 200), left(p_payload->>'utm_medium', 200), left(p_payload->>'utm_campaign', 200),
    left(p_payload->>'utm_content', 200), left(p_payload->>'utm_term', 200),
    left(p_payload->>'referrer', 1000), left(p_payload->>'user_agent', 500),
    nullif(p_payload->>'started_at', '')::timestamptz,
    v_is_test
  )
  returning id into v_id;

  return v_id;
end $$;

-- Public write: funnel event (ignored for non-live assessments and staff previews)
create or replace function public.q_quiz_track_event(
  p_assessment_id uuid,
  p_session_id    uuid,
  p_event_type    text,
  p_question_id   text  default null,
  p_meta          jsonb default '{}'::jsonb,
  p_version_id    uuid  default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.q_quiz_is_staff() then
    return;
  end if;
  if octet_length(coalesce(p_meta, '{}'::jsonb)::text) > 5000 then
    return;
  end if;
  insert into public."q-quiz-events" (assessment_id, version_id, session_id, event_type, question_id, meta)
  select a.id, p_version_id, p_session_id, p_event_type, left(p_question_id, 100), coalesce(p_meta, '{}'::jsonb)
  from public."q-quiz-assessments" a
  where a.id = p_assessment_id and a.status = 'published';
end $$;

-- Function privileges. Supabase grants EXECUTE on new functions to anon directly,
-- so revoke from anon explicitly. Anon may call ONLY the three public RPCs.
revoke execute on function public.q_quiz_publish(uuid, jsonb, text) from public, anon;
revoke execute on function public.q_quiz_role()                     from public, anon;
revoke execute on function public.q_quiz_is_staff()                 from public, anon;
revoke execute on function public.q_quiz_can_edit()                 from public, anon;
revoke execute on function public.q_quiz_is_admin()                 from public, anon;
revoke execute on function public.q_quiz_config_bool(text)          from public, anon;

grant execute on function public.q_quiz_publish(uuid, jsonb, text) to authenticated;
grant execute on function public.q_quiz_role()                     to authenticated;
grant execute on function public.q_quiz_is_staff()                 to authenticated;
grant execute on function public.q_quiz_can_edit()                 to authenticated;
grant execute on function public.q_quiz_is_admin()                 to authenticated;
grant execute on function public.q_quiz_config_bool(text)          to authenticated;

grant execute on function public.q_quiz_get_published(text)                              to anon, authenticated;
grant execute on function public.q_quiz_submit_response(jsonb)                           to anon, authenticated;
grant execute on function public.q_quiz_track_event(uuid, uuid, text, text, jsonb, uuid) to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 8. STORAGE
--   q-quiz-assets  (public)  logos, hero images, product screenshots
--   q-quiz-imports (private) source documents for AI import (phase 2)
-- ════════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'q-quiz-assets', 'q-quiz-assets', true, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
        'font/woff', 'font/woff2', 'application/pdf']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('q-quiz-imports', 'q-quiz-imports', false, 26214400)
on conflict (id) do nothing;

select public.q_quiz_ensure_policy('storage', 'objects', 'q_quiz_assets_insert',
  $p$create policy q_quiz_assets_insert on storage.objects for insert to authenticated with check (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('storage', 'objects', 'q_quiz_assets_update',
  $p$create policy q_quiz_assets_update on storage.objects for update to authenticated using (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('storage', 'objects', 'q_quiz_assets_delete',
  $p$create policy q_quiz_assets_delete on storage.objects for delete to authenticated using (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit())$p$);
select public.q_quiz_ensure_policy('storage', 'objects', 'q_quiz_imports_all',
  $p$create policy q_quiz_imports_all on storage.objects for all to authenticated using (bucket_id = 'q-quiz-imports' and public.q_quiz_can_edit()) with check (bucket_id = 'q-quiz-imports' and public.q_quiz_can_edit())$p$);


-- ════════════════════════════════════════════════════════════════════════════
-- 9. KNOWLEDGE LIBRARY + AI USAGE  (same as 004_ai_knowledge.sql)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-knowledge" (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  kind             text not null default 'reference'
                     check (kind in ('product_info', 'best_practices', 'messaging', 'reference')),
  topic            text,
  product_line     text,
  content          text not null default '',
  source_filename  text,
  source_path      text,
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

alter table public."q-quiz-ai-requests"
  add column if not exists duration_ms  int,
  add column if not exists request_meta jsonb not null default '{}'::jsonb;
create index if not exists q_quiz_ai_requests_user_idx on public."q-quiz-ai-requests" (user_id, created_at desc);

insert into public."q-quiz-config" (key, value, description) values
  ('ai_enabled',              'true',   'Master switch for AI tools in Studio.'),
  ('ai_daily_limit_per_user', '25',     'Max AI requests per user per rolling 24 hours.'),
  ('ai_effort_generate',      '"high"', 'Claude effort for full generation/import: low | medium | high | xhigh | max.')
on conflict (key) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- Done. Quick checks you can run afterwards:
--   select email, role, is_active from "q-quiz-profiles";          -- who has access
--   select public.q_quiz_get_published('does-not-exist');          -- should return NULL
--   select key, value from "q-quiz-config";                        -- app settings
-- ════════════════════════════════════════════════════════════════════════════
