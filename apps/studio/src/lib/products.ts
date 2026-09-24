import type { AssessmentDefinition, ProductSnapshot } from '@qq/schema';
import { supabase, T } from './supabase';
import type { ProductRow } from './types';

export function productFromRow(r: ProductRow): ProductSnapshot {
  return {
    id: r.id,
    name: r.name,
    productLine: r.product_line ?? undefined,
    tagline: r.tagline ?? undefined,
    whatItDoes: r.what_it_does ?? undefined,
    whyItMatters: r.why_it_matters ?? undefined,
    benefits: (r.benefits ?? []).filter((b) => b.trim()),
    imageUrl: r.image_url ?? undefined,
    logoUrl: r.logo_url ?? undefined,
    ctaLabel: r.cta_label ?? undefined,
    ctaUrl: r.cta_url ?? undefined,
  };
}

export function productToRow(p: ProductSnapshot): Partial<ProductRow> {
  return {
    name: p.name,
    product_line: p.productLine ?? null,
    tagline: p.tagline ?? null,
    what_it_does: p.whatItDoes ?? null,
    why_it_matters: p.whyItMatters ?? null,
    benefits: p.benefits.filter((b) => b.trim()),
    image_url: p.imageUrl ?? null,
    logo_url: p.logoUrl ?? null,
    cta_label: p.ctaLabel ?? null,
    cta_url: p.ctaUrl ?? null,
  };
}

/**
 * Prepare a definition for publishing: refresh library-backed product snapshots
 * (keeping per-assessment priority) and tidy blank list entries.
 */
export async function resolveForPublish(def: AssessmentDefinition): Promise<AssessmentDefinition> {
  const out = structuredClone(def);
  const ids = out.products.map((p) => p.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length) {
    const { data } = await supabase.from(T.products).select('*').in('id', ids);
    const rows = new Map(((data as ProductRow[]) ?? []).map((r) => [r.id, r]));
    out.products = out.products.map((p) => {
      const r = rows.get(p.id);
      return r ? { ...productFromRow(r), priority: p.priority } : p;
    });
  }
  out.products.forEach((p) => { p.benefits = p.benefits.filter((b) => b.trim()); });
  out.intro.bullets = out.intro.bullets.filter((b) => b.trim());
  out.leadCapture.fields.forEach((f) => { if (f.options) f.options = f.options.filter((o) => o.trim()); });
  return out;
}
