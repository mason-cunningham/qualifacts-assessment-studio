-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 005: Teams + per-assessment sharing
-- Run once in the Supabase SQL editor (after schema.sql / 004).
-- NON-DESTRUCTIVE: no DROP/DELETE. Safe to run more than once.
--
-- Access model (q_quiz_access_for):
--   admin or owner                     → 'owner'  (edit, share, delete)
--   assessment.team is null (legacy)   → 'edit'   (visible to all staff until the owner picks a team)
--   assessment.team = my team          → 'edit'   (teammates can also share)
--   shared with me                     → 'view' | 'edit'
--   template                           → 'view'
--   otherwise                          → null     (hidden)
-- 'edit' is capped at 'view' for viewer-role users.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Teams ───────────────────────────────────────────────────────────────────
create or replace function public.q_quiz_is_team(p text)
returns boolean language sql immutable as $$
  select p in ('account_manager', 'sales_ae', 'customer_success', 'marketing', 'solutions_consulting',
               'bdr_cdr', 'product', 'support', 'implementation', 'product_training');
$$;

alter table public."q-quiz-profiles"    add column if not exists team text;
alter table public."q-quiz-assessments" add column if not exists team text;
create index if not exists q_quiz_assessments_team_idx on public."q-quiz-assessments" (team);

do $$ begin
  alter table public."q-quiz-profiles" add constraint q_quiz_profiles_team_chk check (team is null or public.q_quiz_is_team(team));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public."q-quiz-assessments" add constraint q_quiz_assessments_team_chk check (team is null or public.q_quiz_is_team(team));
exception when duplicate_object then null;
end $$;

