import { useRef, useState } from 'react';
import type { ProductSnapshot } from '@qq/schema';
import { AI_LIMITS, type ProductExtract } from '@qq/ai';
import { runAi } from '../lib/ai';
import { ACCEPTED_CONTEXT_FILES, prepareFile, splitPrepared, type PreparedFile } from '../lib/files';
import { applyProductChanges, diffProduct, type ProductFieldKey } from '../lib/productMerge';
import { useToast } from './ui';

/**
 * "Fill from files with AI" for a Solutions-library product: read pitch decks / messaging
 * guides, propose fields + feature sets, and let the creator pick what to apply. Nothing is
 * saved until the product itself is saved.
 */
export function ProductAiFill({ p, category, onApply }: {
  p: ProductSnapshot;
  category: string;
  onApply: (next: { p: ProductSnapshot; category: string }) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PreparedFile[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProductExtract | null>(null);
  const [pickFields, setPickFields] = useState<Set<ProductFieldKey>>(new Set());
  const [pickFeatures, setPickFeatures] = useState<Set<number>>(new Set());

  const diff = proposal ? diffProduct(p, category, proposal) : null;

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy('Reading files');
    try {
      for (const f of Array.from(list)) {
        if (files.length >= AI_LIMITS.maxFiles) { toast.error(`Attach at most ${AI_LIMITS.maxFiles} files.`); break; }
        const prepared = await prepareFile(f);
        setFiles((cur) => [...cur, prepared]);
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const analyze = async () => {
    if (!files.length) return toast.error('Add at least one file.');
    setBusy('Starting');
    try {
      const { data } = await runAi(
        {
          mode: 'extract_product',
          ...splitPrepared(files),
          hint: note.trim(),
          current: { name: p.name, productLine: p.productLine, features: (p.features ?? []).map((f) => ({ name: f.name })) },
        },
        { onProgress: (phase) => setBusy(phase) },
      );
      const d = diffProduct(p, category, data);
      setProposal(data);
      setPickFields(new Set(d.fields.filter((f) => f.defaultOn).map((f) => f.key)));
      setPickFeatures(new Set(d.features.filter((f) => f.defaultOn).map((f) => f.index)));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
    if (!diff) return;
    onApply(applyProductChanges(p, category, diff, { fields: pickFields, features: pickFeatures }));
    toast.ok('Applied. Review the fields, add feature images, then Save.');
    setProposal(null);
    setFiles([]);
    setOpen(false);
  };

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const n = new Set(set);
    if (on) n.add(v); else n.delete(v);
    return n;
  };

  if (!open) {
    return (
      <div className="subtle-box row-between" style={{ padding: '12px 14px', marginBottom: 16 }}>
        <div className="small">
          <b style={{ color: 'var(--navy)' }}>Fill from files with AI</b>
          <div className="muted">Upload a pitch deck, messaging guide or one-pager. AI suggests the fields and feature sets for you to review.</div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Start</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16, boxShadow: 'none', border: '1px solid var(--s-line)' }}>
      <div className="row-between">
        <div className="card-title">Fill from files with AI</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setProposal(null); }}>Close</button>
      </div>

      {!proposal && (
        <>
          <div className="card-sub">Up to {AI_LIMITS.maxFiles} files: PDF, PowerPoint, Word, Excel, TXT or Markdown. Tip: export visual-heavy decks to PDF so AI can see the slides.</div>
          <div className="stack" style={{ gap: 6 }}>
            {files.map((f, i) => (
              <div key={i} className="row-between small subtle-box" style={{ padding: '8px 12px' }}>
                <span>📄 {f.kind === 'stored' ? f.file.name : f.attachment.name} <span className="muted">({f.kind === 'stored' ? `${Math.round(f.size / 1024)} KB PDF` : `${Math.round(f.size / 1000)}k chars`})</span></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => fileRef.current?.click()}>+ Add files</button>
            <input ref={fileRef} type="file" hidden multiple accept={ACCEPTED_CONTEXT_FILES} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Note for the AI (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Only the Eligibility module; skip pricing slides" />
          </div>
          <button type="button" className="btn btn-primary" disabled={!files.length || !!busy} onClick={analyze}>
            {busy ? `${busy}…` : 'Analyze files'}
          </button>
        </>
      )}

      {proposal && diff && (
        <>
          <div className="card-sub">Tick what to apply. Nothing is saved until you click Save. Existing feature images are kept.</div>
          {proposal.sourceNotes && <p className="small muted" style={{ marginTop: 0 }}>{proposal.sourceNotes}</p>}
          {diff.fields.length > 0 && (
            <div className="table-wrap" style={{ boxShadow: 'none', border: '1px solid var(--s-line)', marginBottom: 12 }}>
              <table className="table">
                <thead><tr><th /><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
                <tbody>
                  {diff.fields.map((f) => (
                    <tr key={f.key}>
                      <td style={{ width: 32 }}><input type="checkbox" checked={pickFields.has(f.key)} onChange={(e) => setPickFields((s) => toggle(s, f.key, e.target.checked))} /></td>
                      <td><b className="small" style={{ color: 'var(--navy)' }}>{f.label}</b></td>
                      <td className="small muted" style={{ whiteSpace: 'pre-line', maxWidth: 260 }}>{f.current || '—'}</td>
                      <td className="small" style={{ whiteSpace: 'pre-line', maxWidth: 320 }}>{f.proposed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {diff.features.length > 0 && (
            <>
              <div className="label" style={{ margin: '4px 0 8px' }}>Feature sets</div>
              <div className="stack" style={{ gap: 6 }}>
                {diff.features.map((f) => (
                  <label key={f.index} className={`check pick-row ${pickFeatures.has(f.index) ? 'on' : ''}`} style={{ alignItems: 'flex-start', padding: '8px 10px' }}>
                    <input type="checkbox" checked={pickFeatures.has(f.index)} onChange={(e) => setPickFeatures((s) => toggle(s, f.index, e.target.checked))} />
                    <span style={{ flex: 1 }}>
                      <b style={{ color: 'var(--navy)' }}>{f.name}</b>{' '}
                      <span className={`pill ${f.kind === 'new' ? 'pill-published' : 'pill-neutral'}`}>{f.kind === 'new' ? 'New' : 'Update'}</span>
                      {f.proposed.solves && <div className="small"><b>Solves:</b> {f.proposed.solves}</div>}
                      {f.proposed.summary && <div className="small muted">{f.proposed.summary}</div>}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={!pickFields.size && !pickFeatures.size}>Apply selected</button>
            <button type="button" className="btn btn-ghost" onClick={() => setProposal(null)}>Back to files</button>
          </div>
        </>
      )}
    </div>
  );
}
