-- ⚠️⚠️ SUPERSEDED: DO NOT RUN. Use supabase/schema.sql instead (non-destructive, all-in-one). ⚠️⚠️
-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — Supabase schema
-- Project: https://thjclunkjqnknsozlyyj.supabase.co
--
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent where possible).
--
-- Naming: tables/views use the requested "q-quiz-" prefix. Because of the hyphen,
-- raw SQL must always double-quote them ("q-quiz-assessments"). supabase-js is fine:
--   supabase.from('q-quiz-assessments')
-- Functions, triggers and policies use the q_quiz_ prefix (hyphens aren't practical there).
--
-- Security model:
--   • Staff = signed-in @qualifacts.com users with a row in "q-quiz-profiles".
--   • Prospects (anon) get NO direct table access. They can only:
--       - read a published assessment via  q_quiz_get_published(slug)
--       - submit a response via            q_quiz_submit_response(payload)
--       - log funnel events via            q_quiz_track_event(...)
--   • Existing legacy lead tables (insync_addons_readiness_leads, etc.) are untouched.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Shared trigger: updated_at ──────────────────────────────────────────────
create or replace function public.q_quiz_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- 1. STAFF PROFILES
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-profiles" (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  title       text,
  role        text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists q_quiz_profiles_updated_at on public."q-quiz-profiles";
create trigger q_quiz_profiles_updated_at before update on public."q-quiz-profiles"
  for each row execute function public.q_quiz_touch_updated_at();

-- Role helpers (security definer so policies can call them without recursion)
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

-- Auto-create a profile for any new @qualifacts.com auth user.
-- Non-Qualifacts accounts in this Supabase project are ignored and get no access.
create or replace function public.q_quiz_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) like '%@qualifacts.com' then
    insert into public."q-quiz-profiles" (id, email, full_name)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists q_quiz_on_auth_user_created on auth.users;
create trigger q_quiz_on_auth_user_created after insert on auth.users
  for each row execute function public.q_quiz_handle_new_user();

-- Backfill any @qualifacts.com users who already exist in this project
insert into public."q-quiz-profiles" (id, email, full_name)
select u.id, lower(u.email), coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
from auth.users u
where lower(u.email) like '%@qualifacts.com'
on conflict (id) do nothing;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. SOLUTIONS / PRODUCTS LIBRARY  (shared across all assessments)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-products" (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,                       -- "Grants Module"
  product_line    text,                                -- "InSync", "CareLogic", "Credible", "Streamline", ...
  category        text,                                -- "Revenue Cycle", "Clinical", "Client Engagement", ...
  tagline         text,
  what_it_does    text,
  why_it_matters  text,
  benefits        jsonb not null default '[]'::jsonb check (jsonb_typeof(benefits) = 'array'),
  image_url       text,                                -- screenshot / hero (q-quiz-assets bucket)
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

drop trigger if exists q_quiz_products_updated_at on public."q-quiz-products";
create trigger q_quiz_products_updated_at before update on public."q-quiz-products"
  for each row execute function public.q_quiz_touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 3. ASSESSMENTS  (one row per assessment; holds the working draft)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-assessments" (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),  -- live URL path
  title                 text not null,
  internal_name         text,                           -- e.g. "ACC 2026 booth version"
  description           text,
  product_line          text,
  status                text not null default 'draft'
                          check (status in ('draft', 'published', 'paused', 'archived')),
  draft_definition      jsonb not null default '{}'::jsonb,   -- full assessment config being edited
  published_version_id  uuid,                           -- FK added below
  settings              jsonb not null default '{}'::jsonb,   -- notify emails, response_cap, closed_message, webhook, etc.
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

drop trigger if exists q_quiz_assessments_updated_at on public."q-quiz-assessments";
create trigger q_quiz_assessments_updated_at before update on public."q-quiz-assessments"
  for each row execute function public.q_quiz_touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 4. VERSIONS  (immutable snapshot created on every publish)
--    Responses point at the exact version they were scored against, so editing
--    a live assessment never corrupts historical results.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-versions" (
  id              uuid primary key default gen_random_uuid(),
  assessment_id   uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  version_number  int  not null,
  definition      jsonb not null,                       -- resolved config incl. product snapshots
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