-- ── Shares ──────────────────────────────────────────────────────────────────
create table if not exists public."q-quiz-assessment-shares" (
  id             uuid primary key default gen_random_uuid(),
  assessment_id  uuid not null references public."q-quiz-assessments"(id) on delete cascade,
  user_id        uuid not null references public."q-quiz-profiles"(id) on delete cascade,
  permission     text not null default 'view' check (permission in ('view', 'edit')),
  granted_by     uuid references public."q-quiz-profiles"(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (assessment_id, user_id)
);
create index if not exists q_quiz_shares_user_idx on public."q-quiz-assessment-shares" (user_id);

-- ── Access helpers (security definer → no RLS recursion) ────────────────────
create or replace function public.q_quiz_my_team()
returns text language sql stable security definer set search_path = public as $$
  select team from public."q-quiz-profiles" where id = auth.uid() and is_active;
$$;

create or replace function public.q_quiz_access_for(p_id uuid, p_owner uuid, p_team text, p_template boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.q_quiz_role();
  v_perm text;
begin
  if v_role is null then
    return null;
  end if;
  if v_role = 'admin' or p_owner = auth.uid() then
    return 'owner';
  end if;
  if p_team is null or p_team = public.q_quiz_my_team() then
    return case when v_role = 'editor' then 'edit' else 'view' end;
  end if;
  select permission into v_perm
  from public."q-quiz-assessment-shares"
  where assessment_id = p_id and user_id = auth.uid();
  if v_perm is not null then
    return case when v_perm = 'edit' and v_role = 'editor' then 'edit' else 'view' end;
  end if;
  if p_template then
    return 'view';
  end if;
  return null;
end $$;

create or replace function public.q_quiz_assessment_access(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.q_quiz_access_for(a.id, a.owner_id, a.team, a.is_template)
  from public."q-quiz-assessments" a where a.id = p_id;
$$;

create or replace function public.q_quiz_can_view_assessment(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_assessment_access(p_id) is not null, false);
$$;

create or replace function public.q_quiz_can_edit_assessment(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_can_edit() and public.q_quiz_assessment_access(p_id) in ('owner', 'edit'), false);
$$;

-- Owner, admin, or a teammate (editor role) may share and revoke.
create or replace function public.q_quiz_can_manage_sharing(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_can_edit() and exists (
    select 1 from public."q-quiz-assessments" a
    where a.id = p_id
      and (public.q_quiz_is_admin() or a.owner_id = auth.uid()
           or (a.team is not null and a.team = public.q_quiz_my_team()))
  ), false);
$$;

revoke execute on function public.q_quiz_my_team()                                from public, anon;
revoke execute on function public.q_quiz_access_for(uuid, uuid, text, boolean)    from public, anon;
revoke execute on function public.q_quiz_assessment_access(uuid)                  from public, anon;
revoke execute on function public.q_quiz_can_view_assessment(uuid)                from public, anon;
revoke execute on function public.q_quiz_can_edit_assessment(uuid)                from public, anon;
revoke execute on function public.q_quiz_can_manage_sharing(uuid)                 from public, anon;
grant execute on function public.q_quiz_my_team()                                 to authenticated;
grant execute on function public.q_quiz_access_for(uuid, uuid, text, boolean)     to authenticated;
grant execute on function public.q_quiz_assessment_access(uuid)                   to authenticated;
grant execute on function public.q_quiz_can_view_assessment(uuid)                 to authenticated;
grant execute on function public.q_quiz_can_edit_assessment(uuid)                 to authenticated;
grant execute on function public.q_quiz_can_manage_sharing(uuid)                  to authenticated;

-- Links are unique across ALL assessments, including ones you can't see.
create or replace function public.q_quiz_taken_slugs(p_root text)
returns setof text language sql stable security definer set search_path = public as $$
  select slug from public."q-quiz-assessments"
  where public.q_quiz_is_staff() and slug like replace(replace(lower(p_root), '%', ''), '_', '\_') || '%';
$$;
revoke execute on function public.q_quiz_taken_slugs(text) from public, anon;
grant execute on function public.q_quiz_taken_slugs(text) to authenticated;

-- ── Triggers ────────────────────────────────────────────────────────────────
-- New sign-ups: also store the team they picked on the sign-up form.
create or replace function public.q_quiz_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_first boolean;
  v_team  text := new.raw_user_meta_data->>'team';
begin
  if lower(new.email) like '%@qualifacts.com' then
    if not coalesce(public.q_quiz_is_team(v_team), false) then
      v_team := null;
    end if;
    select not exists (select 1 from public."q-quiz-profiles" where role = 'admin' and is_active) into v_first;
    insert into public."q-quiz-profiles" (id, email, full_name, role, is_active, team)
    values (
      new.id,
      lower(new.email),
      coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
      case when v_first then 'admin' else 'editor' end,
      v_first,
      v_team
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- New assessments belong to the creator's team.
create or replace function public.q_quiz_before_assessment_insert()
returns trigger language plpgsql as $$
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.owner_id   := coalesce(new.owner_id, new.created_by);
  new.updated_by := coalesce(new.updated_by, auth.uid());
  new.team       := coalesce(new.team, public.q_quiz_my_team());
  return new;
end $$;

-- Only the owner or an admin may change an assessment's owner or team.
create or replace function public.q_quiz_before_assessment_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if (new.owner_id is distinct from old.owner_id or new.team is distinct from old.team)
       and not (public.q_quiz_is_admin() or old.owner_id = auth.uid()) then
      raise exception 'Only the owner can change the owner or team' using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- When a user picks a team for the first time, tag their existing untagged assessments.
create or replace function public.q_quiz_after_profile_team_set()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team is not null and old.team is null then
    update public."q-quiz-assessments" set team = new.team where owner_id = new.id and team is null;
  end if;
  return new;
end $$;

create or replace trigger q_quiz_after_profile_team_set after update of team on public."q-quiz-profiles"
  for each row execute function public.q_quiz_after_profile_team_set();

-- Tell people when something is shared with them.
create or replace function public.q_quiz_after_share_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_title text;
  v_from  text;
begin
  if new.user_id is not distinct from auth.uid() then
    return new;
  end if;
  select title into v_title from public."q-quiz-assessments" where id = new.assessment_id;
  select coalesce(nullif(trim(full_name), ''), email) into v_from
  from public."q-quiz-profiles" where id = coalesce(new.granted_by, auth.uid());
  insert into public."q-quiz-notifications" (user_id, assessment_id, kind, title, body)
  values (new.user_id, new.assessment_id, 'share',
          coalesce(v_from, 'Someone') || ' shared an assessment with you',
          coalesce(v_title, 'Assessment') || ' · ' || case when new.permission = 'edit' then 'Can edit' else 'Can view' end);
  return new;
end $$;

create or replace trigger q_quiz_after_share_insert after insert on public."q-quiz-assessment-shares"
  for each row execute function public.q_quiz_after_share_insert();

-- ── Publish: needs edit access to THIS assessment ───────────────────────────
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
  if not public.q_quiz_can_edit_assessment(p_assessment_id) then
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

-- ── Row level security ──────────────────────────────────────────────────────
alter table public."q-quiz-assessment-shares" enable row level security;
revoke all on public."q-quiz-assessment-shares" from anon;

alter policy q_quiz_assessments_select on public."q-quiz-assessments"
  using (public.q_quiz_access_for(id, owner_id, team, is_template) is not null);
alter policy q_quiz_assessments_update on public."q-quiz-assessments"
  using (public.q_quiz_can_edit() and public.q_quiz_access_for(id, owner_id, team, is_template) in ('owner', 'edit'))
  with check (public.q_quiz_can_edit());
alter policy q_quiz_assessments_delete on public."q-quiz-assessments"
  using (public.q_quiz_access_for(id, owner_id, team, is_template) = 'owner');

alter policy q_quiz_versions_select on public."q-quiz-versions"
  using (public.q_quiz_can_view_assessment(assessment_id));

alter policy q_quiz_responses_select on public."q-quiz-responses"
  using (public.q_quiz_can_view_assessment(assessment_id));
alter policy q_quiz_responses_update on public."q-quiz-responses"
  using (public.q_quiz_can_edit_assessment(assessment_id))
  with check (public.q_quiz_can_edit_assessment(assessment_id));

alter policy q_quiz_events_select on public."q-quiz-events"
  using (public.q_quiz_can_view_assessment(assessment_id));

select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-shares', 'q_quiz_shares_select',
  $p$create policy q_quiz_shares_select on public."q-quiz-assessment-shares" for select to authenticated using (user_id = auth.uid() or public.q_quiz_can_view_assessment(assessment_id))$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-shares', 'q_quiz_shares_insert',
  $p$create policy q_quiz_shares_insert on public."q-quiz-assessment-shares" for insert to authenticated with check (public.q_quiz_can_manage_sharing(assessment_id))$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-shares', 'q_quiz_shares_update',
  $p$create policy q_quiz_shares_update on public."q-quiz-assessment-shares" for update to authenticated using (public.q_quiz_can_manage_sharing(assessment_id)) with check (public.q_quiz_can_manage_sharing(assessment_id))$p$);
select public.q_quiz_ensure_policy('public', 'q-quiz-assessment-shares', 'q_quiz_shares_delete',
  $p$create policy q_quiz_shares_delete on public."q-quiz-assessment-shares" for delete to authenticated using (public.q_quiz_can_manage_sharing(assessment_id))$p$);
