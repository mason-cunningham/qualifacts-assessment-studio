import { useState } from 'react';
import { qualifactsLogo } from '@qq/ui';
import { useAuth } from '../lib/auth';
import { TeamPicker } from '../components/TeamPrompt';

export function PendingPage() {
  const { profile, refreshProfile, signOut } = useAuth();
  const [checking, setChecking] = useState(false);
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img className="logo" src={qualifactsLogo} alt="Qualifacts" />
        <h1>Awaiting approval</h1>
        <p className="muted">
          Thanks{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}! Your account ({profile?.email}) was created.
          A Studio admin needs to approve it before you can build assessments.
        </p>
        {!profile?.team && (
          <div className="field">
            <label>While you wait, pick your team</label>
            <TeamPicker />
          </div>
        )}
        <div className="btn-row">
          <button className="btn btn-primary" disabled={checking} onClick={async () => { setChecking(true); await refreshProfile(); setChecking(false); }}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

export function NoAccessPage() {
  const { session, signOut } = useAuth();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img className="logo" src={qualifactsLogo} alt="Qualifacts" />
        <h1>No access</h1>
        <p className="muted">
          {session?.user.email} isn't a Qualifacts Studio account. Sign up with your @qualifacts.com email address.
        </p>
        <button className="btn btn-secondary" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
