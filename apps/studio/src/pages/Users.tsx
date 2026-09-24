import { useEffect, useState } from 'react';
import { TopBar } from '../components/Layout';
import { Loading, Modal, useToast } from '../components/ui';
import { supabase, T, errorMessage } from '../lib/supabase';
import { displayName, useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import type { Profile, Role } from '../lib/types';

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
            <div className="card">
              <div className="card-title">Team ({active.length})</div>
              <div className="card-sub"><b>Admins</b> manage users and can delete. <b>Editors</b> create, edit and publish. <b>Viewers</b> see assessments and responses.</div>
              <table className="table">
                <thead><tr><th>Name</th><th>Role</th><th>Joined</th><th /></tr></thead>
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
