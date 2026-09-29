import { newId, type ProductFeature, type ProductSnapshot } from '@qq/schema';
import type { ProductExtract } from '@qq/ai';

// "Fill from files with AI": compare the AI's proposal with the product being edited,
// let the creator pick what to keep, then merge. Pure so it can be unit-tested.

export type ProductFieldKey = 'name' | 'productLine' | 'category' | 'tagline' | 'whatItDoes' | 'whyItMatters' | 'benefits' | 'ctaLabel';

export interface FieldChange {
  key: ProductFieldKey;
  label: string;
  current: string;
  proposed: string;
  /** Pre-ticked when the field is empty today or the proposal differs */
  defaultOn: boolean;
}

export interface FeatureChange {
  /** Index in extract.features */
  index: number;
  kind: 'new' | 'update';
  /** Existing feature id when kind === 'update' */
  existingId?: string;
  name: string;
  current?: ProductFeature;
  proposed: ProductExtract['features'][number];
  defaultOn: boolean;
}

const FIELDS: [ProductFieldKey, string][] = [
  ['name', 'Name'], ['productLine', 'Product line'], ['category', 'Category'], ['tagline', 'Tagline'],
  ['whatItDoes', 'What it does'], ['whyItMatters', 'Why it matters'], ['benefits', 'Benefits'], ['ctaLabel', 'Button label'],
];

const norm = (s: string | undefined) => (s ?? '').trim();
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function currentValue(p: ProductSnapshot, category: string, k: ProductFieldKey): string {
  if (k === 'category') return norm(category);
  if (k === 'benefits') return p.benefits.map(norm).filter(Boolean).join('\n');
  return norm(p[k]);
}

function proposedValue(x: ProductExtract, k: ProductFieldKey): string {
  if (k === 'benefits') return x.benefits.map(norm).filter(Boolean).join('\n');
  return norm(x[k]);
}

export function diffProduct(p: ProductSnapshot, category: string, x: ProductExtract): { fields: FieldChange[]; features: FeatureChange[] } {
  const fields = FIELDS.map(([k, label]) => {
    const current = currentValue(p, category, k);
    const proposed = proposedValue(x, k);
    return { key: k, label, current, proposed, defaultOn: !!proposed && proposed !== current };
  }).filter((f) => f.proposed);

  const existing = new Map((p.features ?? []).map((f) => [key(f.name), f]));
  const seen = new Set<string>();
  const features: FeatureChange[] = [];
  x.features.forEach((f, index) => {
    const name = norm(f.name);
    if (!name || seen.has(key(name))) return;
    seen.add(key(name));
    const cur = existing.get(key(name));
    features.push({ index, kind: cur ? 'update' : 'new', existingId: cur?.id, name, current: cur, proposed: f, defaultOn: true });
  });
  return { fields, features };
}

/** Apply the ticked changes. Existing feature ids and images are always kept. */
export function applyProductChanges(
  p: ProductSnapshot,
  category: string,
  diff: { fields: FieldChange[]; features: FeatureChange[] },
  picked: { fields: Set<ProductFieldKey>; features: Set<number> },
): { p: ProductSnapshot; category: string } {
  const next = structuredClone(p);
  let nextCategory = category;
  for (const f of diff.fields) {
    if (!picked.fields.has(f.key)) continue;
    if (f.key === 'category') nextCategory = f.proposed;
    else if (f.key === 'benefits') next.benefits = f.proposed.split('\n');
    else if (f.key === 'name') next.name = f.proposed;
    else next[f.key] = f.proposed;
  }
  const features = [...(next.features ?? [])];
  for (const c of diff.features) {
    if (!picked.features.has(c.index)) continue;
    const pr = c.proposed;
    const benefits = pr.benefits.map(norm).filter(Boolean);
    if (c.kind === 'update' && c.existingId) {
      const i = features.findIndex((f) => f.id === c.existingId);
      if (i < 0) continue;
      features[i] = {
        ...features[i],
        solves: norm(pr.solves) || features[i].solves,
        summary: norm(pr.summary) || features[i].summary,
        benefits: benefits.length ? benefits : features[i].benefits,
      };
    } else {
      features.push({ id: newId('f'), name: c.name, solves: norm(pr.solves) || undefined, summary: norm(pr.summary) || undefined, benefits });
    }
  }
  next.features = features;
  return { p: next, category: nextCategory };
}