-- ════════════════════════════════════════════════════════════════════════════
-- 5. RESPONSES  (one row per completed assessment / lead)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-responses" (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  version_id        uuid references public."q-quiz-versions"(id) on delete set null,
  session_id        uuid,                                -- joins to "q-quiz-events"

  -- Lead (common fields as columns for easy filtering/export; anything custom in lead_fields)
  first_name        text,
  last_name         text,
  email             text,
  organization      text,
  job_title         text,
  phone             text,
  state             text,
  lead_fields       jsonb not null default '{}'::jsonb,
  consent           boolean,

  -- Scoring
  score_pct         numeric(5,2),                        -- 0–100 overall (null for unscored surveys)
  score_points      numeric,
  score_max         numeric,
  tier_key          text,
  tier_label        text,
  section_scores    jsonb not null default '[]'::jsonb check (jsonb_typeof(section_scores) = 'array'),
  answers           jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  recommendations   jsonb not null default '[]'::jsonb check (jsonb_typeof(recommendations) = 'array'),

  -- Attribution
  source            text,                                -- ?src=acc2026, "qr-booth", "email-nurture"
  rep_code          text,                                -- ?rep=jsmith  (per-rep share links)
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  referrer          text,
  user_agent        text,

  started_at        timestamptz,
  completed_at      timestamptz not null default now(),

  -- Internal follow-up (staff only)
  follow_up_status  text not null default 'new'
                      check (follow_up_status in ('new', 'contacted', 'qualified', 'disqualified', 'customer')),
  assigned_to       uuid references public."q-quiz-profiles"(id) on delete set null,
  internal_notes    text,
  is_test           boolean not null default false,      -- preview/test submissions, hidden from reports by default
  created_at        timestamptz not null default now()
);

