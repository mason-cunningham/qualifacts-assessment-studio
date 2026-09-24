import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { qualifactsLogo } from '@qq/ui';
import { displayName, useAuth } from '../lib/auth';
import { NotificationBell } from './NotificationBell';

export function Layout() {
  const { profile, signOut, isAdmin } = useAuth();
  return (
    <div className="s-app">
      <aside className="s-side">
        <div className="s-brand">
          <img src={qualifactsLogo} alt="Qualifacts" />
        </div>
        <div className="s-brand" style={{ paddingTop: 0, marginTop: -14 }}><span>Assessment Studio</span></div>
        <nav className="s-nav">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/new" end>New assessment</NavLink>
          <NavLink to="/new/ai">✨ Generate with AI</NavLink>
          <div className="s-nav-label">Data</div>
          <NavLink to="/responses">All responses</NavLink>
          <NavLink to="/notifications">Lead alerts</NavLink>
          <div className="s-nav-label">Library</div>
          <NavLink to="/products">Solutions library</NavLink>
          <NavLink to="/knowledge">Knowledge library</NavLink>
          {isAdmin && (
            <>
              <div className="s-nav-label">Admin</div>
              <NavLink to="/users">Users</NavLink>
            </>
          )}
        </nav>
        <div className="s-side-foot">
          <NavLink to="/profile" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="s-who">{displayName(profile)}</div>
            <div className="s-role">{profile?.role}</div>
          </NavLink>
          <button onClick={signOut}>Sign out</button>
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
