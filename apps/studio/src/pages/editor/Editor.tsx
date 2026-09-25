import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Answers, AssessmentDefinition } from '@qq/schema';
import { validateDefinition, type ValidationIssue } from '@qq/engine';
import { AssessmentExperience, type Screen } from '@qq/ui';
import { TopBar } from '../../components/Layout';
import { ErrorBox, Loading, Modal, StatusPill, useToast } from '../../components/ui';
import { ShareKit } from '../../components/ShareKit';
import { ShareAccessDialog } from '../../components/ShareAccess';
import { IconShare } from '../../components/icons';
import { ReviewButton } from '../../components/AiHelpers';
import { supabase, T, errorMessage } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { readDefinition } from '../../lib/assessments';
import { accessFor, canEditRow, canManageSharing } from '../../lib/access';
import { resolveForPublish } from '../../lib/products';
import { copyText, publicUrl } from '../../lib/format';
import type { AssessmentRow, ShareRow, VersionRow } from '../../lib/types';
import { sampleAnswers } from './helpers';
import { ContentTab } from './ContentTab';
import { ScoringTab } from './ScoringTab';
import { ResultsTab } from './ResultsTab';
import { SolutionsTab } from './SolutionsTab';
import { LeadTab } from './LeadTab';
import { BrandingTab } from './BrandingTab';
import { SettingsTab } from './SettingsTab';

