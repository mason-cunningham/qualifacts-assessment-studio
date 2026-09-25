import { useEffect, useState } from 'react';
import { TopBar } from '../components/Layout';
import { Field, TeamSelect, TextInput, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase, T } from '../lib/supabase';
import type { Team } from '../lib/types';

export function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [title, setTitle] = useState(profile?.title ?? '');
  const [team, setTeam] = useState<Team | null>(profile?.team ?? null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.full_name ?? '');
    setTitle(profile?.title ?? '');
    setTeam(profile?.team ?? null);
  }, [profile]);

  const saveProfile = async () => {
    if (!profile) return;
    if (!team) return toast.error('Select your team.');
    setBusy(true);
    const { error } = await supabase.from(T.profiles).update({ full_name: name.trim() || null, title: title.trim() || null, team }).eq('id', profile.id);
    setBusy(false);
    if (error) return toast.error(error);
    await refreshProfile();
    toast.ok('Profile saved');
  };

  const changePassword = async () => {
    if (pw.length < 10) return toast.error('Passwords must be at least 10 characters.');
    if (pw !== pw2) return toast.error("Passwords don't match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error);
    setPw('');
    setPw2('');
    toast.ok('Password updated');
  };

  return (
    <>
      <TopBar title="Your profile" />
      <div className="s-page s-page-narrow">
        <div className="card">
          <div className="card-title">Details</div>
          <div className="card-sub">{profile?.email} · <span style={{ textTransform: 'capitalize' }}>{profile?.role}</span></div>
          <div className="grid grid-2">
            <Field label="Full name"><TextInput value={name} onChange={setName} /></Field>
            <Field label="Title"><TextInput value={title} onChange={setTitle} placeholder="e.g. Product Marketing Manager" /></Field>
            <Field label="Team" hint="New assessments you create are shared with this team. Changing teams doesn't move assessments you already made.">
              <TeamSelect value={team} onChange={setTeam} />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={saveProfile}>Save</button>
        </div>
        <div className="card">
          <div className="card-title">Change password</div>
          <div className="card-sub">If an admin gave you a temporary password, set your own here.</div>
          <div className="grid grid-2">
            <Field label="New password"><TextInput type="password" autoComplete="new-password" value={pw} onChange={setPw} /></Field>
            <Field label="Confirm new password"><TextInput type="password" autoComplete="new-password" value={pw2} onChange={setPw2} /></Field>
          </div>
          <button className="btn btn-primary" disabled={busy || !pw} onClick={changePassword}>Update password</button>
        </div>
      </div>
    </>
  );
}
