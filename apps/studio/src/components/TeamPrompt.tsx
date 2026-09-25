import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase, T } from '../lib/supabase';
import type { Team } from '../lib/types';
import { TeamSelect, useToast } from './ui';

/** Team select + Save for the signed-in user's own profile. */
export function TeamPicker({ onSaved }: { onSaved?: () => void }) {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [team, setTeam] = useState<Team | null>(profile?.team ?? null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!profile || !team) return;
    setBusy(true);
    const { error } = await supabase.from(T.profiles).update({ team }).eq('id', profile.id);
    setBusy(false);
    if (error) return toast.error(error);
    await refreshProfile();
    toast.ok('Team saved');
    onSaved?.();
  };

  return (
    <div className="row" style={{ alignItems: 'stretch' }}>
      <TeamSelect value={team} onChange={setTeam} />
      <button className="btn btn-primary" disabled={busy || !team} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}

/** Blocks Studio until an approved user without a team picks one. */
export function TeamGate() {
  const { profile } = useAuth();
  if (!profile?.is_active || profile.team) return null;
  return (
    <div className="modal-bg">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="team-gate-title">
        <div className="modal-head"><h2 id="team-gate-title">Which team are you on?</h2></div>
        <div className="modal-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Assessments are now shared with your team. Everyone on your team can see and edit what you create,
            and you'll see theirs. Your existing assessments will be added to the team you pick.
          </p>
          <TeamPicker />
        </div>
      </div>
    </div>
  );
}
