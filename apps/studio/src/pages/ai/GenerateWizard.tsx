import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { draftToDefinition, MODEL, type AiDraft, type DraftConversion, type GenerateBrief } from '@qq/ai';
import { orderedQuestions } from '@qq/engine';
import { AssessmentExperience, type Screen } from '@qq/ui';
import type { Answers } from '@qq/schema';
import { TopBar } from '../../components/Layout';
import { Field, Loading, useToast } from '../../components/ui';
import { supabase, T } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { runAi } from '../../lib/ai';
import { ACCEPTED_CONTEXT_FILES, estimateTokens, prepareFile, splitPrepared, type PreparedFile } from '../../lib/files';
import { createAssessment, uniqueSlug } from '../../lib/assessments';
import { productFromRow } from '../../lib/products';
import { KNOWLEDGE_KIND_LABELS, PRODUCT_LINES, type KnowledgeRow, type ProductRow } from '../../lib/types';
import { sampleAnswers } from '../editor/helpers';

type Step = 'brief' | 'context' | 'generating' | 'review';

const DEFAULT_BRIEF: GenerateBrief = {
  title: '',
  audience: 'prospect',
  productLine: '',
  functionArea: '',
  goal: '',
  questionCount: 12,
  scoringStyle: 'auto',
  leadPosition: 'beforeResults',
  tone: 'Warm, practical, and direct',
  primaryCtaLabel: '',
  primaryCtaUrl: '',
};

const CONTEXT_WARN_TOKENS = 120_000;

