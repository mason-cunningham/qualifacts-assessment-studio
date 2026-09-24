import { useEffect, useState } from 'react';
import { isChoiceType, newId, type ProductSnapshot, type RuleWhen } from '@qq/schema';
import { orderedQuestions } from '@qq/engine';
import { Field, ImageField, Modal, NumberInput, TextArea, TextInput, useToast } from '../../components/ui';
import { supabase, T } from '../../lib/supabase';
import { productFromRow, productToRow } from '../../lib/products';
import type { ProductRow } from '../../lib/types';
import { move, type EditorProps } from './helpers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SolutionsTab({ def, update, readOnly }: EditorProps) {
  const toast = useToast();
  const [library, setLibrary] = useState<ProductRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const rec = def.recommendations;
  const productName = (id: string) => def.products.find((p) => p.id === id)?.name ?? '(missing product)';

  const loadLibrary = () =>
    supabase.from(T.products).select('*').eq('is_active', true).order('name').then(({ data }) => setLibrary((data as ProductRow[]) ?? []));
  useEffect(() => { loadLibrary(); }, []);

  const isLibrary = (p: ProductSnapshot) => UUID_RE.test(p.id) && library.some((l) => l.id === p.id);

  const detach = (id: string) => {
    if (!window.confirm('Remove this product from the assessment? Any recommendations that use it are removed too.')) return;
    update((d) => {
      d.products = d.products.filter((p) => p.id !== id);
      d.sections.forEach((s) => { s.productIds = s.productIds.filter((x) => x !== id); });
      d.questions.forEach((q) => q.options.forEach((o) => {
        if (o.recommend) {
          o.recommend.productIds = o.recommend.productIds.filter((x) => x !== id);
          if (!o.recommend.productIds.length) o.recommend = undefined;
        }
      }));
      d.recommendations.rules = d.recommendations.rules.filter((r) => r.productId !== id);
    });
  };

  const saveToLibrary = async (p: ProductSnapshot) => {
    const { data, error } = await supabase.from(T.products).insert(productToRow(p)).select('*').single();
    if (error) return toast.error(error);
    const row = data as ProductRow;
    const oldId = p.id;
    update((d) => {
      const swap = (id: string) => (id === oldId ? row.id : id);
      d.products = d.products.map((x) => (x.id === oldId ? { ...productFromRow(row), priority: x.priority } : x));
      d.sections.forEach((s) => { s.productIds = s.productIds.map(swap); });
      d.questions.forEach((q) => q.options.forEach((o) => { if (o.recommend) o.recommend.productIds = o.recommend.productIds.map(swap); }));
      d.recommendations.rules.forEach((r) => { r.productId = swap(r.productId); });
    });
    loadLibrary();
    toast.ok(`${p.name} saved to the Solutions library`);
  };

  const refreshFromLibrary = () => {
    update((d) => {
      d.products = d.products.map((p) => {
        const row = library.find((l) => l.id === p.id);
        return row ? { ...productFromRow(row), priority: p.priority } : p;
      });
    });
    toast.ok('Product details refreshed from the library');
  };

  const choiceQuestions = orderedQuestions(def).filter((q) => isChoiceType(q.type) && q.role !== 'gate');

  return (
    <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        <div className="row-between">
          <div>
            <div className="card-title">Products & solutions in this assessment</div>
            <div className="card-sub">Attach products from the shared Solutions library, or create one just for this assessment. Details are snapshotted when you publish.</div>
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={refreshFromLibrary}>Refresh from library</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPicking(true)}>+ Attach from library</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
              const p: ProductSnapshot = { id: newId('p'), name: 'New product', benefits: [] };
              update((d) => { d.products.push(p); });
              setEditing(p.id);
            }}>+ Custom</button>
          </div>
        </div>
        {def.products.length === 0 && <p className="muted">No products attached yet.</p>}
        <table className="table" style={{ marginTop: 8 }}>
          <tbody>
            {def.products.map((p, i) => (
              <tr key={p.id}>
                <td style={{ width: 40 }}>
                  {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 36, height: 28, objectFit: 'cover', borderRadius: 3 }} /> : null}
                </td>
                <td>
                  <b style={{ color: 'var(--navy)' }}>{p.name}</b>
                  <div className="small muted">{p.productLine}{isLibrary(p) ? ' · Library' : ' · Custom'}</div>
                </td>
                <td style={{ width: 130 }}>
                  <label className="check small">Priority <NumberInput className="input input-sm input-num" value={p.priority} onChange={(v) => update((d) => { d.products[i].priority = v; })} /></label>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update((d) => move(d.products, i, -1))}>↑</button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => update((d) => move(d.products, i, 1))}>↓</button>
                  {!isLibrary(p) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(p.id)}>Edit</button>}
                  {!isLibrary(p) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => saveToLibrary(p)}>Save to library</button>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => detach(p.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">Lower priority numbers show first when two recommendations tie.</p>
      </div>

      {def.products.length > 0 && (
        <div className="card">
          <div className="card-title">Which products solve each section?</div>
          <div className="card-sub">Shown as "Solved by: …" on each section of the results page.</div>
          {def.sections.map((s, si) => (
            <div key={s.id} className="row" style={{ flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid #f0ebe5' }}>
              <b style={{ minWidth: 200, color: 'var(--navy)' }}>{s.name}</b>
              {def.products.map((p) => (
                <label key={p.id} className="check small">
                  <input type="checkbox" checked={s.productIds.includes(p.id)} onChange={(e) => update((d) => {
                    const ids = d.sections[si].productIds;
                    d.sections[si].productIds = e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id);
                  })} />
                  {p.name}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">Recommendation cards</div>
        <label className="check" style={{ margin: '6px 0 12px' }}>
          <input type="checkbox" checked={rec.enabled} onChange={(e) => update((d) => { d.recommendations.enabled = e.target.checked; })} />
          Show recommended products on the results page
        </label>
        {rec.enabled && (
          <>
            <div className="grid grid-2">
              <Field label="Heading"><TextInput value={rec.heading} onChange={(v) => update((d) => { d.recommendations.heading = v; })} /></Field>
              <Field label="Max cards (optional)"><NumberInput value={rec.maxShown} min={1} onChange={(v) => update((d) => { d.recommendations.maxShown = v; })} /></Field>
            </div>
            <Field label="Intro" hint="e.g. Here are the **{{recommendationCount}}** workflows you're missing out on."><TextArea rows={2} value={rec.intro} onChange={(v) => update((d) => { d.recommendations.intro = v || undefined; })} /></Field>
            <Field label="Message when nothing is recommended"><TextArea rows={2} value={rec.emptyMessage} onChange={(v) => update((d) => { d.recommendations.emptyMessage = v || undefined; })} /></Field>
            <Field label="Default card button label" hint="Used when a product has a CTA URL but no label."><TextInput value={rec.ctaLabel} onChange={(v) => update((d) => { d.recommendations.ctaLabel = v || undefined; })} /></Field>
          </>
        )}
      </div>

      {rec.enabled && def.products.length > 0 && (
        <>
          <div className="card">
            <div className="card-title">Recommend by answer</div>
            <div className="card-sub">Pick a product for any answer that signals a need. "Rank" orders cards (lower first), e.g. 0 = Top Priority, 5 = Opportunity.</div>
            {choiceQuestions.map((q) => (
              <div key={q.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0ebe5' }}>
                <b className="small" style={{ color: 'var(--navy)' }}>{q.shortLabel || q.text}</b>
                {q.options.map((o) => {
                  const r = o.recommend;
                  const setR = (fn: (x: NonNullable<typeof r>) => void) => update((d) => {
                    const opt = d.questions.find((x) => x.id === q.id)!.options.find((x) => x.id === o.id)!;
                    const next = structuredClone(opt.recommend ?? { productIds: [] });
                    fn(next);
                    opt.recommend = next.productIds.length ? next : undefined;
                  });
                  return (
                    <div key={o.id} className="row small" style={{ flexWrap: 'wrap', padding: '3px 0 3px 12px' }}>
                      <span style={{ flex: 2, minWidth: 180 }}>{o.label || '(blank)'}</span>
                      <select className="select input-sm" style={{ flex: 1, minWidth: 160 }} value={r?.productIds[0] ?? ''}
                        onChange={(e) => setR((x) => { x.productIds = e.target.value ? [e.target.value] : []; })}>
                        <option value="">No recommendation</option>
                        {def.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {r && (
                        <>
                          <input className="input input-sm" style={{ width: 130 }} placeholder="Badge" value={r.badge ?? ''} onChange={(e) => setR((x) => { x.badge = e.target.value || undefined; })} />
                          <label className="check small">Rank <NumberInput className="input input-sm input-num" value={r.rank} onChange={(v) => setR((x) => { x.rank = v; })} /></label>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">Recommend by score</div>
            <div className="card-sub">Rules based on section scores or gap counts, e.g. "recommend RCMS when Revenue Cycle is below 60%".</div>
            {rec.rules.map((rule, i) => (
              <div key={rule.id} className="rule-box" style={{ marginBottom: 8 }}>
                <div className="row small" style={{ flexWrap: 'wrap' }}>
                  Recommend
                  <select className="select input-sm" style={{ width: 'auto' }} value={rule.productId} onChange={(e) => update((d) => { d.recommendations.rules[i].productId = e.target.value; })}>
                    {!def.products.some((p) => p.id === rule.productId) && <option value={rule.productId}>{productName(rule.productId)}</option>}
                    {def.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  when
                  <RuleWhenEditor def={def} when={rule.when} onChange={(w) => update((d) => { d.recommendations.rules[i].when = w; })} />
                  <input className="input input-sm" style={{ width: 120 }} placeholder="Badge" value={rule.badge ?? ''} onChange={(e) => update((d) => { d.recommendations.rules[i].badge = e.target.value || undefined; })} />
                  <label className="check small">Rank <NumberInput className="input input-sm input-num" value={rule.rank} onChange={(v) => update((d) => { d.recommendations.rules[i].rank = v; })} /></label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => update((d) => { d.recommendations.rules.splice(i, 1); })}>Remove</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => update((d) => {
              d.recommendations.rules.push({ id: newId('r'), productId: d.products[0].id, when: { type: 'sectionBelow', sectionId: d.sections[0]?.id ?? '', pct: 60 } });
            })}>+ Add rule</button>
          </div>
        </>
      )}

      {picking && (
        <Modal title="Attach from the Solutions library" onClose={() => setPicking(false)} wide>
          {library.length === 0 ? (
            <p className="muted">The library is empty. Add products on the Solutions library page, or create a custom product here.</p>
          ) : (
            <table className="table">
              <tbody>
                {library.map((l) => {
                  const attached = def.products.some((p) => p.id === l.id);
                  return (
                    <tr key={l.id}>
                      <td><b style={{ color: 'var(--navy)' }}>{l.name}</b><div className="small muted">{[l.product_line, l.category].filter(Boolean).join(' · ')}</div></td>
                      <td className="small muted">{l.what_it_does?.slice(0, 120)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className={`btn btn-sm ${attached ? 'btn-ghost' : 'btn-primary'}`} disabled={attached}
                          onClick={() => update((d) => { d.products.push({ ...productFromRow(l), priority: d.products.length + 1 }); })}>
                          {attached ? 'Attached' : 'Attach'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {editing && (() => {
        const i = def.products.findIndex((p) => p.id === editing);
        if (i < 0) return null;
        const p = def.products[i];
        const set = (fn: (x: ProductSnapshot) => void) => update((d) => fn(d.products[i]));
        return (
          <Modal title={`Edit ${p.name}`} onClose={() => setEditing(null)} wide footer={<button className="btn btn-primary" onClick={() => setEditing(null)}>Done</button>}>
            <ProductFields p={p} set={set} />
          </Modal>
        );
      })()}
    </fieldset>
  );
}

export function ProductFields({ p, set }: { p: ProductSnapshot; set: (fn: (x: ProductSnapshot) => void) => void }) {
  return (
    <>
      <div className="grid grid-2">
        <Field label="Name"><TextInput value={p.name} onChange={(v) => set((x) => { x.name = v; })} /></Field>
        <Field label="Product line"><TextInput value={p.productLine} onChange={(v) => set((x) => { x.productLine = v || undefined; })} placeholder="InSync, CareLogic, Credible…" /></Field>
      </div>
      <Field label="Tagline"><TextInput value={p.tagline} onChange={(v) => set((x) => { x.tagline = v || undefined; })} /></Field>
      <Field label="What it does"><TextArea rows={3} value={p.whatItDoes} onChange={(v) => set((x) => { x.whatItDoes = v || undefined; })} /></Field>
      <Field label="Why it matters"><TextArea rows={3} value={p.whyItMatters} onChange={(v) => set((x) => { x.whyItMatters = v || undefined; })} /></Field>
      <Field label="Benefits (one per line)"><TextArea rows={4} value={p.benefits.join('\n')} onChange={(v) => set((x) => { x.benefits = v.split('\n'); })} /></Field>
      <ImageField label="Screenshot / image" folder="products" value={p.imageUrl} onChange={(v) => set((x) => { x.imageUrl = v; })} />
      <div className="grid grid-2">
        <Field label="Button label"><TextInput value={p.ctaLabel} onChange={(v) => set((x) => { x.ctaLabel = v || undefined; })} placeholder="Learn more" /></Field>
        <Field label="Button URL"><TextInput value={p.ctaUrl} onChange={(v) => set((x) => { x.ctaUrl = v || undefined; })} placeholder="https://" /></Field>
      </div>
    </>
  );
}

function RuleWhenEditor({ def, when, onChange }: { def: EditorProps['def']; when: RuleWhen; onChange: (w: RuleWhen) => void }) {
  return (
    <>
      <select className="select input-sm" style={{ width: 'auto' }} value={when.type} onChange={(e) => {
        const t = e.target.value as RuleWhen['type'];
        if (t === 'sectionBelow') onChange({ type: t, sectionId: def.sections[0]?.id ?? '', pct: 60 });
        else if (t === 'gapCountAtLeast') onChange({ type: t, count: 1 });
        else if (t === 'overallBelow') onChange({ type: t, value: 60 });
        else onChange({ type: 'always' });
      }}>
        <option value="sectionBelow">a section scores below</option>
        <option value="gapCountAtLeast">gap count is at least</option>
        <option value="overallBelow">overall score is below</option>
        <option value="always">always</option>
        {when.type === 'optionSelected' && <option value="optionSelected">an answer is chosen</option>}
      </select>
      {when.type === 'sectionBelow' && (
        <>
          <select className="select input-sm" style={{ width: 'auto' }} value={when.sectionId} onChange={(e) => onChange({ ...when, sectionId: e.target.value })}>
            {def.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <NumberInput className="input input-sm input-num" value={when.pct} onChange={(v) => onChange({ ...when, pct: v ?? 60 })} />%
        </>
      )}
      {when.type === 'gapCountAtLeast' && (
        <>
          <NumberInput className="input input-sm input-num" value={when.count} onChange={(v) => onChange({ ...when, count: v ?? 1 })} />
          in
          <select className="select input-sm" style={{ width: 'auto' }} value={when.sectionId ?? ''} onChange={(e) => onChange({ ...when, sectionId: e.target.value || undefined })}>
            <option value="">any section</option>
            {def.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}
      {when.type === 'overallBelow' && <NumberInput className="input input-sm input-num" value={when.value} onChange={(v) => onChange({ ...when, value: v ?? 60 })} />}
    </>
  );
}
