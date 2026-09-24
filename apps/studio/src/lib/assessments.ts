import { parseDefinition, slugify, type AssessmentDefinition } from '@qq/schema';
import { supabase, T } from './supabase';
import type { AssessmentRow } from './types';

/** Paths used by the site itself, so they can't be assessment links. Keep in sync with supabase/schema.sql. */
export const RESERVED_SLUGS = ['studio', 'assets', 'api', 'admin', 'favicon', 'index'];

export async function uniqueSlug(base: string): Promise<string> {
  let root = slugify(base) || 'assessment';
  if (RESERVED_SLUGS.includes(root)) root = `${root}-assessment`;
  const { data } = await supabase.from(T.assessments).select('slug').like('slug', `${root}%`);
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 500; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

export async function isSlugAvailable(slug: string, exceptId?: string): Promise<boolean> {
  if (RESERVED_SLUGS.includes(slug)) return false;
  let q = supabase.from(T.assessments).select('id').eq('slug', slug);
  if (exceptId) q = q.neq('id', exceptId);
  const { data } = await q;
  return !data || data.length === 0;
}

export async function createAssessment(
  def: AssessmentDefinition,
  opts: { slug?: string; internalName?: string; extraSettings?: Record<string, unknown> } = {},
): Promise<AssessmentRow> {
  const slug = opts.slug ? slugify(opts.slug) : await uniqueSlug(def.meta.title);
  if (RESERVED_SLUGS.includes(slug)) throw new Error(`"${slug}" is reserved by the site. Choose another link.`);
  const { data, error } = await supabase
    .from(T.assessments)
    .insert({
      slug,
      title: def.meta.title,
      internal_name: opts.internalName ?? null,
      description: def.meta.description ?? null,
      product_line: def.meta.productLine ?? null,
      status: 'draft',
      draft_definition: def,
      settings: {
        alerts: { enabled: true, extra_recipients: [] },
        crm: { enabled: false, object: 'Lead', lead_source: 'Assessment' },
        ...(opts.extraSettings ?? {}),
      },
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`The link "${slug}" is already taken. Choose another.`);
    throw error;
  }
  return data as AssessmentRow;
}

export async function duplicateAssessment(row: AssessmentRow): Promise<AssessmentRow> {
  const parsed = parseDefinition(row.draft_definition);
  if (!parsed.ok || !parsed.definition) throw new Error('This assessment could not be read.');
  const def = { ...parsed.definition, meta: { ...parsed.definition.meta, title: `${parsed.definition.meta.title} (copy)` } };
  return createAssessment(def, { slug: await uniqueSlug(`${row.slug}-copy`) });
}

export function readDefinition(raw: unknown): AssessmentDefinition | null {
  const res = parseDefinition(raw);
  if (!res.ok) console.warn('Definition parse errors', res.errors);
  return res.definition ?? null;
}
