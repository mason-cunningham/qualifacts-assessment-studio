import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isChoiceType, type Answers, type AssessmentDefinition, type LeadValues } from '@qq/schema';
import { computeResults } from '@qq/engine';
import { ResultsView } from '@qq/ui';
import { TopBar } from '../components/Layout';
import { ErrorBox, Field, Loading, useToast } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { displayName, useAuth } from '../lib/auth';
import { readDefinition } from '../lib/assessments';
import { accessFor, canEditRow } from '../lib/access';
import { fmtDate, fullName } from '../lib/format';
import { FOLLOW_UP_LABELS, type AssessmentRow, type FollowUpStatus, type Profile, type ResponseRow, type ShareRow } from '../lib/types';

/** Rebuild the engine's Answers from stored answer records so results render exactly as the respondent saw them. */
function answersFromRecords(def: AssessmentDefinition, r: ResponseRow): Answers {
  const out: Answers = {};
  for (const a of r.answers ?? []) {
    if (a.skipped) continue;
    const q = def.questions.find((x) => x.id === a.question_id);
    if (!q) continue;
    if (isChoiceType(q.type)) {
      const ids = Array.isArray(a.value) ? (a.value as string[]) : a.value != null ? [String(a.value)] : [];
      out[q.id] = { optionIds: ids, otherText: a.other_text ?? undefined };
    } else if (q.type === 'rating' || q.type === 'number') out[q.id] = { value: Number(a.value) };
    else out[q.id] = { text: String(a.value ?? '') };
  }
  return out;
}

