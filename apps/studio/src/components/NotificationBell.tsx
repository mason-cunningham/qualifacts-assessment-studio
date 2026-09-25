import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, T } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { fmtRelative } from '../lib/format';
import type { NotificationRow } from '../lib/types';

export function NotificationBell() {
  const { session } = useAuth();
  const uid = session?.user.id;
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from(T.notifications).select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(15);
    setItems((data as NotificationRow[]) ?? []);
  }, [uid]);

  useEffect(() => {
    load();
    if (!uid) return;
    const channel = supabase
      .channel(`qq-notifications-${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: T.notifications, filter: `user_id=eq.${uid}` }, (payload) => {
        setItems((cur) => [payload.new as NotificationRow, ...cur].slice(0, 15));
      })
      .subscribe();
    // Fallback poll in case realtime isn't enabled on the project
    const poll = setInterval(load, 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [uid, load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const unread = items.filter((n) => !n.read_at).length;

  const markAllRead = async () => {
    if (!uid) return;
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? now })));
    await supabase.from(T.notifications).update({ read_at: now }).eq('user_id', uid).is('read_at', null);
  };

  const markRead = async (id: string) => {
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n)));
    await supabase.from(T.notifications).update({ read_at: now }).eq('id', id).is('read_at', null);
  };

  return (
    <div className="bell" ref={ref}>
      <button className="btn btn-secondary btn-icon" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 21a1.94 1.94 0 0 0 3.4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
      {open && (
        <div className="bell-menu">
          <div className="row-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
            <b style={{ color: 'var(--navy)' }}>Notifications</b>
            <div className="row">
              {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={markAllRead}>Mark all read</button>}
              <Link className="btn btn-ghost btn-sm" to="/notifications" onClick={() => setOpen(false)}>View all</Link>
            </div>
          </div>
          {items.length === 0 && <div className="empty small">No alerts yet. You'll see new leads and assessments shared with you here.</div>}
          {items.map((n) => (
            <Link
              key={n.id}
              to={n.response_id ? `/responses/${n.response_id}` : n.assessment_id ? `/assessments/${n.assessment_id}` : '/notifications'}
              className={`bell-item ${n.read_at ? '' : 'unread'}`}
              onClick={() => {
                markRead(n.id);
                setOpen(false);
              }}
            >
              <b>{n.title}</b>
              <span className="small muted">{n.body} · {fmtRelative(n.created_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
