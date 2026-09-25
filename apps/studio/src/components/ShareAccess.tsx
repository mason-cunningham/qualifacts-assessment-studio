import { useEffect, useMemo, useState } from 'react';
import { displayName, useAuth } from '../lib/auth';
import { supabase, T } from '../lib/supabase';
import { teamLabel, type AssessmentRow, type Profile, type SharePermission, type ShareRow, type Team } from '../lib/types';
import { Loading, Modal, TeamSelect, useToast } from './ui';

type Row = Pick<AssessmentRow, 'id' | 'title' | 'owner_id' | 'team' | 'is_template'>;

function initials(p: Profile): string {
  const parts = displayName(p).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function Person({ p, sub }: { p: Profile; sub?: string }) {
  return (
    <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
      <span className="s-avatar">{initials(p)}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{displayName(p)}</div>
        <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.email}{sub ? ` · ${sub}` : ''}
        </div>
      </div>
    </div>
  );
}

/** Google-style "Share" dialog: add people as View/Edit, change or revoke their access. */
export function ShareAccessDialog({ row, onClose, onTeamChanged }: {
  row: Row; onClose: () => void; onTeamChanged?: (team: Team) => void;
}) {
  const { profile: me, isAdmin } = useAuth();
  const toast = useToast();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [team, setTeam] = useState<Team | null>(row.team);
  const [q, setQ] = useState('');
  const [pickId, setPickId] = useState('');
  const [perm, setPerm] = useState<SharePermission>('view');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from(T.profiles).select('*').eq('is_active', true).order('full_name'),
      supabase.from(T.shares).select('*').eq('assessment_id', row.id).order('created_at'),
    ]).then(([p, s]) => {
      if (p.error) toast.error(p.error);
      if (s.error) toast.error(s.error);
      setPeople((p.data as Profile[]) ?? []);
      setShares((s.data as ShareRow[]) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  const owner = row.owner_id ? byId.get(row.owner_id) : undefined;
  const teammates = (people ?? []).filter((p) => team && p.team === team && p.id !== row.owner_id);
  const sharedIds = new Set(shares.map((s) => s.user_id));
  const candidates = (people ?? []).filter((p) =>
    p.id !== row.owner_id && !sharedIds.has(p.id) && !(team && p.team === team) && p.role !== 'admin');
  const term = q.trim().toLowerCase();
  const matches = term
    ? candidates.filter((p) => `${p.full_name ?? ''} ${p.email} ${teamLabel(p.team) ?? ''}`.toLowerCase().includes(term))
    : candidates;
  const picked = pickId ? byId.get(pickId) : undefined;
  const canChangeTeam = isAdmin || row.owner_id === me?.id;

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    const permission: SharePermission = picked.role === 'viewer' ? 'view' : perm;
    const { data, error } = await supabase.from(T.shares).insert({ assessment_id: row.id, user_id: picked.id, permission }).select('*').single();
    setBusy(false);
    if (error) return toast.error(error);
    setShares((cur) => [...cur, data as ShareRow]);
    setPickId('');
    setQ('');
    toast.ok(`Shared with ${displayName(picked)}`);
  };

  const changePerm = async (s: ShareRow, permission: SharePermission) => {
    const prev = shares;
    setShares((cur) => cur.map((x) => (x.id === s.id ? { ...x, permission } : x)));
    const { error } = await supabase.from(T.shares).update({ permission }).eq('id', s.id);
    if (error) {
      setShares(prev);
      toast.error(error);
    }
  };

  const revoke = async (s: ShareRow) => {
    const prev = shares;
    setShares((cur) => cur.filter((x) => x.id !== s.id));
    const { error } = await supabase.from(T.shares).delete().eq('id', s.id);
    if (error) {
      setShares(prev);
      return toast.error(error);
    }
    toast.ok(`Removed ${displayName(byId.get(s.user_id))}'s access`);
  };

  const saveTeam = async (t: Team | null) => {
    if (!t || t === team) return;
    const { error } = await supabase.from(T.assessments).update({ team: t }).eq('id', row.id);
    if (error) return toast.error(error);
    setTeam(t);
    onTeamChanged?.(t);
    toast.ok(`Now shared with the ${teamLabel(t)} team`);
  };

  return (
    <Modal title={`Share “${row.title}”`} onClose={onClose} wide>
      {!people ? <Loading /> : (
        <div className="stack" style={{ gap: 20 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="label">Add people</div>
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
              <input className="input" style={{ flex: '1 1 220px' }} placeholder="Search by name, email or team…" value={q} onChange={(e) => { setQ(e.target.value); setPickId(''); }} />
              <select className="select" style={{ flex: '1 1 240px' }} value={pickId} onChange={(e) => setPickId(e.target.value)}>
                <option value="">{matches.length ? `Choose a person (${matches.length})…` : 'No one else to add'}</option>
                {matches.map((p) => (
                  <option key={p.id} value={p.id}>{displayName(p)} · {teamLabel(p.team) ?? 'No team'}</option>
                ))}
              </select>
              <select className="select" style={{ width: 120 }} value={picked?.role === 'viewer' ? 'view' : perm} disabled={picked?.role === 'viewer'} onChange={(e) => setPerm(e.target.value as SharePermission)}>
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
              <button className="btn btn-primary" disabled={!picked || busy} onClick={add}>Share</button>
            </div>
            {picked?.role === 'viewer' && <span className="small muted">{displayName(picked)} has a viewer account, so they can only view.</span>}
            <span className="small muted">View: see the assessment, results and leads, and export lead lists. Edit: also change and publish it.</span>
          </div>

          <div className="stack" style={{ gap: 0 }}>
            <div className="label" style={{ marginBottom: 8 }}>People with access</div>
            {owner && (
              <div className="row-between hairline-bottom" style={{ padding: '10px 0' }}>
                <Person p={owner} sub={teamLabel(owner.team) ?? undefined} />
                <span className="small muted">Owner</span>
              </div>
            )}
            {shares.map((s) => {
              const p = byId.get(s.user_id);
              if (!p) return null;
              return (
                <div key={s.id} className="row-between hairline-bottom" style={{ padding: '10px 0' }}>
                  <Person p={p} sub={teamLabel(p.team) ?? undefined} />
                  <div className="row" style={{ gap: 6 }}>
                    <select className="select input-sm" style={{ width: 110 }} value={s.permission} onChange={(e) => changePerm(s, e.target.value as SharePermission)}>
                      <option value="view">Can view</option>
                      <option value="edit" disabled={p.role === 'viewer'}>Can edit</option>
                    </select>
                    <button className="btn btn-ghost btn-sm" onClick={() => revoke(s)}>Remove</button>
                  </div>
                </div>
              );
            })}
            {shares.length === 0 && <div className="small muted" style={{ padding: '10px 0' }}>Not shared with anyone outside the team yet.</div>}
          </div>

          <div className="subtle-box" style={{ padding: '14px 16px' }}>
            <div className="row-between" style={{ flexWrap: 'wrap' }}>
              <div>
                <div className="label">Team access</div>
                <div className="small muted">
                  {team
                    ? <>Everyone on <b>{teamLabel(team)}</b> can edit and share ({teammates.length} {teammates.length === 1 ? 'person' : 'people'}).</>
                    : 'No team yet. Visible to all Studio users until the owner picks a team.'}
                  {' '}Admins can always see it.
                </div>
              </div>
              {canChangeTeam && <TeamSelect className="select input-sm" placeholder="Choose team…" value={team} onChange={saveTeam} />}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