export function ResponseDetailPage() {
  const { responseId } = useParams<{ responseId: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const { profile, isAdmin } = useAuth();
  const [r, setR] = useState<ResponseRow | null>(null);
  const [assessment, setAssessment] = useState<AssessmentRow | null>(null);
  const [myShares, setMyShares] = useState<ShareRow[]>([]);
  // Follow-up edits need edit access to the assessment; view access can read and export
  const canEdit = assessment ? canEditRow(accessFor(assessment, profile, myShares), profile) : false;
  const [def, setDef] = useState<AssessmentDefinition | null>(null);
  const [versionLabel, setVersionLabel] = useState('');
  const [people, setPeople] = useState<Profile[]>([]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from(T.responses).select('*').eq('id', responseId!).maybeSingle();
      if (error) return setError(error);
      if (!data) return setError(new Error("This response doesn't exist or you don't have access to its assessment."));
      const resp = data as ResponseRow;
      setR(resp);
      setNotes(resp.internal_notes ?? '');
      const [{ data: a }, { data: v }, { data: p }, { data: sh }] = await Promise.all([
        supabase.from(T.assessments).select('*').eq('id', resp.assessment_id).single(),
        resp.version_id ? supabase.from(T.versions).select('definition,version_number').eq('id', resp.version_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from(T.profiles).select('id,email,full_name,is_active').eq('is_active', true),
        supabase.from(T.shares).select('*').eq('assessment_id', resp.assessment_id),
      ]);
      setAssessment(a as AssessmentRow);
      setMyShares((sh as ShareRow[]) ?? []);
      setPeople((p as Profile[]) ?? []);
      const vd = v as { definition: unknown; version_number: number } | null;
      if (vd) {
        setDef(readDefinition(vd.definition));
        setVersionLabel(`v${vd.version_number}`);
      } else if (a) {
        setDef(readDefinition((a as AssessmentRow).draft_definition));
        setVersionLabel('draft (preview submission)');
      }
    })();
  }, [responseId]);

  const results = useMemo(() => (def && r ? computeResults(def, answersFromRecords(def, r)) : null), [def, r]);
  const lead: LeadValues = useMemo(() => {
    if (!r) return {};
    const base: LeadValues = {};
    for (const k of ['first_name', 'last_name', 'email', 'organization', 'job_title', 'phone', 'state'] as const) if (r[k]) base[k] = r[k] as string;
    return { ...base, ...(r.lead_fields ?? {}) };
  }, [r]);

  const patch = async (p: Partial<ResponseRow>, msg = 'Saved') => {
    if (!r) return;
    const { error } = await supabase.from(T.responses).update(p).eq('id', r.id);
    if (error) return toast.error(error);
    setR({ ...r, ...p });
    toast.ok(msg);
  };

  const remove = async () => {
    if (!r || !window.confirm('Permanently delete this response? This cannot be undone.')) return;
    const { error } = await supabase.from(T.responses).delete().eq('id', r.id);
    if (error) return toast.error(error);
    toast.ok('Response deleted');
    nav(-1);
  };

  if (error) return (<><TopBar title="Response" /><div className="s-page"><ErrorBox error={error} /></div></>);
  if (!r) return (<><TopBar title="Response" /><Loading /></>);

  const duration = r.started_at ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 1000) : null;

  return (
    <>
      <TopBar title={<>{fullName(r) || r.email || 'Anonymous response'} {r.is_test && <span className="pill pill-test">Test</span>}</>}>
        {assessment && <Link className="btn btn-secondary btn-sm" to={`/assessments/${assessment.id}/responses`}>All responses for {assessment.title}</Link>}
      </TopBar>
      <div className="s-page" style={{ maxWidth: 1400 }}>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
          <div>
            <div className="card-sub">What they saw ({versionLabel || 'version unknown'}). Rendered from their saved answers.</div>
            <div style={{ border: '1px solid var(--s-line)', borderRadius: 'var(--s-r-lg)', overflow: 'hidden' }}>
              {def && results ? (
                <div className="qq-root qq-narrow" data-accent={def.theme.accent}>
                  <main className="qq-main"><ResultsView definition={def} results={results} lead={lead} hideActions /></main>
                </div>
              ) : <Loading label="Rendering results…" />}
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-title">Answers</div>
              <table className="table">
                <thead><tr><th>Section</th><th>Question</th><th>Answer</th><th>Points</th></tr></thead>
                <tbody>
                  {(r.answers ?? []).map((a) => (
                    <tr key={a.question_id} style={{ opacity: a.skipped ? 0.5 : 1 }}>
                      <td className="small muted">{a.section_name}</td>
                      <td>{a.question_text}</td>
                      <td>{a.skipped ? <i className="muted">Skipped</i> : a.answer_label}{a.is_gap && <span className="pill pill-test" style={{ marginLeft: 6 }}>Gap</span>}</td>
                      <td className="small">{a.points != null ? `${a.points}/${a.max_points}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stack" style={{ position: 'sticky', top: 76 }}>
            <div className="card">
              <div className="card-title">Contact</div>
              <dl className="small" style={{ margin: 0, display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 10px' }}>
                <dt className="muted">Name</dt><dd style={{ margin: 0 }}>{fullName(r) || '—'}</dd>
                <dt className="muted">Email</dt><dd style={{ margin: 0 }}>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—'}</dd>
                <dt className="muted">Organization</dt><dd style={{ margin: 0 }}>{r.organization || '—'}</dd>
                <dt className="muted">Title</dt><dd style={{ margin: 0 }}>{r.job_title || '—'}</dd>
                {r.phone && (<><dt className="muted">Phone</dt><dd style={{ margin: 0 }}>{r.phone}</dd></>)}
                {r.state && (<><dt className="muted">State</dt><dd style={{ margin: 0 }}>{r.state}</dd></>)}
                {Object.entries(r.lead_fields ?? {}).map(([k, v]) => (
                  <Fragment key={k}><dt className="muted">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></Fragment>
                ))}
                <dt className="muted">Consent</dt><dd style={{ margin: 0 }}>{r.consent === null ? 'n/a' : r.consent ? 'Yes' : 'No'}</dd>
              </dl>
            </div>

            <div className="card">
              <div className="card-title">Score</div>
              <div className="stat-value">{r.score_pct != null ? `${Math.round(Number(r.score_pct))}%` : '—'}</div>
              <div className="small muted">{r.tier_label ?? 'Unscored'}{r.score_max ? ` · ${r.score_points}/${r.score_max} points` : ''}</div>
              {r.recommendations?.length > 0 && (
                <div className="small" style={{ marginTop: 8 }}><b>Recommended:</b> {r.recommendations.map((x) => x.name).join(', ')}</div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Follow-up</div>
              <Field label="Status">
                <select className="select" disabled={!canEdit} value={r.follow_up_status} onChange={(e) => patch({ follow_up_status: e.target.value as FollowUpStatus })}>
                  {Object.entries(FOLLOW_UP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Assigned to">
                <select className="select" disabled={!canEdit} value={r.assigned_to ?? ''} onChange={(e) => patch({ assigned_to: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Internal notes">
                <textarea className="textarea" rows={4} disabled={!canEdit} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              {canEdit && notes !== (r.internal_notes ?? '') && <button className="btn btn-primary btn-sm" onClick={() => patch({ internal_notes: notes || null }, 'Notes saved')}>Save notes</button>}
            </div>

            <div className="card small">
              <div className="card-title">Details</div>
              <div>Completed {fmtDate(r.completed_at, true)}{duration !== null && duration > 0 ? ` · took ${Math.floor(duration / 60)}m ${duration % 60}s` : ''}</div>
              <div>Source: {r.source || '—'} · Rep: {r.rep_code || '—'}</div>
              {(r.utm_source || r.utm_medium || r.utm_campaign) && <div>UTM: {[r.utm_source, r.utm_medium, r.utm_campaign].filter(Boolean).join(' / ')}</div>}
              {r.referrer && <div className="muted" style={{ wordBreak: 'break-all' }}>Referrer: {r.referrer}</div>}
              <div className="muted">Salesforce: {r.crm_sync_status.replace('_', ' ')}</div>
              {canEdit && (
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => patch({ is_test: !r.is_test }, r.is_test ? 'Marked as real response' : 'Marked as test')}>
                    {r.is_test ? 'Not a test' : 'Mark as test'}
                  </button>
                  {isAdmin && <button className="btn btn-danger btn-sm" onClick={remove}>Delete</button>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
