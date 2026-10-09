import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import type { AssessmentDefinition } from '@qq/schema';
import { orderedQuestions } from '@qq/engine';
import { applyEdits, definitionForEditing, previewEdits, type ChangeResult, type EditChange } from '@qq/ai';
import { runAi } from '../lib/ai';
import { supabase, T, errorMessage, uploadAsset } from '../lib/supabase';
import type { AiChatRow } from '../lib/types';
import { IconSparkle } from './icons';
import { useToast } from './ui';

// ─────────────────────────────────────────────────────────────────────────────
// Editor AI assistant: a floating tie-dye button that opens a chat panel. The AI
// proposes SCOPED edits (id-addressed operations, see packages/ai/src/edits.ts);
// the creator reviews before → after, applies some or all, or keeps chatting.
// Applied edits go through the editor's normal update(), so they land in the draft
// and only reach a live assessment when it's published.
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLES = [
  'Shorten the answer choices in the first section',
  'Add the attached screenshot to question 2',
  'Make the results copy warmer. Don’t change scoring',
];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGES = 4;

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};

const isImageUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/.+\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(v);

const PREVIEW_CHARS = 220;

/** Long text starts collapsed with "Show more", so the full change can be checked before applying. */
function LongText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= PREVIEW_CHARS) return <span>{text}</span>;
  // Cut at a word boundary
  const cut = text.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '');
  return (
    <span>
      {expanded ? text : `${cut}…`}{' '}
      <button type="button" className="ai-more" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </span>
  );
}

/** A change's proposed value, decoded from its JSON string (for cards that are no longer live) */
function proposedValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function Value({ v }: { v: unknown }) {
  if (v === undefined || v === null || v === '') return <span className="muted">(empty)</span>;
  if (isImageUrl(v)) return <img src={v as string} alt="" className="ai-thumb" />;
  if (typeof v === 'string') return <LongText text={v} />;
  if (typeof v === 'number' || typeof v === 'boolean') return <span>{String(v)}</span>;
  if (typeof v === 'object' && v && 'text' in v) return <span><b>New question:</b> {String((v as { text: unknown }).text)}</span>;
  if (typeof v === 'object' && v && 'label' in v) return <span>{String((v as { label: unknown }).label)}</span>;
  if (typeof v === 'object' && v && 'name' in v) return <span>{String((v as { name: unknown }).name)}</span>;
  if (Array.isArray(v)) return <span>{v.length} item{v.length === 1 ? '' : 's'}</span>;
  return <span className="mono">{JSON.stringify(v).slice(0, 160)}</span>;
}

