import { newId, parseDefinition, type AssessmentDefinition } from '@qq/schema';
import { validateDefinition } from '@qq/engine';
import type { AssessmentEdit } from './schemas';

// ─────────────────────────────────────────────────────────────────────────────
// Scoped AI edits. Claude never rewrites the whole assessment: it returns targeted
// operations addressed by stable ids, e.g.
//   set     questions/q_ab12/options/o_9/label   value "\"Rarely\""
//   insert  questions                            value "{…question…}"  afterId "q_ab12"
//   remove  questions/q_ab12/options/o_9
//   move    sections/s_2                         afterId ""  (to the start)
// Each change is applied on its own; one that can't be resolved, or that would make
// the assessment invalid, is rejected with a reason while the others still apply.
// ─────────────────────────────────────────────────────────────────────────────

export type EditChange = AssessmentEdit['changes'][number];

export interface ChangeResult {
  index: number;
  ok: boolean;
  /** Why it was rejected (when !ok) */
  reason?: string;
  before?: unknown;
  after?: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Id prefix for items inserted into each kind of list */
const ID_PREFIX: Record<string, string> = {
  questions: 'q', options: 'o', sections: 's', tiers: 't', sectionTiers: 't', insights: 'i', rules: 'r', features: 'f', products: 'p',
};
/** Arrays whose items are addressed by `key` instead of `id` */
const KEYED_BY: Record<string, string> = { fields: 'key' };
/** Fields the AI may never set directly */
const LOCKED_FIELDS = new Set(['id', 'schemaVersion']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t);
  } catch {
    return raw; // plain text is fine for string fields
  }
}

function findIndex(arr: unknown[], listName: string, seg: string): number {
  const key = KEYED_BY[listName] ?? 'id';
  const i = arr.findIndex((x) => isObj(x) && String(x[key]) === seg);
  if (i >= 0) return i;
  // Fall back to a numeric position only for lists of plain values (e.g. bullets)
  if (/^\d+$/.test(seg) && arr.length && !isObj(arr[0])) return Number(seg) < arr.length ? Number(seg) : -1;
  return -1;
}

interface Resolved {
  /** Container that holds the last segment (object or array) */
  parent: Obj | unknown[];
  /** Property name (object) or index (array) */
  key: string | number;
  /** Name of the list the target lives in (for arrays) */
  listName: string;
}

/** Walk an id-based path. Returns the parent + key of the last segment. */
function resolve(root: Obj, path: string): Resolved | string {
  const segs = path.split('/').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return 'Empty target';
  let cur: unknown = root;
  let listName = '';
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (Array.isArray(cur)) {
      const idx = findIndex(cur, listName, seg);
      if (idx < 0) return `Couldn't find "${seg}" in ${listName}`;
      cur = cur[idx];
    } else if (isObj(cur)) {
      if (!(seg in cur)) {
        // Allow creating optional nested objects (e.g. results.primaryCta)
        cur[seg] = {};
      }
      listName = seg;
      cur = cur[seg];
    } else {
      return `"${segs.slice(0, i + 1).join('/')}" isn't something that can be edited`;
    }
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(cur)) {
    const idx = findIndex(cur, listName, last);
    if (idx < 0) return `Couldn't find "${last}" in ${listName}`;
    return { parent: cur, key: idx, listName };
  }
  if (isObj(cur)) return { parent: cur, key: last, listName: last };
  return `"${path}" isn't something that can be edited`;
}

/** Give inserted items (and their options/features) fresh ids where missing. */
function withIds(value: unknown, listName: string): unknown {
  if (!isObj(value)) return value;
  const v = { ...value };
  const prefix = ID_PREFIX[listName];
  if (prefix && (typeof v.id !== 'string' || !v.id.trim())) v.id = newId(prefix);
  for (const [k, child] of Object.entries(v)) {
    if (Array.isArray(child) && ID_PREFIX[k]) v[k] = child.map((c) => withIds(c, k));
  }
  return v;
}

function isProtected(path: string): string | null {
  const segs = path.split('/').filter(Boolean);
  if (segs[0] === 'products' && segs[1] && UUID_RE.test(segs[1])) {
    return 'Library products are edited in the Solutions library, not here.';
  }
  if (LOCKED_FIELDS.has(segs[segs.length - 1] ?? '')) return "Ids can't be changed.";
  return null;
}