create index if not exists q_quiz_responses_assessment_idx on public."q-quiz-responses" (assessment_id, completed_at desc);
create index if not exists q_quiz_responses_email_idx      on public."q-quiz-responses" (lower(email));
create index if not exists q_quiz_responses_completed_idx  on public."q-quiz-responses" (completed_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 6. EVENTS  (funnel analytics: views → starts → completions, drop-off by question)
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- 7. AI REQUEST LOG  (written by the Edge Function with the service role)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public."q-quiz-ai-requests" (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public."q-quiz-profiles"(id) on delete set null,
  assessment_id   uuid references public."q-quiz-assessments"(id) on delete set null,
  mode            text not null,        -- generate | import | rewrite | options | results_copy | map_products
  model           text,
  input_tokens    int,
  output_tokens   int,
  status          text not null default 'ok' check (status in ('ok', 'error')),
  error           text,
  created_at      timestamptz not null default now()
);


-- ════════════════════════════════════════════════════════════════════════════
-- 8. REPORTING VIEWS  (security_invoker → they obey the table RLS below)
-- ════════════════════════════════════════════════════════════════════════════

-- One row per answered question — powers per-question charts and "long" exports
create or replace view public."q-quiz-response-answers"
with (security_invoker = true) as
select
  r.id                                  as response_id,
  r.assessment_id,
  r.version_id,
  r.completed_at,
  r.email,
  r.organization,
  r.tier_label,
  r.is_test,
  a->>'question_id'                     as question_id,
  a->>'section_id'                      as section_id,
  a->>'section_name'                    as section_name,
  a->>'question_text'                   as question_text,
  a->>'type'                            as question_type,
  a->>'answer_label'                    as answer_label,
  a->'value'                            as answer_value,
  (a->>'points')::numeric               as points,
  (a->>'max_points')::numeric           as max_points,
  (a->>'is_gap')::boolean               as is_gap,
  coalesce((a->>'skipped')::boolean, false) as skipped
from public."q-quiz-responses" r
cross join lateral jsonb_array_elements(r.answers) a;

-- Dashboard card stats per assessment (excludes test submissions)
create or replace view public."q-quiz-assessment-stats"
with (security_invoker = true) as
select
  a.id                                                          as assessment_id,
  a.slug,
  a.title,
  a.status,
  coalesce(r.responses, 0)                                      as responses,
  coalesce(r.responses_30d, 0)                                  as responses_30d,
  r.avg_score,
  r.last_response_at,
  coalesce(e.views, 0)                                          as views,
  coalesce(e.starts, 0)                                         as starts,
  case when coalesce(e.starts, 0) > 0
       then round(100.0 * coalesce(r.responses, 0) / e.starts, 1) end as completion_rate
from public."q-quiz-assessments" a
left join (
  select assessment_id,
         count(*)                                                        as responses,
         count(*) filter (where completed_at > now() - interval '30 days') as responses_30d,
         round(avg(score_pct), 1)                                        as avg_score,
         max(completed_at)                                               as last_response_at
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
-- 9. ROW LEVEL SECURITY
-- ════════════════════════════════════════════════════════════════════════════
alter table public."q-quiz-profiles"     enable row level security;
alter table public."q-quiz-products"     enable row level security;
alter table public."q-quiz-assessments"  enable row level security;
alter table public."q-quiz-versions"     enable row level security;
alter table public."q-quiz-responses"    enable row level security;
alter table public."q-quiz-events"       enable row level security;
alter table public."q-quiz-ai-requests"  enable row level security;

-- Belt and suspenders: anon never touches tables directly (RPCs only)
revoke all on public."q-quiz-profiles", public."q-quiz-products", public."q-quiz-assessments",
              public."q-quiz-versions", public."q-quiz-responses", public."q-quiz-events",
              public."q-quiz-ai-requests", public."q-quiz-response-answers",
              public."q-quiz-assessment-stats"
  from anon;

-- Profiles: staff can see the team; only admins change roles / deactivate
drop policy if exists q_quiz_profiles_select on public."q-quiz-profiles";
create policy q_quiz_profiles_select on public."q-quiz-profiles"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_profiles_admin_update on public."q-quiz-profiles";
create policy q_quiz_profiles_admin_update on public."q-quiz-profiles"
  for update to authenticated using (public.q_quiz_is_admin()) with check (public.q_quiz_is_admin());

-- Products
drop policy if exists q_quiz_products_select on public."q-quiz-products";
create policy q_quiz_products_select on public."q-quiz-products"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_products_insert on public."q-quiz-products";
create policy q_quiz_products_insert on public."q-quiz-products"
  for insert to authenticated with check (public.q_quiz_can_edit());
drop policy if exists q_quiz_products_update on public."q-quiz-products";
create policy q_quiz_products_update on public."q-quiz-products"
  for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit());
drop policy if exists q_quiz_products_delete on public."q-quiz-products";
create policy q_quiz_products_delete on public."q-quiz-products"
  for delete to authenticated using (public.q_quiz_is_admin());

-- Assessments
drop policy if exists q_quiz_assessments_select on public."q-quiz-assessments";
create policy q_quiz_assessments_select on public."q-quiz-assessments"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_assessments_insert on public."q-quiz-assessments";
create policy q_quiz_assessments_insert on public."q-quiz-assessments"
  for insert to authenticated with check (public.q_quiz_can_edit());
drop policy if exists q_quiz_assessments_update on public."q-quiz-assessments";
create policy q_quiz_assessments_update on public."q-quiz-assessments"
  for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit());
drop policy if exists q_quiz_assessments_delete on public."q-quiz-assessments";
create policy q_quiz_assessments_delete on public."q-quiz-assessments"
  for delete to authenticated using (public.q_quiz_is_admin());

-- Versions (immutable: no update policy; inserts happen through q_quiz_publish)
drop policy if exists q_quiz_versions_select on public."q-quiz-versions";
create policy q_quiz_versions_select on public."q-quiz-versions"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_versions_delete on public."q-quiz-versions";
create policy q_quiz_versions_delete on public."q-quiz-versions"
  for delete to authenticated using (public.q_quiz_is_admin());

-- Responses (inserts only via q_quiz_submit_response)
drop policy if exists q_quiz_responses_select on public."q-quiz-responses";
create policy q_quiz_responses_select on public."q-quiz-responses"
  for select to authenticated using (public.q_quiz_is_staff());
