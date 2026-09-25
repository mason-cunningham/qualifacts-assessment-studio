import { useEffect, useState } from 'react';
import { TopBar } from '../components/Layout';
import { Loading, Modal, TeamSelect, useToast } from '../components/ui';
import { supabase, T, errorMessage } from '../lib/supabase';
import { displayName, useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import { teamLabel, type AiRequestRow, type Profile, type Role } from '../lib/types';

// Claude Opus 5 list pricing (USD per million tokens). Cache reads cost less, so this is an upper bound.
const PRICE_IN = 5;
const PRICE_OUT = 25;

function AiUsageCard({ people }: { people: Profile[] }) {
  const [rows, setRows] = useState<AiRequestRow[] | null>(null);
  useEffect(() => {
    const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    supabase.from(T.aiRequests).select('id,user_id,mode,model,input_tokens,output_tokens,status,error,duration_ms,created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(2000)
      .then(({ data }) => setRows((data as AiRequestRow[]) ?? []));
  }, []);
  if (!rows) return null;
  const cost = (r: AiRequestRow) => ((r.input_tokens ?? 0) * PRICE_IN + (r.output_tokens ?? 0) * PRICE_OUT) / 1_000_000;
  const total = rows.reduce((s, r) => s + cost(r), 0);
  const byUser = new Map<string, { n: number; cost: number; errors: number }>();
  for (const r of rows) {
    const k = r.user_id ?? 'unknown';
    const cur = byUser.get(k) ?? { n: 0, cost: 0, errors: 0 };
    cur.n++;
    cur.cost += cost(r);
    if (r.status === 'error') cur.errors++;
    byUser.set(k, cur);
  }
  return (
    <div className="card">
      <div className="card-title">AI usage (last 30 days)</div>
      <div className="card-sub">
        {rows.length} requests · about ${total.toFixed(2)} at Claude Opus 5 list prices (an upper bound; cached context costs less). Set a hard monthly limit in the Anthropic Console.
      </div>
      {rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Person</th><th>Requests</th><th>Errors</th><th>Est. cost</th></tr></thead>
          <tbody>
            {[...byUser.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([uid, v]) => (
              <tr key={uid}>
                <td>{displayName(people.find((p) => p.id === uid))}</td>
                <td>{v.n}</td>
                <td>{v.errors || '—'}</td>
                <td>${v.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function UsersPage() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [resetFor, setResetFor] = useState<Profile | null>(null);
  const [tempPw, setTempPw] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from(T.profiles).select('*').order('is_active').order('created_at', { ascending: false })
    .then(({ data }) => setRows((data as Profile[]) ?? []));
  useEffect(() => { load(); }, []);

  const patch = async (p: Profile, change: Partial<Profile>, msg: string) => {
    const { error } = await supabase.from(T.profiles).update(change).eq('id', p.id);
    if (error) return toast.error(error);
    toast.ok(msg);
    load();
  };

  const setPassword = async () => {
    if (!resetFor) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', {
        body: { action: 'set_password', user_id: resetFor.id, password: tempPw },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.ok(`Temporary password set for ${displayName(resetFor)}`);
      setResetFor(null);
    } catch (e) {
      toast.error(`${errorMessage(e)}. Is the admin-users Edge Function deployed?`);
    } finally {
      setBusy(false);
    }
  };

  const pending = (rows ?? []).filter((r) => !r.is_active);
  const active = (rows ?? []).filter((r) => r.is_active);

  return (
    <>
      <TopBar title="Users" />
      <div className="s-page">
        {!rows ? <Loading /> : (
          <>
            {pending.length > 0 && (
              <div className="card" style={{ borderColor: 'var(--amber)' }}>
                <div className="card-title">Waiting for approval ({pending.length})</div>
                <div className="card-sub">Only approve people you recognize. Anyone can sign up with a @qualifacts.com address, and email isn't verified yet.</div>
                <table className="table">
                  <tbody>
                    {pending.map((p) => (
                      <tr key={p.id}>
                        <td><b>{displayName(p)}</b><div className="small muted">{p.email}</div></td>
                        <td className="small muted">{teamLabel(p.team) ?? 'No team yet'}</td>
                        <td className="small muted">Signed up {fmtDate(p.created_at)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => patch(p, { is_active: true, role: 'editor' }, `${displayName(p)} approved as editor`)}>Approve as editor</button>{' '}
                          <button className="btn btn-secondary btn-sm" onClick={() => patch(p, { is_active: true, role: 'viewer' }, `${displayName(p)} approved as viewer`)}>Approve as viewer</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <AiUsageCard people={rows} />
            <div className="card">
              <div className="card-title">People ({active.length})</div>
              <div className="card-sub"><b>Admins</b> see everything, manage users and can delete. <b>Editors</b> create, edit and publish. <b>Viewers</b> see assessments and responses. Everyone sees their <b>team's</b> assessments plus anything shared with them.</div>
              <table className="table">
                <thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Joined</th><th /></tr></thead>
                <tbody>
                  {active.map((p) => (
                    <tr key={p.id}>
                      <td><b>{displayName(p)}</b>{p.id === me?.id && <span className="pill pill-neutral" style={{ marginLeft: 6 }}>You</span>}<div className="small muted">{p.email}</div></td>
                      <td>
                        <select className="select input-sm" style={{ width: 120 }} value={p.role} disabled={p.id === me?.id}
                          onChange={(e) => patch(p, { role: e.target.value as Role }, 'Role updated')}>
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>
                      <td>
                        <TeamSelect className="select input-sm" placeholder="No team" value={p.team}
                          onChange={(team) => team && patch(p, { team }, 'Team updated')} />
                      </td>
                      <td className="small muted">{fmtDate(p.created_at)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => { setResetFor(p); setTempPw(randomPassword()); }}>Set temporary password</button>
                        {p.id !== me?.id && (
                          <button className="btn btn-ghost btn-sm" onClick={() => window.confirm(`Remove ${displayName(p)}'s access?`) && patch(p, { is_active: false }, 'Access removed')}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {resetFor && (
        <Modal
          title={`Temporary password for ${displayName(resetFor)}`}
          onClose={() => setResetFor(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setResetFor(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || tempPw.length < 10} onClick={setPassword}>Set password</button></>}
        >
          <p className="small muted" style={{ marginTop: 0 }}>Share it with them directly (Teams DM, not a channel). They can change it on their Profile page after signing in.</p>
          <div className="link-box">
            <input className="input mono" value={tempPw} onChange={(e) => setTempPw(e.target.value)} />
            <button className="btn btn-secondary" onClick={() => setTempPw(randomPassword())}>Regenerate</button>
          </div>
        </Modal>
      )}
    </>
  );
}
