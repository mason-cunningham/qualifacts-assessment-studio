import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/Layout';
import { Loading } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtDate } from '../lib/format';
import type { NotificationRow } from '../lib/types';

export function NotificationsPage() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [rows, setRows] = useState<NotificationRow[] | null>(null);

  const load = () => {
    if (!uid) return;
    supabase.from(T.notifications).select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => setRows((data as NotificationRow[]) ?? []));
  };
  useEffect(load, [uid]);

  const markAll = async () => {
    if (!uid) return;
    await supabase.from(T.notifications).update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null);
    load();
  };

  return (
    <>
      <TopBar title="Lead alerts">
        <button className="btn btn-secondary btn-sm" onClick={markAll}>Mark all read</button>
      </TopBar>
      <div className="s-page s-page-narrow">
        <p className="muted" style={{ marginTop: 0 }}>
          You get an alert whenever someone completes an assessment you own. Email alerts will be added once email sending is set up.
        </p>
        {!rows ? <Loading /> : rows.length === 0 ? (
          <div className="card empty"><h3>No alerts yet</h3><p>Publish an assessment and share its link to start getting leads.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {rows.map((n) => (
                  <tr key={n.id} style={{ background: n.read_at ? undefined : 'rgba(0,178,169,0.05)' }}>
                    <td style={{ width: 10 }}>{!n.read_at && <span className="dot-live" />}</td>
                    <td>
                      {n.response_id ? <Link to={`/responses/${n.response_id}`} style={{ fontWeight: 700, color: 'var(--navy)' }}>{n.title}</Link> : <b>{n.title}</b>}
                      <div className="small muted">{n.body}</div>
                    </td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{fmtDate(n.created_at, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
