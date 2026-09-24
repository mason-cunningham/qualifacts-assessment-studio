import { useEffect, useMemo, useState } from 'react';
import type { ProductSnapshot } from '@qq/schema';
import { BUILT_IN_TEMPLATES } from '@qq/templates';
import { TopBar } from '../components/Layout';
import { Loading, Modal, useToast } from '../components/ui';
import { supabase, T } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { productFromRow, productToRow } from '../lib/products';
import type { ProductRow } from '../lib/types';
import { ProductFields } from './editor/SolutionsTab';

export function ProductsPage() {
  const { canEdit, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<ProductRow[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; p: ProductSnapshot; category: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from(T.products).select('*').order('product_line').order('name').then(({ data }) => setRows((data as ProductRow[]) ?? []));
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !t || `${r.name} ${r.product_line ?? ''} ${r.category ?? ''}`.toLowerCase().includes(t));
  }, [rows, q]);

  const save = async () => {
    if (!editing) return;
    if (!editing.p.name.trim()) return toast.error('Give the product a name.');
    setBusy(true);
    const payload = { ...productToRow(editing.p), category: editing.category || null };
    const res = editing.id
      ? await supabase.from(T.products).update(payload).eq('id', editing.id)
      : await supabase.from(T.products).insert(payload);
    setBusy(false);
    if (res.error) return toast.error(res.error);
    toast.ok('Saved. Assessments pick up changes when they are next published.');
    setEditing(null);
    load();
  };

  const toggleActive = async (r: ProductRow) => {
    const { error } = await supabase.from(T.products).update({ is_active: !r.is_active }).eq('id', r.id);
    if (error) return toast.error(error);
    load();
  };

  const remove = async (r: ProductRow) => {
    if (!window.confirm(`Delete ${r.name}? Published assessments keep their snapshot, but drafts will lose the link to the library.`)) return;
    const { error } = await supabase.from(T.products).delete().eq('id', r.id);
    if (error) return toast.error(error);
    load();
  };

  const seed = async () => {
    const existing = new Set((rows ?? []).map((r) => r.name.toLowerCase()));
    const fromTemplates = BUILT_IN_TEMPLATES.flatMap((t) => t.definition.products).filter((p) => p.whatItDoes && !existing.has(p.name.toLowerCase()));
    if (!fromTemplates.length) return toast.ok('Everything from the templates is already in the library.');
    const { error } = await supabase.from(T.products).insert(fromTemplates.map((p) => ({ ...productToRow(p), category: 'Client Engagement' })));
    if (error) return toast.error(error);
    toast.ok(`Added ${fromTemplates.length} products from the CES template`);
    load();
  };

  return (
    <>
      <TopBar title="Solutions library">
        {canEdit && <button className="btn btn-secondary btn-sm" onClick={seed}>Import from templates</button>}
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing({ id: null, p: { id: '', name: '', benefits: [] }, category: '' })}>+ New product</button>}
      </TopBar>
      <div className="s-page">
        <p className="muted" style={{ marginTop: 0 }}>
          Products and features you can recommend in any assessment. Maintain them once here. Each assessment snapshots the details when it's published.
        </p>
        <input className="input" style={{ maxWidth: 320, marginBottom: 14 }} placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
        {!rows ? <Loading /> : filtered.length === 0 ? (
          <div className="card empty"><h3>No products yet</h3><p>Add your first product, or import the CES features from the built-in template.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th /><th>Product</th><th>Line</th><th>Category</th><th>What it does</th><th /></tr></thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td style={{ width: 60 }}>{r.image_url && <img src={r.image_url} alt="" style={{ width: 52, height: 36, objectFit: 'cover', borderRadius: 4 }} />}</td>
                    <td><b style={{ color: 'var(--navy)' }}>{r.name}</b>{!r.is_active && <div className="small muted">Inactive</div>}</td>
                    <td>{r.product_line}</td>
                    <td>{r.category}</td>
                    <td className="small muted" style={{ maxWidth: 420 }}>{r.what_it_does?.slice(0, 160)}{(r.what_it_does?.length ?? 0) > 160 ? '…' : ''}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {canEdit && <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ id: r.id, p: productFromRow(r), category: r.category ?? '' })}>Edit</button>}
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
      {editing && (
        <Modal
          title={editing.id ? `Edit ${editing.p.name}` : 'New product'}
          onClose={() => setEditing(null)}
          wide
          footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}
        >
          <ProductFields p={editing.p} set={(fn) => setEditing((e) => { if (!e) return e; const p = structuredClone(e.p); fn(p); return { ...e, p }; })} />
          <div className="field">
            <label>Category</label>
            <input className="input" value={editing.category} onChange={(e) => setEditing((x) => x && { ...x, category: e.target.value })} placeholder="Revenue Cycle, Clinical, Client Engagement…" />
          </div>
        </Modal>
      )}
    </>
  );
}
