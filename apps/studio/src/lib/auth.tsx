import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, T } from './supabase';
import type { Profile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Public runner base URL (q-quiz-config overrides the env var) */
  publicBaseUrl: string;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  canEdit: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const ENV_BASE = ((import.meta.env.VITE_PUBLIC_BASE_URL as string) || 'https://qualifacts-assess.netlify.app').replace(/\/+$/, '');

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState(ENV_BASE);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from(T.profiles).select('*').eq('id', s.user.id).maybeSingle();
    setProfile((data as Profile | null) ?? null);
    if (data && (data as Profile).is_active) {
      const { data: cfg } = await supabase.from(T.config).select('value').eq('key', 'public_base_url').maybeSingle();
      const v = cfg?.value;
      if (typeof v === 'string' && /^https?:\/\//.test(v)) setPublicBaseUrl(v.replace(/\/+$/, ''));
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN') {
        // Hold the "loading" state until the profile arrives, so route guards don't
        // briefly show "No access" between sign-in and the profile fetch.
        setLoading(true);
        // Defer to avoid deadlocking the auth client inside its own callback
        setTimeout(async () => {
          await loadProfile(s);
          if (mounted) setLoading(false);
        }, 0);
      } else if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => loadProfile(s), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const value: AuthState = {
    loading,
    session,
    profile,
    publicBaseUrl,
    refreshProfile: () => loadProfile(session),
    signOut: async () => {
      await supabase.auth.signOut();
      setProfile(null);
    },
    canEdit: !!profile?.is_active && (profile.role === 'admin' || profile.role === 'editor'),
    isAdmin: !!profile?.is_active && profile.role === 'admin',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export function displayName(p: Pick<Profile, 'full_name' | 'email'> | null | undefined): string {
  if (!p) return 'Unknown';
  return p.full_name?.trim() || p.email;
}
