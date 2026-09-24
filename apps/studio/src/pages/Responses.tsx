import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TopBar } from '../components/Layout';
import { ErrorBox, Loading, useToast } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { exportCsv, exportFileBase, exportXlsx } from '../lib/export';
import { fmtDate, fullName } from '../lib/format';
import { FOLLOW_UP_LABELS, type AssessmentRow, type FollowUpStatus, type ResponseRow, type StatsRow } from '../lib/types';

const PAGE = 50;

interface Filters {
  from: string;
  to: string;
  tier: string;
  status: '' | FollowUpStatus;
  source: string;
  q: string;
  includeTests: boolean;
  mine: boolean;
}

const EMPTY: Filters = { from: '', to: '', tier: '', status: '', source: '', q: '', includeTests: false, mine: false };

export function ResponsesPage() {
  const { id: assessmentId } = useParams<{ id?: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const [assessments, setAssessments] = useState<AssessmentRow[]>([]);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [rows, setRows] = useState<ResponseRow[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
    supabase.from(T.assessments).select('id,title,slug,status,owner_id').order('title').then(({ data }) => setAssessments((data as AssessmentRow[]) ?? []));
  }, []);

  useEffect(() => {
    setPage(0);
    setFilters(EMPTY);
    if (assessmentId) {
      supabase.from(T.stats).select('*').eq('assessment_id', assessmentId).maybeSingle().then(({ data }) => setStats(data as StatsRow | null));
    } else setStats(null);
  }, [assessmentId]);

  const title = (id: string) => assessments.find((a) => a.id === id)?.title ?? 'Unknown assessment';
  const current = assessmentId ? assessments.find((a) => a.id === assessmentId) : undefined;

  const buildQuery = useCallback((select: string, withCount: boolean) => {
    let q = supabase.from(T.responses).select(select, withCount ? { count: 'exact' } : undefined).order('completed_at', { ascending: false });
    if (assessmentId) q = q.eq('assessment_id', assessmentId);
    if (!filters.includeTests) q = q.eq('is_test', false);
    if (filters.from) q = q.gte('completed_at', new Date(filters.from).toISOString());
    if (filters.to) q = q.lte('completed_at', new Date(`${filters.to}T23:59:59`).toISOString());
    if (filters.tier) q = q.eq('tier_label', filters.tier);
    if (filters.status) q = q.eq('follow_up_status', filters.status);
    const src = filters.source.trim().replace(/[,()%*]/g, ' ').trim();
    if (src) q = q.or(`source.ilike.%${src}%,rep_code.ilike.%${src}%,utm_campaign.ilike.%${src}%`);
    if (filters.mine && uid) q = q.eq('owner_id', uid);
    const term = filters.q.trim().replace(/[,()%*]/g, ' ').trim();
    if (term) q = q.or(`email.ilike.%${term}%,organization.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    return q;
  }, [assessmentId, filters, uid]);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error, count } = await buildQuery('*', true).range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return setError(error);
    setRows((data as unknown as ResponseRow[]) ?? []);
    setCount(count ?? 0);
  }, [buildQuery, page]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const tiers = useMemo(() => [...new Set((rows ?? []).map((r) => r.tier_label).filter(Boolean) as string[])], [rows]);

  const fetchAll = async (): Promise<ResponseRow[]> => {
    const all: ResponseRow[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await buildQuery('*', false).range(from, from + 999);
      if (error) throw error;
      all.push(...((data as unknown as ResponseRow[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    return all;
  };

  const doExport = async (kind: 'xlsx' | 'csv' | 'csv-long') => {
    setExporting(true);
    try {
      const all = await fetchAll();
      if (all.length === 0) return toast.error('Nothing to export with these filters.');
      const base = exportFileBase(current?.slug ?? 'all-responses');
      const label = describeFilters(filters);
      if (kind === 'xlsx') exportXlsx(all, title, base, label);
      else exportCsv(all, title, base, kind === 'csv' ? 'wide' : 'long');
      toast.ok(`Exported ${all.length} responses`);
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(false);
    }
  };

  const set = (patch: Partial<Filters>) => { setPage(0); setFilters((f) => ({ ...f, ...patch })); };
  const pages = Math.max(1, Math.ceil(count / PAGE));

  return (
    <>
      <TopBar title={current ? <>Responses: {current.title}</> : 'All responses'}>
        {current && <Link className="btn btn-secondary btn-sm" to={`/assessments/${current.id}`}>Open editor</Link>}
        <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => doExport('csv')}>CSV</button>
        <button className="btn btn-secondary btn-sm" disabled={exporting} onClick={() => doExport('csv-long')}>CSV (one row per answer)</button>
        <button className="btn btn-primary btn-sm" disabled={exporting} onClick={() => doExport('xlsx')}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
      </TopBar>
      <div className="s-page">
        {stats && (
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="stat"><div className="stat-label">Responses</div><div className="stat-value">{stats.responses}</div><div className="stat-sub">{stats.responses_30d} in the last 30 days</div></div>
            <div className="stat"><div className="stat-label">Unique visits</div><div className="stat-value">{stats.views}</div><div className="stat-sub">{stats.starts} started</div></div>
            <div className="stat"><div className="stat-label">Completion rate</div><div className="stat-value">{stats.completion_rate != null ? `${stats.completion_rate}%` : '—'}</div><div className="stat-sub">completed ÷ started</div></div>
            <div className="stat"><div className="stat-label">Average score</div><div className="stat-value">{stats.avg_score != null ? `${Math.round(Number(stats.avg_score))}%` : '—'}</div></div>
          </div>
        )}

        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {!assessmentId && (
              <select className="select input-sm" style={{ width: 220 }} value="" onChange={(e) => e.target.value && nav(`/assessments/${e.target.value}/responses`)}>
                <option value="">All assessments</option>
                {assessments.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            )}
            <input className="input input-sm" style={{ width: 220 }} placeholder="Search name, email, org…" value={filters.q} onChange={(e) => set({ q: e.target.value })} />
            <label className="check small">From <input type="date" className="input input-sm" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></label>
            <label className="check small">To <input type="date" className="input input-sm" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></label>
            <select className="select input-sm" style={{ width: 170 }} value={filters.tier} onChange={(e) => set({ tier: e.target.value })}>
              <option value="">Any tier</option>
              {[...new Set([...tiers, filters.tier].filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="select input-sm" style={{ width: 150 }} value={filters.status} onChange={(e) => set({ status: e.target.value as Filters['status'] })}>
              <option value="">Any follow-up</option>
              {Object.entries(FOLLOW_UP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input input-sm" style={{ width: 170 }} placeholder="Source / rep / campaign" value={filters.source} onChange={(e) => set({ source: e.target.value })} />
            <label className="check small"><input type="checkbox" checked={filters.mine} onChange={(e) => set({ mine: e.target.checked })} />My leads</label>
            <label className="check small"><input type="checkbox" checked={filters.includeTests} onChange={(e) => set({ includeTests: e.target.checked })} />Include tests</label>
            {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button className="btn btn-ghost btn-sm" onClick={() => set(EMPTY)}>Clear</button>}
          </div>
        </div>

        {error ? <ErrorBox error={error} /> : !rows ? <Loading /> : rows.length === 0 ? (
          <div className="card empty"><h3>No responses yet</h3><p>Share your assessment link to start collecting responses.</p></div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Completed</th>
                    {!assessmentId && <th>Assessment</th>}
                    <th>Name</th>
                    <th>Organization</th>
                    <th>Email</th>
                    <th>Score</th>
                    <th>Tier</th>
                    <th>Source</th>
                    <th>Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="clickable" onClick={() => nav(`/responses/${r.id}`)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.completed_at, true)} {r.is_test && <span className="pill pill-test">Test</span>}</td>
                      {!assessmentId && <td>{title(r.assessment_id)}</td>}
                      <td>{fullName(r) || <span className="muted">—</span>}</td>
                      <td>{r.organization || <span className="muted">—</span>}</td>
                      <td>{r.email || <span className="muted">Anonymous</span>}</td>
                      <td><b>{r.score_pct != null ? `${Math.round(Number(r.score_pct))}%` : '—'}</b></td>
                      <td>{r.tier_label ?? '—'}</td>
                      <td className="small">{[r.source, r.rep_code && `rep: ${r.rep_code}`].filter(Boolean).join(' · ') || '—'}</td>
                      <td><span className="pill pill-neutral">{FOLLOW_UP_LABELS[r.follow_up_status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-between" style={{ marginTop: 12 }}>
              <span className="small muted">{count} response{count === 1 ? '' : 's'}</span>
              <div className="btn-row">
                <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className="small muted">Page {page + 1} of {pages}</span>
                <button className="btn btn-secondary btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function describeFilters(f: Filters): string {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`dates ${f.from || '…'} to ${f.to || '…'}`);
  if (f.tier) parts.push(`tier ${f.tier}`);
  if (f.status) parts.push(`follow-up ${FOLLOW_UP_LABELS[f.status]}`);
  if (f.source) parts.push(`source "${f.source}"`);
  if (f.q) parts.push(`search "${f.q}"`);
  if (f.mine) parts.push('my leads');
  parts.push(f.includeTests ? 'including tests' : 'excluding tests');
  return parts.join('; ');
}
