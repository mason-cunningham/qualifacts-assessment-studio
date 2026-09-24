import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopBar } from '../components/Layout';
import { ErrorBox, Loading, Modal, StatusPill, useToast } from '../components/ui';
import { ShareKit } from '../components/ShareKit';
import { supabase, T } from '../lib/supabase';
import { displayName, useAuth } from '../lib/auth';
import { duplicateAssessment } from '../lib/assessments';
import { copyText, fmtRelative, publicUrl } from '../lib/format';
import type { AssessmentRow, AssessmentStatus, Profile, StatsRow } from '../lib/types';

type Filter = 'active' | 'mine' | 'published' | 'draft' | 'archived' | 'all';

export function DashboardPage() {
  const { profile, canEdit, publicBaseUrl } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [stats, setStats] = useState<Map<string, StatsRow>>(new Map());
  const [people, setPeople] = useState<Map<string, Profile>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [share, setShare] = useState<AssessmentRow | null>(null);

  const load = async () => {
    const [a, s, p] = await Promise.all([
      supabase.from(T.assessments).select('id,slug,title,internal_name,description,product_line,status,published_version_id,settings,is_template,closes_at,published_at,owner_id,created_by,updated_by,created_at,updated_at,draft_definition').order('updated_at', { ascending: false }),
      supabase.from(T.stats).select('*'),
      supabase.from(T.profiles).select('id,email,full_name'),
    ]);
    if (a.error) return setError(a.error);
    setRows(a.data as AssessmentRow[]);
    setStats(new Map(((s.data as StatsRow[]) ?? []).map((x) => [x.assessment_id, x])));
    setPeople(new Map(((p.data as Profile[]) ?? []).map((x) => [x.id, x])));
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'active' && r.status === 'archived') return false;
      if (filter === 'mine' && r.owner_id !== profile?.id) return false;
      if (filter === 'published' && r.status !== 'published') return false;
      if (filter === 'draft' && r.status !== 'draft') return false;
      if (filter === 'archived' && r.status !== 'archived') return false;
      if (term && !`${r.title} ${r.slug} ${r.internal_name ?? ''} ${r.product_line ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [rows, filter, q, profile]);

  const totals = useMemo(() => {
    const all = [...stats.values()];
    return {
      live: rows?.filter((r) => r.status === 'published').length ?? 0,
      responses: all.reduce((s, x) => s + Number(x.responses), 0),
      last30: all.reduce((s, x) => s + Number(x.responses_30d), 0),
      views: all.reduce((s, x) => s + Number(x.views), 0),
    };
  }, [stats, rows]);

  const setStatus = async (r: AssessmentRow, status: AssessmentStatus) => {
    const { error } = await supabase.from(T.assessments).update({ status }).eq('id', r.id);
    if (error) return toast.error(error);
    toast.ok(status === 'paused' ? 'Paused: the link now shows a closed message' : status === 'published' ? 'Resumed' : `Moved to ${status}`);
    load();
  };

  const duplicate = async (r: AssessmentRow) => {
    try {
      const copy = await duplicateAssessment(r);
      toast.ok('Duplicated');
      nav(`/assessments/${copy.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <>
      <TopBar title="Dashboard">
        {canEdit && <Link className="btn btn-primary" to="/new">+ New assessment</Link>}
      </TopBar>
      <div className="s-page">
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          <div className="stat"><div className="stat-label">Live assessments</div><div className="stat-value">{totals.live}</div></div>
          <div className="stat"><div className="stat-label">Total responses</div><div className="stat-value">{totals.responses}</div></div>
          <div className="stat"><div className="stat-label">Last 30 days</div><div className="stat-value">{totals.last30}</div></div>
          <div className="stat"><div className="stat-label">Unique visits</div><div className="stat-value">{totals.views}</div></div>
        </div>

        <div className="row-between" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="btn-row">
            {(['active', 'mine', 'published', 'draft', 'archived', 'all'] as Filter[]).map((f) => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>
                {{ active: 'Active', mine: 'Mine', published: 'Live', draft: 'Drafts', archived: 'Archived', all: 'All' }[f]}
              </button>
            ))}
          </div>
          <input className="input" style={{ maxWidth: 280 }} placeholder="Search assessments…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        {error ? <ErrorBox error={error} /> : !rows ? <Loading /> : filtered.length === 0 ? (
          <div className="card empty">
            <h3>{rows.length === 0 ? 'No assessments yet' : 'Nothing matches'}</h3>
            <p>{rows.length === 0 ? 'Start from one of the Qualifacts templates or a blank assessment.' : 'Try a different filter.'}</p>
            {canEdit && rows.length === 0 && <Link className="btn btn-primary" to="/new">Create your first assessment</Link>}
          </div>
        ) : (
          <div className="grid grid-cards">
            {filtered.map((r) => {
              const s = stats.get(r.id);
              const owner = r.owner_id ? people.get(r.owner_id) : undefined;
              const link = publicUrl(publicBaseUrl, r.slug);
              return (
                <div className="a-card" key={r.id}>
                  <div className="row-between">
                    <StatusPill status={r.status} />
                    <span className="small muted">Edited {fmtRelative(r.updated_at)}</span>
                  </div>
                  <div>
                    <h3><Link to={`/assessments/${r.id}`}>{r.title}</Link></h3>
                    <div className="small muted">
                      {r.product_line && <>{r.product_line} · </>}
                      /{r.slug} · Owner: {owner ? displayName(owner) : '—'}
                    </div>
                  </div>
                  <div className="a-card-stats">
                    <div><b>{s?.responses ?? 0}</b>Responses</div>
                    <div><b>{s?.views ?? 0}</b>Visits</div>
                    <div><b>{s?.completion_rate != null ? `${s.completion_rate}%` : '—'}</b>Completion</div>
                    <div><b>{s?.avg_score != null ? `${Math.round(Number(s.avg_score))}%` : '—'}</b>Avg score</div>
                  </div>
                  <div className="small muted">Last response: {fmtRelative(s?.last_response_at)}</div>
                  <div className="a-card-foot">
                    <Link className="btn btn-secondary btn-sm" to={`/assessments/${r.id}`}>{canEdit ? 'Edit' : 'View'}</Link>
                    <Link className="btn btn-secondary btn-sm" to={`/assessments/${r.id}/responses`}>Responses</Link>
                    {r.status === 'published' && (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={async () => (await copyText(link)) && toast.ok('Link copied')}>Copy link</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShare(r)}>Share / QR</button>
                      </>
                    )}
                    {canEdit && (
                      <>
                        <button className="btn btn-ghost btn-sm" onClick={() => duplicate(r)}>Duplicate</button>
                        {r.status === 'published' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r, 'paused')}>Pause</button>}
                        {r.status === 'paused' && r.published_version_id && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r, 'published')}>Resume</button>}
                        {r.status !== 'archived' && r.status !== 'published' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r, 'archived')}>Archive</button>}
                        {r.status === 'archived' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r, r.published_version_id ? 'paused' : 'draft')}>Restore</button>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {share && (
        <Modal title={`Share: ${share.title}`} onClose={() => setShare(null)} wide>
          <ShareKit slug={share.slug} live={share.status === 'published'} />
        </Modal>
      )}
    </>
  );
}
