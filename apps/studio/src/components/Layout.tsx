import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { qualifactsLogo } from '@qq/ui';
import { displayName, useAuth } from '../lib/auth';
import { NotificationBell } from './NotificationBell';
import { IconBell, IconBook, IconBox, IconDashboard, IconInbox, IconLogOut, IconPlus, IconSparkle, IconUsers } from './icons';

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
    </div>
  );
}

/** Page header bar used by every page. */
export function TopBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="s-topbar">
      <h1>{title}</h1>
      <div className="s-spacer" />
      {children}
      <NotificationBell />
    </div>
  );
}
