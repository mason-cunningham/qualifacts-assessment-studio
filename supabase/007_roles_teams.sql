-- ════════════════════════════════════════════════════════════════════════════
-- Qualifacts Assessment Studio — 007: instant sign-up access + multiple teams per assessment
-- Run once in the Supabase SQL editor (after 006). NON-DESTRUCTIVE; safe to re-run.
--
-- • @qualifacts.com sign-ups get access right away as editors (no admin approval).
--   Note: email ownership isn't verified unless you turn on Auth → "Confirm email".
-- • Assessments can belong to several teams (teams text[]). Only the creator's team is
--   added automatically; anyone who can share the assessment can add or remove teams.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Instant access ──────────────────────────────────────────────────────
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
      true,
      v_team
    )
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

-- From now on, admin deactivations are recorded so they're never undone by auto-approval
alter table public."q-quiz-profiles" add column if not exists deactivated_at timestamptz;

-- Approve everyone who was waiting. (Before this migration there was no way to tell a pending
-- account from a deactivated one, so all inactive @qualifacts.com accounts are turned on here;
-- deactivate anyone who shouldn't have access on the Users page.)
update public."q-quiz-profiles"
   set is_active = true
 where not is_active
   and deactivated_at is null
   and lower(email) like '%@qualifacts.com';

-- ── 2. Multiple teams per assessment ────────────────────────────────────────
create or replace function public.q_quiz_teams_ok(p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(public.q_quiz_is_team(t)), true) from unnest(coalesce(p, '{}')) as t;
$$;

alter table public."q-quiz-assessments" add column if not exists teams text[] not null default '{}';
do $$ begin
  alter table public."q-quiz-assessments" add constraint q_quiz_assessments_teams_chk check (public.q_quiz_teams_ok(teams));
exception when duplicate_object then null;
end $$;
create index if not exists q_quiz_assessments_teams_idx on public."q-quiz-assessments" using gin (teams);

-- Backfill from the single-team column (kept for compatibility, no longer used by Studio)
update public."q-quiz-assessments"
   set teams = array[team]
 where team is not null and cardinality(teams) = 0;

-- Access with a team list. Legacy rule: no teams AND the owner has no team → visible to all staff.
create or replace function public.q_quiz_access_for(p_id uuid, p_owner uuid, p_teams text[], p_template boolean)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_role text := public.q_quiz_role();
  v_my   text;
  v_perm text;
  v_owner_team text;
  v_edit text;
begin
  if v_role is null then
    return null;
  end if;
  if v_role = 'admin' or p_owner = auth.uid() then
    return 'owner';
  end if;
  v_edit := case when v_role = 'editor' then 'edit' else 'view' end;
  v_my := public.q_quiz_my_team();
  if v_my is not null and v_my = any(coalesce(p_teams, '{}')) then
    return v_edit;
  end if;
  if coalesce(cardinality(p_teams), 0) = 0 then
    select team into v_owner_team from public."q-quiz-profiles" where id = p_owner;
    if v_owner_team is null then
      return v_edit;
    end if;
  end if;
  select permission into v_perm
  from public."q-quiz-assessment-shares"
  where assessment_id = p_id and user_id = auth.uid();
  if v_perm is not null then
    return case when v_perm = 'edit' then v_edit else 'view' end;
  end if;
  if p_template then
    return 'view';
  end if;
  return null;
end $$;

create or replace function public.q_quiz_assessment_access(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.q_quiz_access_for(a.id, a.owner_id, a.teams, a.is_template)
  from public."q-quiz-assessments" a where a.id = p_id;
$$;

-- Owner, admin, or anyone on a team that has access (editor role) may share, revoke and change teams.
create or replace function public.q_quiz_can_manage_sharing(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.q_quiz_can_edit() and exists (
    select 1 from public."q-quiz-assessments" a
    where a.id = p_id
      and (public.q_quiz_is_admin() or a.owner_id = auth.uid()
           or public.q_quiz_my_team() = any(a.teams))
  ), false);
$$;

revoke execute on function public.q_quiz_access_for(uuid, uuid, text[], boolean) from public, anon;
revoke execute on function public.q_quiz_teams_ok(text[])                          from public, anon;
grant  execute on function public.q_quiz_access_for(uuid, uuid, text[], boolean) to authenticated;
grant  execute on function public.q_quiz_teams_ok(text[])                          to authenticated;

-- New assessments start with the creator's team only
create or replace function public.q_quiz_before_assessment_insert()
returns trigger language plpgsql as $$
declare
  v_my text := public.q_quiz_my_team();
begin
  new.created_by := coalesce(new.created_by, auth.uid());
  new.owner_id   := coalesce(new.owner_id, new.created_by);
  new.updated_by := coalesce(new.updated_by, auth.uid());
  new.team       := coalesce(new.team, v_my);
  if coalesce(cardinality(new.teams), 0) = 0 and v_my is not null then
    new.teams := array[v_my];
  end if;
  new.teams := coalesce(new.teams, '{}');
  return new;
end $$;

-- Owner changes: owner/admin only. Team changes: anyone who could manage sharing before the change.
create or replace function public.q_quiz_before_assessment_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    if new.owner_id is distinct from old.owner_id
       and not (public.q_quiz_is_admin() or old.owner_id = auth.uid()) then
      raise exception 'Only the owner can change the owner' using errcode = '42501';
    end if;
    if (new.teams is distinct from old.teams or new.team is distinct from old.team)
       and not (public.q_quiz_is_admin() or old.owner_id = auth.uid()
                or public.q_quiz_my_team() = any(old.teams)) then
      raise exception 'Only people who can share this assessment can change its teams' using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
  end if;
  new.teams := coalesce(new.teams, '{}');
  return new;
end $$;

-- First time a user picks a team: tag their untagged assessments
create or replace function public.q_quiz_after_profile_team_set()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team is not null and old.team is null then
    update public."q-quiz-assessments"
       set team  = coalesce(team, new.team),
           teams = case when cardinality(teams) = 0 then array[new.team] else teams end
     where owner_id = new.id and (team is null or cardinality(teams) = 0);
  end if;
  return new;
end $$;

-- Tell a team when it's given access to an assessment
create or replace function public.q_quiz_after_assessment_teams_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_added text[];
begin
  select array(select unnest(new.teams) except select unnest(coalesce(old.teams, '{}'))) into v_added;
  if coalesce(cardinality(v_added), 0) = 0 or auth.uid() is null then
    return new;
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into v_from from public."q-quiz-profiles" where id = auth.uid();
  insert into public."q-quiz-notifications" (user_id, assessment_id, kind, title, body)
  select p.id, new.id, 'share',
         coalesce(v_from, 'Someone') || ' gave your team access to an assessment',
         coalesce(new.title, 'Assessment') || ' · Can edit'
    from public."q-quiz-profiles" p
   where p.is_active and p.team = any(v_added) and p.id <> auth.uid() and p.id is distinct from new.owner_id;
  return new;
end $$;

create or replace trigger q_quiz_after_assessment_teams_change after update of teams on public."q-quiz-assessments"
  for each row execute function public.q_quiz_after_assessment_teams_change();

-- Policies now use the team list
alter policy q_quiz_assessments_select on public."q-quiz-assessments"
  using (public.q_quiz_access_for(id, owner_id, teams, is_template) is not null);
alter policy q_quiz_assessments_update on public."q-quiz-assessments"
  using (public.q_quiz_can_edit() and public.q_quiz_access_for(id, owner_id, teams, is_template) in ('owner', 'edit'))
  with check (public.q_quiz_can_edit());
alter policy q_quiz_assessments_delete on public."q-quiz-assessments"
  using (public.q_quiz_access_for(id, owner_id, teams, is_template) = 'owner');
