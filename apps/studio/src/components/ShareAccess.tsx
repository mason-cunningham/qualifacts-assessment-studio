import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { displayName, useAuth } from '../lib/auth';
import { supabase, T } from '../lib/supabase';
import { TEAM_OPTIONS, teamLabel, type AssessmentRow, type Profile, type SharePermission, type ShareRow, type Team } from '../lib/types';
import { Loading, Modal, useToast } from './ui';

type Row = Pick<AssessmentRow, 'id' | 'title' | 'owner_id' | 'teams' | 'is_template'>;

function initials(p: Profile): string {
  const parts = displayName(p).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Bold the parts of `text` that match `term` (case-insensitive). */
function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<b>{text.slice(i, i + term.length)}</b>{text.slice(i + term.length)}</>;
}

function Person({ p, sub, term = '' }: { p: Profile; sub?: string; term?: string }) {
  return (
    <div className="row" style={{ gap: 10, minWidth: 0, flex: 1 }}>
      <span className="s-avatar">{initials(p)}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{highlight(displayName(p), term)}</div>
        <div className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {highlight(p.email, term)}{sub ? <> · {highlight(sub, term)}</> : null}
        </div>
      </div>
    </div>
  );
}

/** Google-style "Share" dialog: add people as View/Edit, manage which teams have access, revoke. */
export function ShareAccessDialog({ row, onClose, onTeamsChanged }: {
  row: Row; onClose: () => void; onTeamsChanged?: (teams: Team[]) => void;
}) {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [teams, setTeams] = useState<Team[]>(row.teams ?? []);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<Profile | null>(null);
  const [perm, setPerm] = useState<SharePermission>('view');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  // Close suggestions when clicking elsewhere
  useEffect(() => {
    const onDoc = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setFocused(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  const owner = row.owner_id ? byId.get(row.owner_id) : undefined;
  const sharedIds = new Set(shares.map((s) => s.user_id));

  /** Why someone already has access (or null if they can be added) */
  const reason = (p: Profile): string | null => {
    if (p.id === row.owner_id) return 'Owner';
    if (p.role === 'admin') return 'Admin: sees everything';
    if (sharedIds.has(p.id)) return 'Already shared';
    if (p.team && teams.includes(p.team)) return `Has access via ${teamLabel(p.team)}`;
    return null;
  };

  const term = q.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const list = (people ?? []).filter((p) => p.id !== me?.id);
    const matches = term
      ? list.filter((p) => `${p.full_name ?? ''} ${p.email} ${teamLabel(p.team) ?? ''}`.toLowerCase().includes(term))
      : list;
    // People who can be added first, then everyone who already has access
    return [...matches.filter((p) => !reason(p)), ...matches.filter((p) => !!reason(p))].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, term, shares, teams, me?.id]);
  const selectable = suggestions.filter((p) => !reason(p));
  const teamPeople = (people ?? []).filter((p) => p.team && teams.includes(p.team) && p.id !== row.owner_id);

  const choose = (p: Profile) => {
    if (reason(p)) return;
    setPicked(p);
    setPerm(p.role === 'viewer' ? 'view' : perm);
    setQ('');
    setFocused(false);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActive((i) => Math.min(i + 1, selectable.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = selectable[active]; if (p) choose(p); }
    else if (e.key === 'Escape') { setFocused(false); }
  };

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    const permission: SharePermission = picked.role === 'viewer' ? 'view' : perm;
    const { data, error } = await supabase.from(T.shares).insert({ assessment_id: row.id, user_id: picked.id, permission }).select('*').single();
    setBusy(false);
    if (error) return toast.error(error);
    setShares((cur) => [...cur, data as ShareRow]);
    toast.ok(`Shared with ${displayName(picked)}`);
    setPicked(null);
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

  const saveTeams = async (next: Team[], msg: string) => {
    const prev = teams;
    setTeams(next);
    const { error } = await supabase.from(T.assessments).update({ teams: next }).eq('id', row.id);
    if (error) {
      setTeams(prev);
      return toast.error(error);
    }
    onTeamsChanged?.(next);
    toast.ok(msg);
  };

  const removeTeam = (t: Team) => {
    const losesAccess = me?.role !== 'admin' && row.owner_id !== me?.id && me?.team === t && !sharedIds.has(me?.id ?? '');
    if (losesAccess && !window.confirm(`You're on ${teamLabel(t)}. Removing it means you'll lose access to this assessment. Continue?`)) return;
    saveTeams(teams.filter((x) => x !== t), `${teamLabel(t)} no longer has team access`);
  };

  const available = TEAM_OPTIONS.filter(([k]) => !teams.includes(k));

  return (
    <Modal title={`Share “${row.title}”`} onClose={onClose} wide>
      {!people ? <Loading /> : (
        <div className="stack" style={{ gap: 22 }}>
          <div className="stack" style={{ gap: 10 }}>
            <div className="label">Add people</div>
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
              <div ref={boxRef} style={{ position: 'relative', flex: '1 1 320px' }}>
                {picked ? (
                  <div className="input row-between" style={{ background: '#fff' }}>
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="s-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{initials(picked)}</span>
                      <span className="s-ellipsis"><b style={{ color: 'var(--navy)' }}>{displayName(picked)}</b> <span className="muted small">{picked.email}</span></span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Clear" onClick={() => setPicked(null)}>✕</button>
                  </div>
                ) : (
                  <input
                    className="input"
                    role="combobox"
                    aria-expanded={focused}
                    aria-autocomplete="list"
                    placeholder="Type a name, email or team…"
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setFocused(true); setActive(0); }}
                    onFocus={() => setFocused(true)}
                    onKeyDown={onKey}
                  />
                )}
                {focused && !picked && (
                  <div className="bell-menu" role="listbox" style={{ left: 0, right: 0, width: 'auto', top: 'calc(100% + 6px)' }}>
                    {suggestions.length === 0 && <div className="empty small" style={{ padding: 16 }}>No active users match “{q}”.</div>}
                    {suggestions.map((p) => {
                      const why = reason(p);
                      const idx = selectable.indexOf(p);
                      return (
                        <Fragment key={p.id}>
                          <div
                            role="option"
                            aria-selected={idx === active}
                            aria-disabled={!!why}
                            className="bell-item row-between"
                            style={{ cursor: why ? 'default' : 'pointer', opacity: why ? 0.55 : 1, background: idx === active && !why ? 'var(--s-teal-soft)' : undefined }}
                            onMouseEnter={() => idx >= 0 && setActive(idx)}
                            onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                          >
                            <Person p={p} sub={teamLabel(p.team) ?? 'No team'} term={term} />
                            {why && <span className="small muted" style={{ whiteSpace: 'nowrap', marginLeft: 8 }}>{why}</span>}
                          </div>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
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
            {shares.length === 0 && <div className="small muted" style={{ padding: '10px 0' }}>Not shared with anyone individually yet.</div>}
          </div>

          <div className="subtle-box" style={{ padding: '14px 16px' }}>
            <div className="label">Teams with access</div>
            <div className="small muted" style={{ margin: '2px 0 10px' }}>
              {teams.length
                ? <>Everyone on these teams can edit and share ({teamPeople.length} {teamPeople.length === 1 ? 'person' : 'people'}). Admins can always see it.</>
                : 'No teams. Only the owner, admins and people shared individually have access.'}
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              {teams.map((t) => (
                <span key={t} className="pill pill-published" style={{ fontSize: 12, padding: '5px 6px 5px 12px' }}>
                  {teamLabel(t)}
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" style={{ minHeight: 20, padding: '0 6px' }} aria-label={`Remove ${teamLabel(t)}`} onClick={() => removeTeam(t)}>✕</button>
                </span>
              ))}
              {available.length > 0 && (
                <select className="select input-sm" style={{ width: 'auto' }} value="" onChange={(e) => {
                  const t = e.target.value as Team;
                  if (t) saveTeams([...teams, t], `${teamLabel(t)} now has team access`);
                }}>
                  <option value="">+ Add team…</option>
                  {available.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
