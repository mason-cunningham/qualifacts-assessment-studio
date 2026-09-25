import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { qualifactsLogo } from '@qq/ui';
import { supabase, errorMessage } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { TeamSelect } from '../components/ui';
import type { Team } from '../lib/types';

const DOMAIN = '@qualifacts.com';

export function LoginPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [team, setTeam] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && session) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const addr = email.trim().toLowerCase();
    if (!addr.endsWith(DOMAIN)) return setError(`Use your ${DOMAIN} email address.`);
    if (mode === 'signup' && password.length < 10) return setError('Passwords must be at least 10 characters.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: addr, password });
        if (error) throw error;
      } else {
        if (!fullName.trim()) throw new Error('Enter your name.');
        if (!team) throw new Error('Select your team.');
        const { data, error } = await supabase.auth.signUp({
          email: addr,
          password,
          options: { data: { full_name: fullName.trim(), team }, emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
        });
        if (error) throw error;
        if (!data.session) {
          setNotice('Check your inbox to confirm your email, then sign in.');
          setMode('signin');
        }
      }
    } catch (err) {
      const msg = errorMessage(err);
      setError(/invalid login/i.test(msg) ? 'Email or password is incorrect.' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <img className="logo" src={qualifactsLogo} alt="Qualifacts" />
        <h1>{mode === 'signin' ? 'Sign in to Assessment Studio' : 'Create your account'}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {mode === 'signin' ? 'Build, publish, and track customer assessments.' : 'For Qualifacts team members. An admin will approve your access.'}
        </p>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        )}
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="team">Team</label>
            <TeamSelect id="team" value={team} onChange={setTeam} />
            <span className="hint">Everyone on your team can see and edit the assessments you create.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" placeholder={`you${DOMAIN}`} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'signup' && <span className="hint">At least 10 characters.</span>}
        </div>
        {error && <p className="error-text">{error}</p>}
        {notice && <p className="small" style={{ color: 'var(--teal-dk)' }}>{notice}</p>}
        <button className="btn btn-primary" style={{ width: '100%', padding: 11 }} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <p className="small muted" style={{ textAlign: 'center', marginTop: 16 }}>
          {mode === 'signin' ? (
            <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setError(null); }}>Create an account</a></>
          ) : (
            <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); setError(null); }}>Sign in</a></>
          )}
        </p>
        {mode === 'signin' && (
          <p className="small muted" style={{ textAlign: 'center' }}>Forgot your password? Ask a Studio admin to reset it.</p>
        )}
      </form>
    </div>
  );
}