export function AiAssistant({ assessmentId, def, update, openQuestion, onShow, status }: {
  assessmentId: string;
  def: AssessmentDefinition;
  update: (fn: (d: AssessmentDefinition) => void) => void;
  openQuestion: string | null;
  /** Bring the edited field into view in the editor (and preview) */
  onShow: (target: string) => void;
  status: 'draft' | 'published' | 'paused' | 'archived';
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AiChatRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState('');
  const [images, setImages] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [focusOn, setFocusOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Set<number>>>({});
  const [undo, setUndo] = useState<Record<string, { before: AssessmentDefinition; afterHash: number }>>({});
  const [baseHash, setBaseHash] = useState<Record<string, number>>({});
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const defHash = useMemo(() => hash(JSON.stringify(def)), [def]);
  const questions = useMemo(() => orderedQuestions(def), [def]);
  const focusQ = openQuestion ? questions.find((q) => q.id === openQuestion) : undefined;
  const [pendingRemote, setPendingRemote] = useState(false);
  const pending = loaded ? rows.some((r) => r.status === 'proposed') : pendingRemote;

  // Load saved history the first time the panel opens
  useEffect(() => {
    if (!open || loaded) return;
    supabase.from(T.aiChat).select('*').eq('assessment_id', assessmentId).order('created_at').limit(200).then(({ data, error }) => {
      if (error) console.warn('AI chat history unavailable', error.message);
      const list = (data as AiChatRow[]) ?? [];
      setRows(list);
      setSelected(Object.fromEntries(list.filter((r) => r.status === 'proposed').map((r) => [r.id, new Set(r.changes.map((_, i) => i))])));
      setLoaded(true);
    });
  }, [open, loaded, assessmentId]);
  // The button's dot shows unapplied suggestions even before the panel is opened
  useEffect(() => {
    supabase.from(T.aiChat).select('id', { count: 'exact', head: true }).eq('assessment_id', assessmentId).eq('status', 'proposed')
      .then(({ count }) => setPendingRemote(!!count));
  }, [assessmentId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [rows.length, busy, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    setTimeout(() => inputRef.current?.focus(), 220);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const saveRow = async (row: Omit<AiChatRow, 'id' | 'created_at' | 'user_id' | 'assessment_id'>): Promise<AiChatRow> => {
    const { data, error } = await supabase.from(T.aiChat).insert({ ...row, assessment_id: assessmentId }).select('*').single();
    if (error) {
      // History couldn't be saved (e.g. migration not run yet): keep going in memory
      console.warn('AI chat not saved', error.message);
      return { ...row, id: crypto.randomUUID(), assessment_id: assessmentId, user_id: null, created_at: new Date().toISOString() };
    }
    return data as AiChatRow;
  };
  const patchRow = (id: string, patch: Partial<AiChatRow>) => {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    supabase.from(T.aiChat).update(patch).eq('id', id).then(({ error }) => error && console.warn('AI chat update failed', error.message));
  };

  const addFiles = useCallback(async (files: File[]) => {
    const imgs = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (!imgs.length) return;
    if (images.length + imgs.length > MAX_IMAGES) return toast.error(`Attach up to ${MAX_IMAGES} images per message.`);
    setUploading(true);
    try {
      for (const f of imgs) {
        if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is over 10 MB.`); continue; }
        const url = await uploadAsset(f, 'ai-chat');
        setImages((cur) => [...cur, { url, name: f.name || 'pasted image' }]);
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  }, [images.length, toast]);

  const send = async (prompt = text) => {
    const request = prompt.trim();
    if (!request || busy) return;
    const imgs = images;
    setText('');
    setImages([]);
    const userRow = await saveRow({ role: 'user', content: request, images: imgs, changes: [], status: 'answered' });
    setRows((cur) => [...cur, userRow]);
    const history = rows.slice(-10).map((r) => ({
      role: r.role,
      text: r.role === 'assistant' && r.changes.length
        ? `${r.content} [Proposed: ${r.changes.map((c) => c.description).join('; ')}. Status: ${r.status.replace('_', ' ')}]`
        : r.content,
    }));
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy('Reading your assessment');
    try {
      const { data } = await runAi(
        {
          mode: 'edit_assessment',
          definition: definitionForEditing(def),
          messages: history,
          request,
          images: imgs,
          focusQuestionId: focusOn && focusQ ? focusQ.id : undefined,
        },
        { signal: ctl.signal, onProgress: (phase) => setBusy(phase === 'Writing' ? 'Drafting changes' : phase) },
      );
      const reply = [data.reply, data.clarifyingQuestion].map((s) => s.trim()).filter(Boolean).join('\n\n') || 'Done.';
      const changes = data.clarifyingQuestion.trim() ? [] : data.changes;
      const aRow = await saveRow({ role: 'assistant', content: reply, images: [], changes, status: changes.length ? 'proposed' : 'answered' });
      setRows((cur) => [...cur, aRow]);
      if (changes.length) {
        const preview = previewEdits(def, changes);
        setSelected((s) => ({ ...s, [aRow.id]: new Set(preview.filter((p) => p.ok).map((p) => p.index)) }));
        setBaseHash((h) => ({ ...h, [aRow.id]: defHash }));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') toast.ok('Stopped');
      else {
        const msg = errorMessage(e);
        setRows((cur) => [...cur, { id: crypto.randomUUID(), assessment_id: assessmentId, user_id: null, role: 'assistant', content: `Something went wrong: ${msg}`, images: [], changes: [], status: 'answered', created_at: new Date().toISOString() }]);
      }
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  };

  const apply = (row: AiChatRow) => {
    const sel = selected[row.id] ?? new Set<number>();
    if (!sel.size) return toast.error('Tick at least one change to apply.');
    const before = structuredClone(def);
    const { definition, results } = applyEdits(def, row.changes, (i) => sel.has(i));
    const okCount = results.filter((r) => r.ok).length;
    if (!okCount) return toast.error("None of the selected changes could be applied. See the reasons below.");
    update((d) => { Object.assign(d, structuredClone(definition)); });
    setUndo((u) => ({ ...u, [row.id]: { before, afterHash: hash(JSON.stringify(definition)) } }));
    const byIndex = new Map(results.map((r) => [r.index, r]));
    const changes = row.changes.map((c, i) => ({ ...c, applied: byIndex.get(i)?.ok ?? false, reason: byIndex.get(i)?.ok ? undefined : byIndex.get(i)?.reason }));
    patchRow(row.id, { changes, status: okCount === row.changes.length ? 'applied' : 'partly_applied' });
    toast.ok(`Applied ${okCount} change${okCount === 1 ? '' : 's'} to the draft`);
  };

  const revert = (row: AiChatRow) => {
    const u = undo[row.id];
    if (!u) return;
    if (defHash !== u.afterHash && !window.confirm('The assessment changed after these edits were applied. Undo anyway? Later edits will be lost too.')) return;
    update((d) => { Object.assign(d, structuredClone(u.before)); });
    setUndo((x) => { const n = { ...x }; delete n[row.id]; return n; });
    patchRow(row.id, { status: 'undone' });
    toast.ok('Undone');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const onPaste = (e: ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => IMAGE_TYPES.includes(f.type))) { e.preventDefault(); addFiles(files); }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    addFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <>
      <button
        type="button"
        className={`ai-fab ${open ? 'is-open' : ''}`}
        aria-label="Edit with AI"
        title="Edit with AI"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ai-fab-ring" aria-hidden="true" />
        <span className="ai-fab-icon"><IconSparkle /></span>
        {pending && !open && <span className="ai-fab-dot" aria-label="Unapplied suggestions" />}
      </button>

      <aside className={`ai-panel ${open ? 'is-open' : ''}`} aria-hidden={!open} aria-label="AI assistant" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <header className="ai-panel-head">
          <div>
            <div className="row" style={{ gap: 8 }}>
              <span className="ai-mini-orb" aria-hidden="true"><IconSparkle /></span>
              <b>AI assistant</b>
            </div>
            <div className="small muted">
              Editing the draft{status === 'published' ? ' · changes go live only when you publish' : ''}. Only what you ask is changed.
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
        </header>

        <div className="ai-thread">
          {loaded && rows.length === 0 && (
            <div className="ai-empty">
              <p><b>Ask for a specific change</b> and review it before anything is applied. Attach screenshots or GIFs and say where they should go.</p>
              <div className="stack" style={{ gap: 6 }}>
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="ai-chip" onClick={() => { setText(ex); inputRef.current?.focus(); }}>{ex}</button>
                ))}
              </div>
            </div>
          )}

          {rows.map((r) => r.role === 'user' ? (
            <div key={r.id} className="ai-msg ai-user">
              {r.images.length > 0 && <div className="ai-imgs">{r.images.map((im) => <img key={im.url} src={im.url} alt={im.name} className="ai-thumb" />)}</div>}
              <div className="ai-bubble">{r.content}</div>
            </div>
          ) : (
            <div key={r.id} className="ai-msg ai-assistant">
              <div className="ai-bubble">{r.content}</div>
              {r.changes.length > 0 && (
                <ProposalCard
                  row={r}
                  def={def}
                  stale={baseHash[r.id] !== undefined && baseHash[r.id] !== defHash && r.status === 'proposed'}
                  selected={selected[r.id] ?? new Set()}
                  setSelected={(s) => setSelected((x) => ({ ...x, [r.id]: s }))}
                  canUndo={!!undo[r.id]}
                  onApply={() => apply(r)}
                  onDiscard={() => patchRow(r.id, { status: 'discarded' })}
                  onUndo={() => revert(r)}
                  onRefine={() => { setText('About those changes: '); inputRef.current?.focus(); }}
                  onJump={(c) => onShow(c.target)}
                />
              )}
            </div>
          ))}

          {busy && (
            <div className="ai-msg ai-assistant">
              <div className="ai-bubble ai-typing">
                <span className="ai-dots"><i /><i /><i /></span> {busy}…
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>Stop</button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <footer className="ai-composer">
          {focusQ && focusOn && (
            <div className="ai-context">
              About: Q{questions.indexOf(focusQ) + 1} · {focusQ.shortLabel || focusQ.text.slice(0, 40)}
              <button type="button" aria-label="Don't focus on this question" onClick={() => setFocusOn(false)}>✕</button>
            </div>
          )}
          {images.length > 0 && (
            <div className="ai-imgs" style={{ marginBottom: 8 }}>
              {images.map((im) => (
                <span key={im.url} className="ai-attach">
                  <img src={im.url} alt={im.name} className="ai-thumb" />
                  <button type="button" aria-label={`Remove ${im.name}`} onClick={() => setImages((cur) => cur.filter((x) => x.url !== im.url))}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="ai-input-row">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="Attach images" title="Attach images (or paste / drop)" disabled={uploading || images.length >= MAX_IMAGES} onClick={() => fileRef.current?.click()}>
              {uploading ? '…' : '📎'}
            </button>
            <input ref={fileRef} type="file" hidden multiple accept={IMAGE_TYPES.join(',')} onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <textarea
              ref={inputRef}
              className="textarea"
              rows={2}
              placeholder="Describe the change, e.g. “Use this screenshot on the denial question”"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              onPaste={onPaste}
            />
            <button type="button" className="btn btn-primary" disabled={!text.trim() || !!busy || uploading} onClick={() => send()}>Send</button>
          </div>
          <div className="small muted" style={{ marginTop: 6 }}>Enter to send · Shift+Enter for a new line · Paste or drop images</div>
        </footer>
      </aside>
    </>
  );
}

function ProposalCard({ row, def, stale, selected, setSelected, canUndo, onApply, onDiscard, onUndo, onRefine, onJump }: {
  row: AiChatRow;
  def: AssessmentDefinition;
  stale: boolean;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  canUndo: boolean;
  onApply: () => void;
  onDiscard: () => void;
  onUndo: () => void;
  onRefine: () => void;
  onJump: (c: EditChange) => void;
}) {
  const proposed = row.status === 'proposed';
  // Live preview against the CURRENT draft, so before/after and validity are always up to date
  const preview: ChangeResult[] = useMemo(() => (proposed ? previewEdits(def, row.changes) : []), [proposed, def, row.changes]);
  const appliedCount = row.changes.filter((c) => c.applied).length;

  return (
    <div className={`ai-proposal ${proposed ? '' : 'is-done'}`}>
      <div className="ai-proposal-head">
        <b>{row.changes.length} proposed change{row.changes.length === 1 ? '' : 's'}</b>
        {row.status === 'applied' && <span className="pill pill-published">Applied</span>}
        {row.status === 'partly_applied' && <span className="pill pill-paused">Applied {appliedCount} of {row.changes.length}</span>}
        {row.status === 'discarded' && <span className="pill pill-archived">Discarded</span>}
        {row.status === 'undone' && <span className="pill pill-neutral">Undone</span>}
      </div>
      {stale && <div className="small callout-warn" style={{ padding: '8px 10px', margin: '6px 0' }}>The assessment changed since this was suggested. Check the before/after again before applying.</div>}
      <ul className="ai-changes">
        {row.changes.map((c, i) => {
          const p = preview[i];
          const ok = proposed ? p?.ok : c.applied;
          const reason = proposed ? p?.reason : c.reason;
          return (
            <li key={i} className={ok === false ? 'is-bad' : ''}>
              {proposed && (
                <input type="checkbox" disabled={!p?.ok} checked={!!p?.ok && selected.has(i)} aria-label={c.description}
                  onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(i); else n.delete(i); setSelected(n); }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-between" style={{ gap: 6 }}>
                  <span className="ai-change-title">{c.description || `${c.action} ${c.target}`}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onJump(c)}>Show</button>
                </div>
                {proposed && p?.ok && (
                  <div className="ai-diff">
                    {c.action !== 'insert' && <div className="ai-before"><Value v={p.before} /></div>}
                    {c.action !== 'remove' && c.action !== 'move' && <div className="ai-after"><Value v={p.after} /></div>}
                    {c.action === 'remove' && <div className="small muted">Will be removed</div>}
                    {c.action === 'move' && <div className="small muted">Will be moved</div>}
                  </div>
                )}
                {/* Applied, undone or discarded: still show what was suggested, so it can be re-checked */}
                {!proposed && (c.action === 'set' || c.action === 'insert') && (
                  <div className="ai-diff">
                    <div className="small muted">Suggested{row.status === 'undone' ? ' (undone)' : c.applied ? ' (applied)' : ''}:</div>
                    <div className={c.applied && row.status !== 'undone' ? 'ai-after' : 'ai-suggested'}><Value v={proposedValue(c.value)} /></div>
                  </div>
                )}
                {reason && <div className="small error-text">{proposed ? "Can't apply" : 'Not applied'}: {reason}</div>}
              </div>
            </li>
          );
        })}
      </ul>
      {proposed ? (
        <div className="btn-row">
          <button type="button" className="btn btn-primary btn-sm" disabled={!selected.size} onClick={onApply}>Apply selected ({selected.size})</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefine}>Ask for changes</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard}>Discard</button>
        </div>
      ) : canUndo ? (
        <div className="btn-row"><button type="button" className="btn btn-secondary btn-sm" onClick={onUndo}>Undo</button></div>
      ) : null}
    </div>
  );
}