type Tab = 'content' | 'scoring' | 'results' | 'solutions' | 'lead' | 'branding' | 'settings';
const TABS: [Tab, string][] = [
  ['content', 'Content'],
  ['scoring', 'Scoring'],
  ['results', 'Results page'],
  ['solutions', 'Solutions'],
  ['lead', 'Lead form'],
  ['branding', 'Branding'],
  ['settings', 'Settings & share'],
];

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, publicBaseUrl } = useAuth();
  const toast = useToast();
  const [row, setRow] = useState<AssessmentRow | null>(null);
  const [myShares, setMyShares] = useState<ShareRow[]>([]);
  const [sharing, setSharing] = useState(false);
  const [def, setDef] = useState<AssessmentDefinition | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('content');
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [jump, setJump] = useState<{ screen: Screen; nonce: number; answers?: Answers; questionId?: string }>();
  const [publishing, setPublishing] = useState(false);
  /** JSON of the live version (minus product snapshots) to detect unpublished edits */
  const [liveJson, setLiveJson] = useState<string | null>(null);

  const rowRef = useRef<AssessmentRow | null>(null);
  const defRef = useRef<AssessmentDefinition | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  rowRef.current = row;
  defRef.current = def;

  // Per-assessment permission (owner / team / shared), not just the global role
  const canEdit = row ? canEditRow(accessFor(row, profile, myShares), profile) : false;
  const readOnly = !canEdit || saveState === 'conflict';

  // ── Load ──
  useEffect(() => {
    let cancelled = false;
    if (profile) {
      supabase.from(T.shares).select('*').eq('assessment_id', id!).eq('user_id', profile.id)
        .then(({ data }) => !cancelled && setMyShares((data as ShareRow[]) ?? []));
    }
    supabase.from(T.assessments).select('*').eq('id', id!).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) return setLoadError(error);
      if (!data) return setLoadError(new Error("This assessment doesn't exist or hasn't been shared with you. Ask its owner to share it."));
      const r = data as AssessmentRow;
      const d = readDefinition(r.draft_definition);
      if (!d) return setLoadError(new Error('This assessment’s content could not be read.'));
      setRow(r);
      setDef(d);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, profile?.id]);

  const publishedVersionId = row?.published_version_id;
  useEffect(() => {
    if (!publishedVersionId) return setLiveJson(null);
    supabase.from(T.versions).select('definition').eq('id', publishedVersionId).single().then(({ data }) => {
      const d = data ? readDefinition((data as { definition: unknown }).definition) : null;
      setLiveJson(d ? comparable(d) : null);
    });
  }, [publishedVersionId]);

  // ── Save (serialized, optimistic concurrency on updated_at) ──
  const persist = useCallback((patch: Partial<AssessmentRow>) => {
    const run = async (): Promise<boolean> => {
      const current = rowRef.current;
      if (!current) return false;
      const { data, error } = await supabase
        .from(T.assessments)
        .update(patch)
        .eq('id', current.id)
        .eq('updated_at', current.updated_at)
        .select('*');
      if (error) throw error;
      if (!data || data.length === 0) {
        setSaveState('conflict');
        return false;
      }
      const next = data[0] as AssessmentRow;
      rowRef.current = next;
      setRow(next);
      return true;
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const saveDraft = useCallback(async () => {
    const d = defRef.current;
    if (!d) return;
    setSaveState('saving');
    try {
      const ok = await persist({
        draft_definition: d,
        title: d.meta.title.trim() || 'Untitled assessment',
        description: d.meta.description ?? null,
        product_line: d.meta.productLine ?? null,
      });
      if (ok) setSaveState((s) => (s === 'saving' ? 'saved' : s));
    } catch (e) {
      console.error(e);
      setSaveState('error');
    }
  }, [persist]);

  const update = useCallback((fn: (d: AssessmentDefinition) => void) => {
    setDef((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
    setSaveState((s) => (s === 'conflict' ? s : 'dirty'));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => saveDraft(), 1200);
  }, [saveDraft]);

  const saveRow = useCallback(async (patch: Partial<AssessmentRow>) => {
    try {
      const ok = await persist(patch);
      if (!ok) toast.error('Someone else changed this assessment. Reload to see their changes.');
      return ok;
    } catch (e) {
      toast.error(e);
      return false;
    }
  }, [persist, toast]);

  // Flush pending edits when leaving the page
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === 'dirty' || saveState === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      saveDraft();
    }
  }, [saveDraft]);

  // Preview follows the question being edited
  useEffect(() => {
    if (openQuestion) setJump({ screen: 'questions', nonce: Date.now(), questionId: openQuestion });
  }, [openQuestion]);

  const issues = useMemo(() => (def ? validateDefinition(def) : []), [def]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

  if (loadError) return (<><TopBar title="Editor" /><div className="s-page"><ErrorBox error={loadError} /></div></>);
  if (!row || !def) return (<><TopBar title="Editor" /><Loading /></>);

  const hasUnpublishedChanges = !!row.published_version_id && liveJson !== null && liveJson !== comparable(def);
  const link = publicUrl(publicBaseUrl, row.slug);

  const setStatus = async (status: AssessmentRow['status']) => {
    if (await saveRow({ status })) toast.ok(status === 'paused' ? 'Paused: the link now shows your closed message' : 'Live again');
  };

  return (
    <>
      <TopBar title={<span className="row" style={{ gap: 10 }}><Link to="/" className="muted" style={{ textDecoration: 'none', fontWeight: 600 }}>Dashboard /</Link> {def.meta.title || 'Untitled'} <StatusPill status={row.status} /></span>}>
        <span className={`save-state ${saveState === 'error' || saveState === 'conflict' ? 'err' : ''}`}>
          {!canEdit ? 'View only' : { saved: 'All changes saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Save failed. Retrying on next change', conflict: 'Edited elsewhere. Reload to continue' }[saveState]}
        </span>
        {saveState === 'conflict' && <button className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}>Reload</button>}
        {row.status === 'published' && <button className="btn btn-secondary btn-sm" onClick={async () => (await copyText(link)) && toast.ok('Link copied')}>Copy link</button>}
        {canManageSharing(row, profile) && <button className="btn btn-secondary btn-sm" onClick={() => setSharing(true)}><IconShare />Share</button>}
        {canEdit && <ReviewButton def={def} onJumpToQuestion={(qid) => { setTab('content'); setOpenQuestion(qid); }} />}
        <Link className="btn btn-secondary btn-sm" to={`/assessments/${row.id}/responses`}>Responses</Link>
        {canEdit && row.status === 'published' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus('paused')}>Pause</button>}
        {canEdit && row.status === 'paused' && row.published_version_id && <button className="btn btn-ghost btn-sm" onClick={() => setStatus('published')}>Resume</button>}
        {canEdit && (
          <button className="btn btn-magenta" onClick={() => setPublishing(true)} disabled={saveState === 'conflict'}>
            {row.status === 'published' ? (hasUnpublishedChanges ? 'Publish changes' : 'Republish') : 'Publish'}
          </button>
        )}
      </TopBar>

      <div className={`ed ${showPreview ? '' : 'no-preview'}`}>
        <div className="ed-left">
          <div className="tabs" role="tablist">
            {TABS.map(([k, label]) => {
              const n = issues.filter((i) => i.level === 'error' && i.target?.tab === k).length;
              return (
                <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
                  {label}{n > 0 && <span className="count">{n}</span>}
                </button>
              );
            })}
            <span style={{ flex: 1 }} />
            <button className="tab" onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'Hide preview' : 'Show preview'}</button>
          </div>
          <div className="ed-body">
            {hasUnpublishedChanges && (
              <div className="card small callout-warn" style={{ marginBottom: 16 }}>
                You have changes that aren't live yet. Prospects see the last published version until you click <b>Publish changes</b>.
              </div>
            )}
            {tab === 'content' && <ContentTab def={def} update={update} readOnly={readOnly} openId={openQuestion} setOpenId={setOpenQuestion} />}
            {tab === 'scoring' && <ScoringTab def={def} update={update} readOnly={readOnly} />}
            {tab === 'results' && <ResultsTab def={def} update={update} readOnly={readOnly} />}
            {tab === 'solutions' && <SolutionsTab def={def} update={update} readOnly={readOnly} />}
            {tab === 'lead' && <LeadTab def={def} update={update} readOnly={readOnly} />}
            {tab === 'branding' && <BrandingTab def={def} update={update} readOnly={readOnly} />}
            {tab === 'settings' && (
              <SettingsTab
                def={def}
                update={update}
                readOnly={readOnly}
                row={row}
                saveRow={saveRow}
                onRestore={(v) => {
                  const d = readDefinition(v.definition);
                  if (!d) return toast.error('That version could not be read.');
                  update((cur) => { Object.assign(cur, d); });
                  toast.ok(`Draft replaced with v${v.version_number}`);
                }}
              />
            )}
          </div>
        </div>

        {showPreview && (
          <div className="ed-preview">
            <div className="ed-preview-bar">
              <b className="small" style={{ color: 'var(--navy)', marginRight: 6 }}>Live preview</b>
              <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'intro', nonce: Date.now(), answers: {} })}>Intro</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'questions', nonce: Date.now() })}>Questions</button>
              {def.leadCapture.position === 'beforeResults' && (
                <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'lead', nonce: Date.now() })}>Lead form</button>
              )}
              <span className="small muted">Results:</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'results', nonce: Date.now(), answers: sampleAnswers(def, 'best') })}>Best</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'results', nonce: Date.now(), answers: sampleAnswers(def, 'random') })}>Random</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setJump({ screen: 'results', nonce: Date.now(), answers: sampleAnswers(def, 'worst') })}>Worst</button>
              <span style={{ flex: 1 }} />
              <button className={`btn btn-sm ${mobile ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => setMobile(false)}>Desktop</button>
              <button className={`btn btn-sm ${mobile ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => setMobile(true)}>Mobile</button>
            </div>
            <div className="ed-preview-scroll" data-qq-scroll>
              <div className={`ed-preview-frame ${mobile ? 'mobile' : ''}`}>
                <AssessmentExperience definition={def} mode="preview" narrow jumpTo={jump} />
              </div>
            </div>
          </div>
        )}
      </div>

      {sharing && (
        <ShareAccessDialog
          row={row}
          onClose={() => setSharing(false)}
          onTeamChanged={(team) => setRow((r) => (r ? { ...r, team } : r))}
        />
      )}

      {publishing && (
        <PublishDialog
          row={row}
          def={def}
          issues={issues}
          errorCount={errorCount}
          onClose={() => setPublishing(false)}
          onJump={(i) => { setPublishing(false); if (i.target) setTab(i.target.tab); if (i.target?.id && i.target.tab === 'content') setOpenQuestion(i.target.id); }}
          onPublished={(r) => setRow(r)}
          flush={async () => {
            clearTimeout(timer.current);
            timer.current = undefined;
            await saveDraft();
          }}
        />
      )}
    </>
  );
}