export function GenerateWizardPage() {
  const [params] = useSearchParams();
  const importMode = params.get('mode') === 'import';
  const nav = useNavigate();
  const toast = useToast();
  const { canEdit } = useAuth();

  const [step, setStep] = useState<Step>(importMode ? 'context' : 'brief');
  const [brief, setBrief] = useState<GenerateBrief>(DEFAULT_BRIEF);
  const [knowledge, setKnowledge] = useState<KnowledgeRow[] | null>(null);
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [kSel, setKSel] = useState<Set<string>>(new Set());
  const [pSel, setPSel] = useState<Set<string>>(new Set());
  const [kFilter, setKFilter] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [saveFilesToLibrary, setSaveFilesToLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [phase, setPhase] = useState('');
  const [chars, setChars] = useState(0);
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(Date.now());
  const abortRef = useRef<AbortController | null>(null);

  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [conversion, setConversion] = useState<DraftConversion | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [revision, setRevision] = useState('');
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<{ screen: Screen; nonce: number; answers?: Answers } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from(T.knowledge).select('*').eq('is_active', true).order('topic').order('title').then(({ data }) => setKnowledge((data as KnowledgeRow[]) ?? []));
    supabase.from(T.products).select('*').eq('is_active', true).order('product_line').order('name').then(({ data }) => setProducts((data as ProductRow[]) ?? []));
  }, []);

  useEffect(() => {
    if (step !== 'generating') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);

  const setB = (patch: Partial<GenerateBrief>) => setBrief((b) => ({ ...b, ...patch }));

  const filteredKnowledge = useMemo(() => {
    const t = kFilter.trim().toLowerCase();
    const list = knowledge ?? [];
    const relevant = (k: KnowledgeRow) =>
      (!!brief.productLine && k.product_line === brief.productLine) ||
      (!!brief.functionArea && !!k.topic && k.topic.toLowerCase().includes(brief.functionArea.toLowerCase()));
    return list
      .filter((k) => !t || `${k.title} ${k.topic ?? ''} ${k.product_line ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => Number(relevant(b)) - Number(relevant(a)));
  }, [knowledge, kFilter, brief.productLine, brief.functionArea]);

  const contextTokens = useMemo(() => {
    const kChars = (knowledge ?? []).filter((k) => kSel.has(k.id)).reduce((s, k) => s + k.char_count, 0);
    const fChars = files.reduce((s, f) => s + (f.kind === 'text' ? f.size : 0), 0);
    const pdfBytes = files.reduce((s, f) => s + (f.kind === 'stored' ? f.size : 0), 0);
    return estimateTokens(kChars + fChars + notes.length + pSel.size * 400, pdfBytes);
  }, [knowledge, kSel, files, notes, pSel]);

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        if (files.length >= 5) { toast.error('Attach at most 5 files.'); break; }
        const p = await prepareFile(f);
        setFiles((cur) => [...cur, p]);
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  const generate = async (revisionNotes?: string) => {
    if (!brief.title.trim() && !importMode) return toast.error('Give the assessment a title or topic.');
    if (importMode && files.length === 0) return toast.error('Upload the questionnaire to import.');
    const ctl = new AbortController();
    abortRef.current = ctl;
    setStep('generating');
    setPhase('Starting');
    setChars(0);
    setStarted(Date.now());
    const { files: stored, attachments } = splitPrepared(files);
    const base = {
      brief: { ...brief, title: brief.title.trim() || 'Imported assessment' },
      knowledgeIds: [...kSel],
      productIds: [...pSel],
      notes,
      files: stored,
      attachments,
    };
    try {
      const res = await runAi(
        importMode
          ? { mode: 'import', ...base }
          : { mode: 'generate', ...base, ...(revisionNotes && draft ? { revisionNotes, previousDraft: draft } : {}) },
        { signal: ctl.signal, onProgress: (p, c) => { setPhase(p); setChars(c); } },
      );
      const allowed = (products ?? []).filter((p) => pSel.has(p.id)).map(productFromRow);
      const conv = draftToDefinition(res.data, allowed);
      setDraft(res.data);
      setConversion(conv);
      setRequestId(res.requestId);
      setRevision('');
      setPreview(null);
      setStep('review');
      if (saveFilesToLibrary) await saveAttachmentsToLibrary();
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        toast.ok('Generation cancelled');
      } else {
        toast.error(e);
      }
      setStep(draft ? 'review' : 'context');
    } finally {
      abortRef.current = null;
    }
  };

  const saveAttachmentsToLibrary = async () => {
    const rows = files.filter((f) => f.kind === 'text').map((f) => ({
      title: (f as Extract<PreparedFile, { kind: 'text' }>).attachment.name.replace(/\.[^.]+$/, ''),
      kind: 'reference',
      topic: brief.functionArea || null,
      product_line: brief.productLine || null,
      content: (f as Extract<PreparedFile, { kind: 'text' }>).attachment.text,
      source_filename: (f as Extract<PreparedFile, { kind: 'text' }>).attachment.name,
    }));
    if (!rows.length) return;
    const { error } = await supabase.from(T.knowledge).insert(rows);
    if (error) toast.error(`Couldn't save files to the library: ${error.message}`);
    else toast.ok(`Saved ${rows.length} file(s) to the Knowledge library`);
    setSaveFilesToLibrary(false);
  };

  const createDraft = async () => {
    if (!conversion || !draft) return;
    setCreating(true);
    try {
      const def = conversion.definition;
      const row = await createAssessment(def, {
        slug: await uniqueSlug(def.meta.title),
        extraSettings: {
          ai_brief: {
            mode: importMode ? 'import' : 'generate',
            brief,
            knowledgeIds: [...kSel],
            productIds: [...pSel],
            notes,
            files: files.map((f) => (f.kind === 'stored' ? f.file.name : f.attachment.name)),
            requestId,
            model: MODEL,
            generatedAt: new Date().toISOString(),
          },
        },
      });
      toast.ok('Draft created. Review and publish when ready.');
      nav(`/assessments/${row.id}`);
    } catch (e) {
      toast.error(e);
      setCreating(false);
    }
  };

  if (!canEdit) {
    return (<><TopBar title="Generate with AI" /><div className="s-page"><div className="card empty">Viewers can't create assessments.</div></div></>);
  }

  const steps: [Step, string][] = importMode
    ? [['context', '1. Upload & context'], ['brief', '2. Details'], ['review', '3. Review']]
    : [['brief', '1. Brief'], ['context', '2. Context'], ['review', '3. Review']];

  return (
    <>
      <TopBar title={importMode ? 'Import a questionnaire' : 'Generate with AI'}>
        <Link className="btn btn-ghost btn-sm" to="/new">Back</Link>
      </TopBar>
      <div className="s-page" style={{ maxWidth: step === 'review' ? 1400 : 980 }}>
        <div className="btn-row" style={{ marginBottom: 18 }}>
          {steps.map(([k, label]) => (
            <span key={k} className={`pill ${step === k || (step === 'generating' && k === 'review') ? 'pill-published' : 'pill-neutral'}`} style={{ fontSize: 12, padding: '5px 12px' }}>{label}</span>
          ))}
        </div>

        {step === 'brief' && (
          <div className="card">
            <div className="card-title">{importMode ? 'A few details (optional)' : 'What should this assessment do?'}</div>
            <div className="card-sub">The more specific the goal, the better the questions.</div>
            <Field label="Title or topic">
              <input className="input" autoFocus value={brief.title} onChange={(e) => setB({ title: e.target.value })} placeholder="e.g. Revenue Cycle Health Check for CCBHCs" />
            </Field>
            <div className="grid grid-3">
              <Field label="Audience">
                <select className="select" value={brief.audience} onChange={(e) => setB({ audience: e.target.value as GenerateBrief['audience'] })}>
                  <option value="prospect">Prospects</option>
                  <option value="customer">Existing customers</option>
                </select>
              </Field>
              <Field label="Product line">
                <select className="select" value={brief.productLine} onChange={(e) => setB({ productLine: e.target.value })}>
                  <option value="">Any / not specific</option>
                  {PRODUCT_LINES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Function area">
                <input className="input" value={brief.functionArea} onChange={(e) => setB({ functionArea: e.target.value })} placeholder="RCM, clinical documentation…" />
              </Field>
            </div>
            <Field label="Goal: what should the results lead to?" hint="e.g. Show where denials are leaking revenue and start a conversation about RCMS.">
              <textarea className="textarea" rows={2} value={brief.goal} onChange={(e) => setB({ goal: e.target.value })} />
            </Field>
            <div className="grid grid-3">
              {!importMode && (
                <Field label={`About ${brief.questionCount} questions`}>
                  <input type="range" min={5} max={25} value={brief.questionCount} onChange={(e) => setB({ questionCount: Number(e.target.value) })} />
                </Field>
              )}
              <Field label="Scoring">
                <select className="select" value={brief.scoringStyle} onChange={(e) => setB({ scoringStyle: e.target.value as GenerateBrief['scoringStyle'] })}>
                  <option value="auto">Let AI choose</option>
                  <option value="points">Points</option>
                  <option value="gaps">Gap flags</option>
                  <option value="none">No score (survey)</option>
                </select>
              </Field>
              <Field label="Lead form">
                <select className="select" value={brief.leadPosition} onChange={(e) => setB({ leadPosition: e.target.value as GenerateBrief['leadPosition'] })}>
                  <option value="beforeResults">Before results</option>
                  <option value="beforeQuestions">On the intro screen</option>
                  <option value="off">Don't ask</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-3">
              <Field label="Tone"><input className="input" value={brief.tone} onChange={(e) => setB({ tone: e.target.value })} /></Field>
              <Field label="Results button label (optional)"><input className="input" value={brief.primaryCtaLabel} onChange={(e) => setB({ primaryCtaLabel: e.target.value })} placeholder="Talk to our RCM team" /></Field>
              <Field label="Results button URL (optional)"><input className="input" value={brief.primaryCtaUrl} onChange={(e) => setB({ primaryCtaUrl: e.target.value })} placeholder="https://" /></Field>
            </div>
            <div className="row-between">
              {importMode ? <button className="btn btn-ghost" onClick={() => setStep('context')}>← Back</button> : <span />}
              {importMode
                ? <button className="btn btn-magenta" onClick={() => generate()}>✨ Import with AI</button>
                : <button className="btn btn-primary" disabled={!brief.title.trim()} onClick={() => setStep('context')}>Next: add context →</button>}
            </div>
          </div>
        )}

        {step === 'context' && (
          <>
            <div className="card">
              <div className="card-title">{importMode ? 'Questionnaire to import' : 'Files for this assessment (optional)'}</div>
              <div className="card-sub">
                {importMode
                  ? 'Upload the draft questionnaire (Word, PDF, Excel, or text). The AI keeps your questions and adds scoring, tiers and results copy.'
                  : 'One-off documents just for this generation: PDF, Word, Excel, CSV, TXT, or Markdown.'}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {files.map((f, i) => (
                  <div key={i} className="row-between small" style={{ padding: '6px 10px', background: '#fbf9f7', borderRadius: 6 }}>
                    <span>📄 {f.kind === 'stored' ? f.file.name : f.attachment.name} <span className="muted">({f.kind === 'stored' ? `${Math.round(f.size / 1024)} KB PDF` : `${Math.round(f.size / 1000)}k chars`})</span></span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'Reading…' : '+ Add files'}</button>
                <label className="check small"><input type="checkbox" checked={saveFilesToLibrary} onChange={(e) => setSaveFilesToLibrary(e.target.checked)} />Also save text files to the Knowledge library</label>
                <input ref={fileRef} type="file" hidden multiple accept={ACCEPTED_CONTEXT_FILES} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              </div>
            </div>

            <div className="card">
              <div className="row-between">
                <div>
                  <div className="card-title">Knowledge library</div>
                  <div className="card-sub">Pick the product facts and best practices the AI should build on. Matches for your product line and function are listed first.</div>
                </div>
                <Link className="btn btn-ghost btn-sm" to="/knowledge" target="_blank">Manage library ↗</Link>
              </div>
              <input className="input input-sm" style={{ maxWidth: 280, marginBottom: 8 }} placeholder="Filter…" value={kFilter} onChange={(e) => setKFilter(e.target.value)} />
              {!knowledge ? <Loading /> : knowledge.length === 0 ? (
                <p className="muted small">No knowledge documents yet. <Link to="/knowledge">Add some</Link>, e.g. "RCM best practices" or "What RCMS does".</p>
              ) : (
                <div className="stack" style={{ gap: 4, maxHeight: 300, overflowY: 'auto' }}>
                  {filteredKnowledge.map((k) => (
                    <label key={k.id} className="check" style={{ padding: '6px 8px', borderRadius: 6, background: kSel.has(k.id) ? 'rgba(0,178,169,0.07)' : undefined }}>
                      <input type="checkbox" checked={kSel.has(k.id)} onChange={(e) => setKSel((s) => { const n = new Set(s); if (e.target.checked) n.add(k.id); else n.delete(k.id); return n; })} />
                      <span style={{ flex: 1 }}><b style={{ color: 'var(--navy)' }}>{k.title}</b> <span className="small muted">· {KNOWLEDGE_KIND_LABELS[k.kind]}{k.topic ? ` · ${k.topic}` : ''}{k.product_line ? ` · ${k.product_line}` : ''}</span></span>
                      <span className="small muted">{Math.max(1, Math.round(k.char_count / 1000))}k</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Solutions the AI may recommend</div>
              <div className="card-sub">The AI maps answers only to the products you pick here, never anything else. Manage them in the Solutions library.</div>
              {!products ? <Loading /> : products.length === 0 ? (
                <p className="muted small">The Solutions library is empty. <Link to="/products">Add products</Link> to get recommendations.</p>
              ) : (
                <div className="grid grid-3" style={{ gap: 4 }}>
                  {products.map((p) => (
                    <label key={p.id} className="check small">
                      <input type="checkbox" checked={pSel.has(p.id)} onChange={(e) => setPSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />
                      {p.name}{p.product_line ? <span className="muted"> · {p.product_line}</span> : null}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-title">Additional context or instructions</div>
              <Field label="" hint="Anything else: target segment, questions you must include, terms to avoid, a competitor angle…">
                <textarea className="textarea" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="row-between">
                <span className={`small ${contextTokens > CONTEXT_WARN_TOKENS ? 'error-text' : 'muted'}`}>
                  Context size: ~{contextTokens.toLocaleString()} tokens{contextTokens > CONTEXT_WARN_TOKENS ? '. That\'s a lot; consider trimming for speed and cost.' : ''}
                </span>
                <div className="btn-row">
                  {!importMode && <button className="btn btn-ghost" onClick={() => setStep('brief')}>← Back</button>}
                  {importMode
                    ? <button className="btn btn-primary" disabled={!files.length} onClick={() => setStep('brief')}>Next: details →</button>
                    : <button className="btn btn-magenta" onClick={() => generate()}>✨ Generate assessment</button>}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 'generating' && (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 34 }}>✨</div>
            <h2 style={{ margin: '10px 0 6px' }}>{phase || 'Working'}…</h2>
            <p className="muted">
              {Math.floor((now - started) / 1000)}s elapsed{chars ? ` · ${chars.toLocaleString()} characters written` : ''}. Full assessments usually take 1–3 minutes.
            </p>
            <button className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>Cancel</button>
          </div>
        )}

        {step === 'review' && conversion && draft && (
          <ReviewPane
            conversion={conversion}
            draft={draft}
            revision={revision}
            setRevision={setRevision}
            preview={preview}
            setPreview={setPreview}
            creating={creating}
            onCreate={createDraft}
            onRegenerate={() => generate(revision.trim() || 'Improve it overall.')}
            onBack={() => setStep('context')}
            importMode={importMode}
          />
        )}
      </div>
    </>
  );
}

function ReviewPane(p: {
  conversion: DraftConversion;
  draft: AiDraft;
  revision: string;
  setRevision: (v: string) => void;
  preview: { screen: Screen; nonce: number; answers?: Answers } | null;
  setPreview: (v: { screen: Screen; nonce: number; answers?: Answers } | null) => void;
  creating: boolean;
  onCreate: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  importMode: boolean;
}) {
  const def = p.conversion.definition;
  const qs = orderedQuestions(def);
  const errors = p.conversion.issues.filter((i) => i.level === 'error');
  const warnings = p.conversion.issues.filter((i) => i.level === 'warning');
  const productName = (id: string) => def.products.find((x) => x.id === id)?.name ?? id;

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(360px, 42%)', alignItems: 'start' }}>
      <div>
        <div className="card">
          <div className="row-between">
            <div>
              <div className="card-title" style={{ fontSize: 18 }}>{def.meta.title}</div>
              <div className="card-sub" style={{ marginBottom: 6 }}>
                {qs.length} questions · {def.sections.length} sections · scoring: {def.scoring.method}
                {def.products.length ? ` · ${def.products.length} solutions mapped` : ''}
              </div>
            </div>
            <button className="btn btn-magenta" disabled={p.creating} onClick={p.onCreate}>{p.creating ? 'Creating…' : 'Create draft →'}</button>
          </div>
          <p style={{ margin: '6px 0 0' }}>{p.draft.designNotes}</p>
          {(errors.length > 0 || warnings.length > 0 || p.conversion.repairs.length > 0) && (
            <ul className="checklist" style={{ marginTop: 12 }}>
              {errors.map((i, n) => <li key={`e${n}`} className="error">⛔ {i.message}</li>)}
              {warnings.map((i, n) => <li key={`w${n}`} className="warning">⚠️ {i.message}</li>)}
              {p.conversion.repairs.map((r, n) => <li key={`r${n}`} className="warning">🔧 {r}</li>)}
            </ul>
          )}
          {errors.length > 0 && <p className="small muted">You can still create the draft and fix these in the editor before publishing.</p>}
        </div>

        {def.sections.map((s) => {
          const sq = qs.filter((q) => q.sectionId === s.id);
          if (!sq.length) return null;
          return (
            <div key={s.id} className="card">
              <div className="row-between">
                <div className="card-title">{s.name}</div>
                {s.productIds.length > 0 && <span className="small muted">Solved by: {s.productIds.map(productName).join(', ')}</span>}
              </div>
              {sq.map((q) => (
                <div key={q.id} style={{ padding: '8px 0', borderTop: '1px solid #f0ebe5' }}>
                  <div style={{ fontWeight: 600, color: 'var(--navy)' }}>
                    Q{qs.indexOf(q) + 1}. {q.text}{' '}
                    {q.role !== 'scored' && <span className="pill pill-draft">{q.role}</span>}{' '}
                    {q.showIf && <span className="pill pill-paused">conditional</span>}
                  </div>
                  {q.options.length > 0 && (
                    <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {q.options.map((o) => (
                        <li key={o.id}>
                          {o.label}{' '}
                          <span className="muted">
                            {o.points !== undefined ? `· ${o.points} pts ` : ''}{o.isGap ? '· gap ' : ''}{o.notApplicable ? '· N/A ' : ''}
                            {o.recommend ? `· → ${o.recommend.productIds.map(productName).join(', ')}${o.recommend.badge ? ` (${o.recommend.badge})` : ''}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.type === 'rating' && <div className="small muted">Rating {q.scale?.min}–{q.scale?.max}</div>}
                </div>
              ))}
            </div>
          );
        })}

        {def.scoring.tiers.length > 0 && (
          <div className="card">
            <div className="card-title">Score tiers</div>
            {[...def.scoring.tiers].sort((a, b) => b.min - a.min).map((t) => (
              <div key={t.id} style={{ padding: '6px 0', borderTop: '1px solid #f0ebe5' }}>
                <b style={{ color: t.color }}>{t.label}</b> <span className="small muted">{t.min}–{t.max}</span>
                <div className="small">{t.summary}</div>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="card-title">Not quite right?</div>
          <Field label="Tell the AI what to change" hint="e.g. Fewer questions about billing, add a section on credentialing, make the tone less formal.">
            <textarea className="textarea" rows={3} value={p.revision} onChange={(e) => p.setRevision(e.target.value)} />
          </Field>
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={p.onRegenerate}>✨ Regenerate with these notes</button>
            <button className="btn btn-ghost" onClick={p.onBack}>← Change context</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 76 }}>
        <div className="ed-preview-bar">
          <b className="small" style={{ color: 'var(--navy)' }}>Preview</b>
          <button className="btn btn-secondary btn-sm" onClick={() => p.setPreview({ screen: 'intro', nonce: Date.now(), answers: {} })}>Intro</button>
          <button className="btn btn-secondary btn-sm" onClick={() => p.setPreview({ screen: 'questions', nonce: Date.now() })}>Questions</button>
          <button className="btn btn-secondary btn-sm" onClick={() => p.setPreview({ screen: 'results', nonce: Date.now(), answers: sampleAnswers(def, 'worst') })}>Results (weak)</button>
          <button className="btn btn-secondary btn-sm" onClick={() => p.setPreview({ screen: 'results', nonce: Date.now(), answers: sampleAnswers(def, 'best') })}>Results (strong)</button>
        </div>
        <div data-qq-scroll style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
          <AssessmentExperience definition={def} mode="preview" narrow jumpTo={p.preview ?? undefined} />
        </div>
      </div>
    </div>
  );
}