drop policy if exists q_quiz_responses_update on public."q-quiz-responses";
create policy q_quiz_responses_update on public."q-quiz-responses"
  for update to authenticated using (public.q_quiz_can_edit()) with check (public.q_quiz_can_edit());
drop policy if exists q_quiz_responses_delete on public."q-quiz-responses";
create policy q_quiz_responses_delete on public."q-quiz-responses"
  for delete to authenticated using (public.q_quiz_is_admin());

-- Events (inserts only via q_quiz_track_event)
drop policy if exists q_quiz_events_select on public."q-quiz-events";
create policy q_quiz_events_select on public."q-quiz-events"
  for select to authenticated using (public.q_quiz_is_staff());

-- AI log (inserts by service role, which bypasses RLS)
drop policy if exists q_quiz_ai_select on public."q-quiz-ai-requests";
create policy q_quiz_ai_select on public."q-quiz-ai-requests"
  for select to authenticated using (public.q_quiz_is_staff());


-- ════════════════════════════════════════════════════════════════════════════
-- 10. RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- Publish: snapshot a resolved definition as a new immutable version and go live.
-- The Studio app resolves product references into the definition before calling this.
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

revoke all on function public.q_quiz_publish(uuid, jsonb, text) from public, anon;
grant execute on function public.q_quiz_publish(uuid, jsonb, text) to authenticated;


-- Public read: what the live URL calls. Returns null definition when paused/closed
-- so the runner can show the "closed" message instead of a 404.
create or replace function public.q_quiz_get_published(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'assessment_id', a.id,
    'version_id',    v.id,
    'slug',          a.slug,
    'title',         a.title,
    'is_open',       (a.status = 'published' and (a.closes_at is null or a.closes_at > now())),
    'closed_message', a.settings->>'closed_message',
    'definition',    case when a.status = 'published' and (a.closes_at is null or a.closes_at > now())
                          then v.definition end
  )
  from public."q-quiz-assessments" a
  join public."q-quiz-versions" v on v.id = a.published_version_id
  where a.slug = lower(p_slug)
    and a.status in ('published', 'paused');
$$;

revoke all on function public.q_quiz_get_published(text) from public;
grant execute on function public.q_quiz_get_published(text) to anon, authenticated;


-- Public write: submit a completed assessment.
-- Staff may submit against drafts from Preview; those are always flagged is_test.
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

revoke all on function public.q_quiz_submit_response(jsonb) from public;
grant execute on function public.q_quiz_submit_response(jsonb) to anon, authenticated;


-- Public write: funnel event. Ignored for non-live assessments and staff previews.
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

revoke all on function public.q_quiz_track_event(uuid, uuid, text, text, jsonb, uuid) from public;
grant execute on function public.q_quiz_track_event(uuid, uuid, text, text, jsonb, uuid) to anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 11. STORAGE
--   q-quiz-assets  (public)  — logos, hero images, product screenshots, fonts
--   q-quiz-imports (private) — source docs uploaded for AI import (PDF/DOCX/XLSX/CSV)
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

drop policy if exists q_quiz_assets_insert on storage.objects;
create policy q_quiz_assets_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit());
drop policy if exists q_quiz_assets_update on storage.objects;
create policy q_quiz_assets_update on storage.objects
  for update to authenticated using (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit());
drop policy if exists q_quiz_assets_delete on storage.objects;
create policy q_quiz_assets_delete on storage.objects
  for delete to authenticated using (bucket_id = 'q-quiz-assets' and public.q_quiz_can_edit());

drop policy if exists q_quiz_imports_all on storage.objects;
create policy q_quiz_imports_all on storage.objects
  for all to authenticated
  using (bucket_id = 'q-quiz-imports' and public.q_quiz_can_edit())
  with check (bucket_id = 'q-quiz-imports' and public.q_quiz_can_edit());


-- ════════════════════════════════════════════════════════════════════════════
-- 12. OPTIONAL
-- ════════════════════════════════════════════════════════════════════════════
-- Live-updating dashboard when new responses arrive:
-- alter publication supabase_realtime add table public."q-quiz-responses";

-- Make yourself the first admin after your first sign-in:
-- update public."q-quiz-profiles" set role = 'admin' where email = 'mason.cunningham@qualifacts.com';