/** Stable JSON for "has the draft changed since publish?" (product snapshots are refreshed on publish, so ignore them). */
function comparable(d: AssessmentDefinition): string {
  const { products: _products, ...rest } = d;
  return JSON.stringify(rest, (_k, v) => (Array.isArray(v) ? v.filter((x) => x !== '') : v));
}

function PublishDialog({ row, def, issues, errorCount, onClose, onJump, onPublished, flush }: {
  row: AssessmentRow;
  def: AssessmentDefinition;
  issues: ValidationIssue[];
  errorCount: number;
  onClose: () => void;
  onJump: (i: ValidationIssue) => void;
  onPublished: (r: AssessmentRow) => void;
  flush: () => Promise<void>;
}) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const publish = async () => {
    setBusy(true);
    try {
      await flush();
      const resolved = await resolveForPublish(def);
      const { error } = await supabase.rpc('q_quiz_publish', { p_assessment_id: row.id, p_definition: resolved, p_change_note: note.trim() || null });
      if (error) throw error;
      const { data } = await supabase.from(T.assessments).select('*').eq('id', row.id).single();
      if (data) onPublished(data as AssessmentRow);
      setDone(true);
      toast.ok('Published! Your assessment is live.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title="🎉 You're live" onClose={onClose} wide footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <ShareKit slug={row.slug} live />
      </Modal>
    );
  }

  return (
    <Modal
      title={row.published_version_id ? 'Publish changes' : 'Publish assessment'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-magenta" disabled={busy || errorCount > 0} onClick={publish}>
            {busy ? 'Publishing…' : errorCount > 0 ? `Fix ${errorCount} issue${errorCount > 1 ? 's' : ''} first` : 'Publish now'}
          </button>
        </>
      }
    >
      {issues.length === 0 ? (
        <p style={{ marginTop: 0 }}>✅ Everything checks out.</p>
      ) : (
        <>
          <p style={{ marginTop: 0 }} className="small muted">Pre-publish checklist. Errors must be fixed; warnings are optional.</p>
          <ul className="checklist" style={{ marginBottom: 16 }}>
            {issues.map((i, n) => (
              <li key={n} className={i.level}>
                <span>{i.level === 'error' ? '⛔' : '⚠️'}</span>
                <span>{i.message}</span>
                {i.target && <button className="btn btn-ghost btn-sm" onClick={() => onJump(i)}>Fix</button>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="field">
        <label>What changed? (optional)</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Updated tier copy for ACC" />
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Publishing makes this version live at its link right away. Existing responses keep the version they were scored with.
      </p>
    </Modal>
  );
}