function applyOne(def: Obj, c: EditChange): { before?: unknown; after?: unknown } | string {
  const blocked = isProtected(c.target);
  if (blocked) return blocked;
  const r = resolve(def, c.target);
  if (typeof r === 'string') return r;
  const { parent, key, listName } = r;

  switch (c.action) {
    case 'set': {
      const value = parseValue(c.value);
      if (Array.isArray(parent)) {
        const before = parent[key as number];
        // Setting a whole list item keeps its id
        parent[key as number] = isObj(before) && isObj(value) ? { ...value, id: before.id } : value;
        return { before, after: parent[key as number] };
      }
      const before = parent[key as string];
      if (value === null) delete parent[key as string];
      else parent[key as string] = value;
      return { before, after: value };
    }
    case 'insert': {
      // Target is the list itself (e.g. "questions" or "questions/q_1/options")
      const list = Array.isArray(parent) ? null : parent[key as string];
      if (!Array.isArray(list)) return `"${c.target}" isn't a list you can add to`;
      const item = withIds(parseValue(c.value), key as string);
      const after = c.afterId.trim();
      let at = list.length;
      if (after === '^' || after.toLowerCase() === 'start') at = 0;
      else if (after) {
        const idx = findIndex(list, key as string, after);
        if (idx < 0) return `Couldn't find "${after}" to insert after`;
        at = idx + 1;
      }
      list.splice(at, 0, item);
      return { before: undefined, after: item };
    }
    case 'remove': {
      if (!Array.isArray(parent)) {
        const before = parent[key as string];
        delete parent[key as string];
        return { before, after: undefined };
      }
      const [removed] = parent.splice(key as number, 1);
      return { before: removed, after: undefined };
    }
    case 'move': {
      if (!Array.isArray(parent)) return 'Only list items can be moved';
      const [item] = parent.splice(key as number, 1);
      const after = c.afterId.trim();
      let at = 0;
      if (after && after !== '^' && after.toLowerCase() !== 'start') {
        const idx = findIndex(parent, listName, after);
        if (idx < 0) {
          parent.splice(key as number, 0, item);
          return `Couldn't find "${after}" to move after`;
        }
        at = idx + 1;
      }
      parent.splice(at, 0, item);
      return { before: key, after: at };
    }
    default:
      return `Unknown action "${String((c as { action: unknown }).action)}"`;
  }
}

const errorCount = (d: AssessmentDefinition) => validateDefinition(d).filter((i) => i.level === 'error').length;

/**
 * Apply the selected changes in order. Each is tried on its own copy; it's kept only if the
 * result still parses and doesn't add validation errors. Untouched fields are left as they were.
 */
export function applyEdits(
  def: AssessmentDefinition,
  changes: EditChange[],
  selected: (i: number) => boolean = () => true,
): { definition: AssessmentDefinition; results: ChangeResult[] } {
  let current = structuredClone(def);
  let currentErrors = errorCount(current);
  const results: ChangeResult[] = [];

  changes.forEach((c, index) => {
    if (!selected(index)) return;
    const draft = structuredClone(current) as unknown as Obj;
    const out = applyOne(draft, c);
    if (typeof out === 'string') {
      results.push({ index, ok: false, reason: out });
      return;
    }
    const parsed = parseDefinition(draft);
    if (!parsed.ok || !parsed.definition) {
      results.push({ index, ok: false, reason: `That change doesn't fit the assessment format (${(parsed.errors ?? [])[0] ?? 'invalid'}).` });
      return;
    }
    const errs = errorCount(parsed.definition);
    if (errs > currentErrors) {
      const added = validateDefinition(parsed.definition).find((i) => i.level === 'error' && !validateDefinition(current).some((x) => x.message === i.message));
      results.push({ index, ok: false, reason: `That change would cause a problem: ${added?.message ?? 'it breaks a publish check'}` });
      return;
    }
    current = parsed.definition;
    currentErrors = errs;
    results.push({ index, ok: true, before: out.before, after: out.after });
  });

  return { definition: current, results };
}

/** Before/after for each proposed change, without committing anything (for the review list). */
export function previewEdits(def: AssessmentDefinition, changes: EditChange[]): ChangeResult[] {
  return changes.map((_, i) => applyEdits(def, changes, (j) => j === i).results[0] ?? { index: i, ok: false, reason: 'Not applied' });
}

/** Trimmed definition for the prompt: library products shrink to names + feature ids. */
export function definitionForEditing(def: AssessmentDefinition): unknown {
  return {
    ...def,
    products: def.products.map((p) =>
      UUID_RE.test(p.id)
        ? { id: p.id, name: p.name, library: true, features: (p.features ?? []).map((f) => ({ id: f.id, name: f.name })) }
        : p,
    ),
  };
}
