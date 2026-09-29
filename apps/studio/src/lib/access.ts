import type { AssessmentRow, Profile, ShareRow } from './types';

// Mirrors q_quiz_access_for() in supabase/007_roles_teams.sql so the UI only offers
// what the database allows. The database (RLS) is the real enforcement.

export type Access = 'owner' | 'edit' | 'view' | null;

type Row = Pick<AssessmentRow, 'id' | 'owner_id' | 'teams' | 'is_template'>;
type Me = Pick<Profile, 'id' | 'role' | 'team' | 'is_active'> | null | undefined;

const onTeams = (row: Row, me: NonNullable<Me>) => !!me.team && (row.teams ?? []).includes(me.team);

export function accessFor(row: Row, me: Me, shares: Pick<ShareRow, 'assessment_id' | 'user_id' | 'permission'>[] = []): Access {
  if (!me?.is_active) return null;
  if (me.role === 'admin' || row.owner_id === me.id) return 'owner';
  const editOrView: Access = me.role === 'editor' ? 'edit' : 'view';
  if (onTeams(row, me)) return editOrView;
  // No teams: the database only returns such a row to non-owners when it's legacy (owner has no team)
  if (!(row.teams ?? []).length) return editOrView;
  const share = shares.find((s) => s.assessment_id === row.id && s.user_id === me.id);
  if (share) return share.permission === 'edit' ? editOrView : 'view';
  if (row.is_template) return 'view';
  return null;
}

export function canEditRow(access: Access, me: Me): boolean {
  return (access === 'owner' || access === 'edit') && !!me && (me.role === 'admin' || me.role === 'editor');
}

/** Owner, admin, or anyone (editor role) on a team with access may share, revoke and change teams. */
export function canManageSharing(row: Row, me: Me): boolean {
  if (!me?.is_active || me.role === 'viewer') return false;
  return me.role === 'admin' || row.owner_id === me.id || onTeams(row, me);
}
