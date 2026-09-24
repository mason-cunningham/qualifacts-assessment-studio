import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_TEMPLATES } from '@qq/templates';
import { orderedQuestions } from '@qq/engine';
import { Markdown } from '@qq/ui';
import { TopBar } from '../components/Layout';
import { Field, Loading, Modal, TextInput, useToast } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { runAi } from '../lib/ai';
import { ACCEPTED_CONTEXT_FILES, prepareFile, splitPrepared } from '../lib/files';
import { fmtRelative } from '../lib/format';
import { KNOWLEDGE_KIND_LABELS, PRODUCT_LINES, type KnowledgeKind, type KnowledgeRow } from '../lib/types';

interface Draft {
  id: string | null;
  title: string;
  kind: KnowledgeKind;
  topic: string;
  product_line: string;
  content: string;
  source_filename: string | null;
  source_path: string | null;
}

const EMPTY: Draft = { id: null, title: '', kind: 'best_practices', topic: '', product_line: '', content: '', source_filename: null, source_path: null };

export function KnowledgePage() {
  const { canEdit, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<KnowledgeRow[] | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'' | KnowledgeKind>('');
  const [editing, setEditing] = useState<Draft | null>(null);

  const load = () =>
    supabase.from(T.knowledge).select('*').order('topic', { nullsFirst: false }).order('title')
      .then(({ data, error }) => {
        if (error) toast.error(error.message.includes('does not exist') ? 'Run supabase/004_ai_knowledge.sql to enable the Knowledge Library.' : error);
        setRows((data as KnowledgeRow[]) ?? []);
      });
  useEffect(() => { load(); }, []);

  const topics = useMemo(() => [...new Set((rows ?? []).map((r) => r.topic).filter(Boolean) as string[])].sort(), [rows]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!kind || r.kind === kind) && (!t || `${r.title} ${r.topic ?? ''} ${r.product_line ?? ''} ${r.content.slice(0, 2000)}`.toLowerCase().includes(t)));
  }, [rows, q, kind]);

  const toggleActive = async (r: KnowledgeRow) => {
    const { error } = await supabase.from(T.knowledge).update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return toast.error(error);
    load();
  };
  const remove = async (r: KnowledgeRow) => {
    if (!window.confirm(`Delete "${r.title}"? Assessments already generated aren't affected.`)) return;
    const { error } = await supabase.from(T.knowledge).delete().eq('id', r.id);
    if (error) return toast.error(error);
    load();
  };

  const seed = async () => {
    const existing = new Set((rows ?? []).map((r) => r.title.toLowerCase()));
    const docs = starterDocs().filter((d) => !existing.has(d.title.toLowerCase()));
    if (!docs.length) return toast.ok('Starter documents are already in the library.');
    const { error } = await supabase.from(T.knowledge).insert(docs);
    if (error) return toast.error(error);
    toast.ok(`Added ${docs.length} starter documents`);
    load();
  };

  return (
    <>
      <TopBar title="Knowledge library">
        {canEdit && <button className="btn btn-secondary btn-sm" onClick={seed}>Add starter docs</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing({ ...EMPTY })}>+ New document</button>}
      </TopBar>
      <div className="s-page">
        <p className="muted" style={{ marginTop: 0, maxWidth: 820 }}>
          Context the AI uses when generating assessments: what each product does, best practices for a function (e.g. RCM),
          messaging, or reference material. Write it once here and attach it to any generation.
        </p>
        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          <input className="input" style={{ maxWidth: 300 }} placeholder="Search knowledge…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select" style={{ width: 180 }} value={kind} onChange={(e) => setKind(e.target.value as '' | KnowledgeKind)}>
            <option value="">All kinds</option>
            {Object.entries(KNOWLEDGE_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {!rows ? <Loading /> : filtered.length === 0 ? (
          <div className="card empty">
            <h3>No knowledge documents yet</h3>
            <p>Add product facts or best practices, upload a PDF or Word doc, or start with the starter docs built from the Qualifacts templates.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Title</th><th>Kind</th><th>Topic</th><th>Product line</th><th>Size</th><th>Updated</th><th /></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="clickable" style={{ opacity: r.is_active ? 1 : 0.5 }}
                    onClick={() => setEditing({ id: r.id, title: r.title, kind: r.kind, topic: r.topic ?? '', product_line: r.product_line ?? '', content: r.content, source_filename: r.source_filename, source_path: r.source_path })}>
                    <td><b style={{ color: 'var(--navy)' }}>{r.title}</b>{r.source_filename && <div className="small muted">from {r.source_filename}</div>}</td>
                    <td><span className="pill pill-neutral">{KNOWLEDGE_KIND_LABELS[r.kind]}</span></td>
                    <td>{r.topic ?? '—'}</td>
                    <td>{r.product_line ?? '—'}</td>
                    <td className="small muted">{Math.max(1, Math.round(r.char_count / 1000))}k chars</td>
                    <td className="small muted">{fmtRelative(r.updated_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</button>}
                      {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => remove(r)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing && <KnowledgeEditor draft={editing} topics={topics} readOnly={!canEdit} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </>
  );
}

function KnowledgeEditor({ draft, topics, readOnly, onClose, onSaved }: {
  draft: Draft; topics: string[]; readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [d, setD] = useState<Draft>(draft);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPdf, setPendingPdf] = useState<{ path: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  const onFile = async (file: File) => {
    setBusy('Reading file…');
    try {
      const p = await prepareFile(file);
      if (p.kind === 'text') {
        set({
          content: d.content.trim() ? `${d.content.trim()}\n\n${p.attachment.text}` : p.attachment.text,
          title: d.title || file.name.replace(/\.[^.]+$/, ''),
          source_filename: file.name,
        });
        toast.ok('Text added. Review and tidy it before saving, or use "Clean up with AI".');
      } else {
        setPendingPdf({ path: p.file.path, name: p.file.name });
        set({ source_filename: p.file.name, source_path: p.file.path, title: d.title || file.name.replace(/\.[^.]+$/, '') });
        toast.ok('PDF uploaded. Click "Extract with AI" to turn it into notes.');
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const extract = async () => {
    setBusy('Extracting with AI…');
    try {
      const prepared = pendingPdf
        ? { files: [{ path: pendingPdf.path, name: pendingPdf.name, mediaType: 'application/pdf' }], attachments: [] }
        : splitPrepared([{ kind: 'text', attachment: { name: d.source_filename ?? 'notes', text: d.content }, size: d.content.length }]);
      const { data } = await runAi(
        { mode: 'extract_knowledge', ...prepared, hint: [d.title, d.topic].filter(Boolean).join(' · ') },
        { onProgress: (phase) => setBusy(`${phase}…`) },
      );
      set({
        title: d.title || data.title,
        kind: data.kind,
        topic: d.topic || data.topic,
        product_line: d.product_line || data.productLine || '',
        content: data.content,
      });
      setPendingPdf(null);
      toast.ok('Notes extracted. Review them, then save.');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!d.title.trim()) return toast.error('Give it a title.');
    if (!d.content.trim()) return toast.error('Add some content (or extract it from a file).');
    setBusy('Saving…');
    const payload = {
      title: d.title.trim(), kind: d.kind, topic: d.topic.trim() || null, product_line: d.product_line || null,
      content: d.content.trim(), source_filename: d.source_filename, source_path: d.source_path,
    };
    const res = d.id ? await supabase.from(T.knowledge).update(payload).eq('id', d.id) : await supabase.from(T.knowledge).insert(payload);
    setBusy(null);
    if (res.error) return toast.error(res.error);
    toast.ok('Saved');
    onSaved();
  };

  return (
    <Modal
      title={d.id ? (readOnly ? d.title : `Edit: ${d.title}`) : 'New knowledge document'}
      onClose={onClose}
      wide
      footer={
        readOnly ? <button className="btn btn-secondary" onClick={onClose}>Close</button> : (
          <>
            <span className="small muted" style={{ marginRight: 'auto' }}>{busy ?? `${d.content.length.toLocaleString()} characters`}</span>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!!busy} onClick={save}>Save</button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly || !!busy} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid grid-2">
          <Field label="Title"><TextInput value={d.title} onChange={(v) => set({ title: v })} placeholder="e.g. RCM best practices for BH" /></Field>
          <Field label="Kind">
            <select className="select" value={d.kind} onChange={(e) => set({ kind: e.target.value as KnowledgeKind })}>
              {Object.entries(KNOWLEDGE_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Topic / function" hint="Used to filter docs when generating">
            <input className="input" list="qq-topics" value={d.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="RCM, Clinical documentation, Client engagement…" />
            <datalist id="qq-topics">{topics.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Product line (optional)">
            <select className="select" value={d.product_line} onChange={(e) => set({ product_line: e.target.value })}>
              <option value="">—</option>
              {PRODUCT_LINES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        <div className="row-between" style={{ margin: '4px 0 6px' }}>
          <span className="label">Content (Markdown)</span>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>Start from a file</button>
            {(pendingPdf || d.content.trim()) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={extract}>
                ✨ {pendingPdf ? 'Extract with AI' : 'Clean up with AI'}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview((p) => !p)}>{preview ? 'Edit' : 'Preview'}</button>
          </div>
          <input ref={fileRef} type="file" hidden accept={ACCEPTED_CONTEXT_FILES} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
        </div>
        {pendingPdf && <div className="card small" style={{ background: '#fff8e6', borderColor: '#f2d48a', marginBottom: 8 }}>“{pendingPdf.name}” is uploaded. Click <b>Extract with AI</b> to turn it into editable notes.</div>}
        {preview ? (
          <div className="card qq-prose" style={{ maxHeight: 460, overflowY: 'auto' }}><Markdown text={d.content || '*Nothing yet*'} /></div>
        ) : (
          <textarea className="textarea" style={{ minHeight: 380, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }}
            value={d.content} onChange={(e) => set({ content: e.target.value })}
            placeholder={'## What it is\n...\n\n## Best practices\n- Verify eligibility 3–5 days before the visit\n- ...\n\n## Signs of a gap\n- ...'} />
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Tip: write facts and best practices, not instructions. The AI treats these documents as reference material. Don't include client PHI.
        </p>
      </fieldset>
      {busy && <p className="small" style={{ color: 'var(--teal-dk)' }}>{busy}</p>}
    </Modal>
  );
}

/** Starter documents derived from the built-in Qualifacts templates. */
function starterDocs() {
  const docs: { title: string; kind: KnowledgeKind; topic: string; product_line: string | null; content: string }[] = [];
  for (const t of BUILT_IN_TEMPLATES) {
    const def = t.definition;
    const qs = orderedQuestions(def);
    if (t.key === 'ces-healthcheck') {
      const lines = ['# Client Engagement Suite (CES) features', '', 'Features of the Qualifacts Client Engagement Suite and the workflow signals that show a customer would benefit.', ''];
      for (const p of def.products) {
        const signals = qs.flatMap((q) => q.options.filter((o) => o.recommend?.productIds.includes(p.id)).map((o) => `"${q.shortLabel ?? q.text}" → ${o.label}`));
        lines.push(`## ${p.name}`, '', p.whatItDoes ?? '', '', `**Why it matters:** ${p.whyItMatters ?? ''}`, '', '**Benefits:**', ...p.benefits.map((b) => `- ${b}`));
        if (signals.length) lines.push('', '**Signals of a gap:**', ...signals.map((s) => `- ${s}`));
        lines.push('');
      }
      docs.push({ title: 'CES features and gap signals', kind: 'product_info', topic: 'Client engagement', product_line: 'CES', content: lines.join('\n') });
    } else if (t.key === 'insync-operational') {
      const lines = ['# InSync add-ons and the operational gaps they solve', ''];
      for (const s of def.sections) {
        const prods = s.productIds.map((id) => def.products.find((p) => p.id === id)?.name).filter(Boolean);
        if (!prods.length) continue;
        lines.push(`## ${s.name}: solved by ${prods.join(', ')}`, '', '**Signals of a gap:**');
        for (const q of qs.filter((x) => x.sectionId === s.id && x.role === 'scored')) {
          const gaps = q.options.filter((o) => o.isGap).map((o) => o.label);
          if (gaps.length) lines.push(`- ${q.shortLabel ?? q.text}: ${gaps.join('; ')}`);
        }
        lines.push('');
      }
      docs.push({ title: 'InSync add-ons and gap signals', kind: 'product_info', topic: 'InSync operations', product_line: 'InSync', content: lines.join('\n') });
    } else if (t.key === 'eligibility') {
      const lines = ['# Eligibility verification best practices for behavioral health', '', 'Strong practice for each area, with the common weaker patterns to watch for.', ''];
      for (const s of def.sections) {
        lines.push(`## ${s.name}`);
        for (const q of qs.filter((x) => x.sectionId === s.id)) {
          const sorted = [...q.options].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
          lines.push(`- **${q.shortLabel ?? q.text}.** Best practice: ${sorted[0]?.label}. Watch for: ${sorted.slice(1).map((o) => o.label).join('; ')}.`);
        }
        lines.push('');
      }
      docs.push({ title: 'Eligibility verification best practices', kind: 'best_practices', topic: 'RCM', product_line: 'RCMS', content: lines.join('\n') });
    }
  }
  return docs;
}
