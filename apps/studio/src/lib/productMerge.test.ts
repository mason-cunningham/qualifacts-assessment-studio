import { describe, expect, it } from 'vitest';
import type { ProductSnapshot } from '@qq/schema';
import type { ProductExtract } from '@qq/ai';
import { applyProductChanges, diffProduct } from './productMerge';

const current: ProductSnapshot = {
  id: 'p1', name: 'RCMS', tagline: 'Revenue cycle, handled', benefits: ['Fewer denials'],
  features: [{ id: 'f_keep', name: 'Eligibility Checks', benefits: ['Old benefit'], mediaUrl: 'https://x/eligibility.gif' }],
};
const extract: ProductExtract = {
  name: 'RCMS', productLine: 'RCMS', category: 'Revenue Cycle', tagline: 'Revenue cycle, handled',
  whatItDoes: 'Runs billing end to end.', whyItMatters: '', benefits: ['Fewer denials', 'Faster cash'], ctaLabel: '',
  features: [
    { name: 'eligibility checks', solves: 'Coverage lapses before visits', summary: 'Verifies coverage daily.', benefits: ['Fewer eligibility denials'] },
    { name: 'Denial Management', solves: 'Denials pile up', summary: 'Works denials by root cause.', benefits: [] },
    { name: 'Denial management', solves: 'dup', summary: '', benefits: [] },
  ],
  sourceNotes: '',
};

describe('product AI merge', () => {
  it('lists only proposed fields and pre-ticks the changed or empty ones', () => {
    const d = diffProduct(current, '', extract);
    const byKey = Object.fromEntries(d.fields.map((f) => [f.key, f]));
    expect(Object.keys(byKey)).toEqual(['name', 'productLine', 'category', 'tagline', 'whatItDoes', 'benefits']);
    expect(byKey.tagline.defaultOn).toBe(false); // unchanged
    expect(byKey.whatItDoes.defaultOn).toBe(true); // empty today
    expect(d.features.map((f) => [f.kind, f.name])).toEqual([['update', 'eligibility checks'], ['new', 'Denial Management']]);
  });

  it('applies ticked changes, keeps existing feature ids and media, and adds new features', () => {
    const d = diffProduct(current, '', extract);
    const out = applyProductChanges(current, '', d, { fields: new Set(['category', 'whatItDoes', 'benefits']), features: new Set([0, 1]) });
    expect(out.category).toBe('Revenue Cycle');
    expect(out.p.whatItDoes).toBe('Runs billing end to end.');
    expect(out.p.benefits).toEqual(['Fewer denials', 'Faster cash']);
    expect(out.p.productLine).toBeUndefined(); // not ticked
    const [elig, denial] = out.p.features!;
    expect(elig).toMatchObject({ id: 'f_keep', name: 'Eligibility Checks', mediaUrl: 'https://x/eligibility.gif', solves: 'Coverage lapses before visits', benefits: ['Fewer eligibility denials'] });
    expect(denial).toMatchObject({ name: 'Denial Management', summary: 'Works denials by root cause.', benefits: [] });
    expect(denial.id).toMatch(/^f_/);
    expect(current.features).toHaveLength(1); // input untouched
  });
});
