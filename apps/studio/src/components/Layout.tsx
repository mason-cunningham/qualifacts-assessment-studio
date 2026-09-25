import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { qualifactsLogo } from '@qq/ui';
import { displayName, useAuth } from '../lib/auth';
import { NotificationBell } from './NotificationBell';
import { TeamGate } from './TeamPrompt';
import { IconBell, IconBook, IconBox, IconDashboard, IconInbox, IconLogOut, IconMenu, IconPlus, IconSparkle, IconUsers } from './icons';

function initials(name: string): string {
  const parts = name.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Layout() {
  const { profile, signOut, isAdmin } = useAuth();
  const name = displayName(profile);
  return (
    <div className="s-app">
      <aside className="s-side">
        <div className="s-brand">
          <img src={qualifactsLogo} alt="Qualifacts" />
          <span>Assessment Studio</span>
        </div>
        <nav className="s-nav">
          <NavLink to="/" end><IconDashboard />Dashboard</NavLink>
          <NavLink to="/new" end><IconPlus />New assessment</NavLink>
          <NavLink to="/new/ai"><IconSparkle />Generate with AI</NavLink>
          <div className="s-nav-label">Data</div>
          <NavLink to="/responses"><IconInbox />All responses</NavLink>
          <NavLink to="/notifications"><IconBell />Lead alerts</NavLink>
          <div className="s-nav-label">Library</div>
          <NavLink to="/products"><IconBox />Solutions library</NavLink>
          <NavLink to="/knowledge"><IconBook />Knowledge library</NavLink>
          {isAdmin && (
            <>
              <div className="s-nav-label">Admin</div>
              <NavLink to="/users"><IconUsers />Users</NavLink>
            </>
          )}
        </nav>
        <div className="s-side-foot">
          <NavLink to="/profile">
            <span className="s-avatar">{initials(name)}</span>
            <span style={{ minWidth: 0 }}>
              <div className="s-who">{name}</div>
              <div className="s-role">{profile?.role}</div>
            </span>
          </NavLink>
          <button onClick={signOut} aria-label="Sign out" title="Sign out"><IconLogOut /></button>
        </div>
      </aside>
      <div className="s-main">
        <Outlet />
      </div>
      <TeamGate />
    </div>
  );
}

/**
 * Page header bar used by every page.
 * `children` are secondary actions: they fold into a ☰ menu at the exact width where the
 * row would otherwise wrap. `primary` (e.g. Publish) and the bell always stay on the top line.
 */
export function TopBar({ title, children, primary }: { title: ReactNode; children?: ReactNode; primary?: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const collapsedRef = useRef(false);
  const neededWidth = useRef(0);
  const hasActions = Children.toArray(children).length > 0;

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (!collapsedRef.current) {
      // Expanded: nothing may shrink, so any overflow means the row would wrap
      if (bar.scrollWidth > bar.clientWidth + 1) {
        neededWidth.current = bar.scrollWidth;
        collapsedRef.current = true;
        setCollapsed(true);
      }
    } else if (bar.clientWidth >= neededWidth.current) {
      collapsedRef.current = false;
      setCollapsed(false);
      setOpen(false);
    }
  }, []);

  // Re-check after every render (actions can change) and whenever the bar resizes
  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(bar);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => wrapRef.current && !wrapRef.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`s-topbar ${collapsed ? 'collapsed' : ''}`} ref={barRef}>
      <h1>{title}</h1>
      <div className="s-spacer" />
      {hasActions && (
        <div className="s-actions-wrap" ref={wrapRef}>
          {collapsed && (
            <button className="btn btn-secondary btn-icon" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <IconMenu />
            </button>
          )}
          {/* Rendered once in both modes so each action keeps its state (e.g. Review's results modal) */}
          <div
            className={`s-actions ${collapsed ? 's-actions-menu' : ''} ${collapsed && !open ? 'is-hidden' : ''}`}
            onClick={collapsed ? (e) => (e.target as HTMLElement).closest('button, a') && setOpen(false) : undefined}
          >
            {children}
          </div>
        </div>
      )}
      {primary}
      <NotificationBell />
    </div>
  );
}
