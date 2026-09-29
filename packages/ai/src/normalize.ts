import { AI_COLORS, AI_LEAD_KEYS, AI_QUESTION_TYPES, AI_ROLES } from './schemas';

// ─────────────────────────────────────────────────────────────────────────────
// Generation replies aren't constrained-decoded (the schema is too large for the API's
// grammar), so Claude's JSON can drift from the schema in small ways: "Points" vs "points",
// "3" vs 3, a missing field, a { plan: {...} } wrapper. These functions repair SHAPE only
// (types, casing, defaults) so the strict zod check that follows passes. They never invent
// content; the mapper's "repairs" list still reports content fixes.
// ─────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[%,\s]/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? /^(true|yes|y|1)$/i.test(v.trim()) : typeof v === 'number' ? v !== 0 : false;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const strArr = (v: unknown): string[] => arr(v).map(str).filter((s) => s !== '');

/** Case/space/punctuation-insensitive enum match with a fallback. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T, aliases: Record<string, T> = {}): T {
  const k = str(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k) return fallback;
  if (aliases[k]) return aliases[k];
  return allowed.find((a) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === k) ?? fallback;
}

const TYPE_ALIASES: Record<string, (typeof AI_QUESTION_TYPES)[number]> = {
  singlechoice: 'single', radio: 'single', choice: 'single', multiplechoice: 'multi', multiselect: 'multi', checkbox: 'multi', checkboxes: 'multi',
  select: 'dropdown', yesorno: 'yesno', boolean: 'yesno', scale: 'rating', likert: 'rating', shorttext: 'text', textarea: 'longtext', paragraph: 'longtext', open: 'longtext',
};
const LEAD_ALIASES: Record<string, (typeof AI_LEAD_KEYS)[number]> = {
  firstname: 'first_name', lastname: 'last_name', emailaddress: 'email', workemail: 'email', company: 'organization', org: 'organization', title: 'job_title', jobtitle: 'job_title', role: 'job_title', phonenumber: 'phone',
};

/** Unwrap { plan: {...} } / { draft: {...} } / { assessment: {...} } style replies. */
function unwrap(raw: unknown, marker: string): Obj {
  const o = obj(raw);
  if (marker in o) return o;
  for (const k of ['plan', 'draft', 'assessment', 'result', 'data', 'output']) {
    if (isObj(o[k]) && marker in (o[k] as Obj)) return o[k] as Obj;
  }
  return o;
}

function option(raw: unknown) {
  const o = obj(raw);
  return {
    label: str(o.label ?? o.text),
    points: num(o.points),
    isGap: bool(o.isGap),
    notApplicable: bool(o.notApplicable),
    allowOtherText: bool(o.allowOtherText),
    recommendProductId: str(o.recommendProductId),
    recommendBadge: str(o.recommendBadge),
    recommendRank: num(o.recommendRank),
  };
}

function question(raw: unknown, i: number, fallbackSection: string) {
  const o = obj(raw);
  return {
    key: str(o.key) || `q${i + 1}`,
    sectionKey: str(o.sectionKey) || fallbackSection,
    type: oneOf(o.type, AI_QUESTION_TYPES, 'single', TYPE_ALIASES),
    role: oneOf(o.role, AI_ROLES, 'scored'),
    text: str(o.text ?? o.question),
    shortLabel: str(o.shortLabel),
    helpText: str(o.helpText),
    required: o.required === undefined ? true : bool(o.required),
    options: arr(o.options).map(option).filter((x) => x.label.trim() !== ''),
    ratingMin: num(o.ratingMin),
    ratingMax: num(o.ratingMax),
    ratingMinLabel: str(o.ratingMinLabel),
    ratingMaxLabel: str(o.ratingMaxLabel),
    showIfQuestionKey: str(o.showIfQuestionKey),
    showIfOptionLabels: strArr(o.showIfOptionLabels),
  };
}

function tier(raw: unknown) {
  const o = obj(raw);
  return {
    min: num(o.min),
    max: num(o.max),
    label: str(o.label),
    color: oneOf(o.color, AI_COLORS, 'teal', { purple: 'darkMagenta', gray: 'grey', blue: 'navy', yellow: 'amber', orange: 'amber', red: 'magenta', green: 'teal', pink: 'magenta' }),
    summary: str(o.summary),
    body: str(o.body),
  };
}

function insight(raw: unknown) {
  const o = obj(raw);
  return {
    when: oneOf(o.when, ['always', 'sectionsBelowCount', 'weakestInclude', 'overallBetween'] as const, 'always'),
    pct: num(o.pct),
    atLeast: num(o.atLeast),
    sectionKeys: strArr(o.sectionKeys),
    topN: num(o.topN),
    min: num(o.min),
    max: num(o.max),
    body: str(o.body),
  };
}

function section(raw: unknown, i: number) {
  const o = obj(raw);
  return { key: str(o.key) || `s${i + 1}`, name: str(o.name ?? o.title), productIds: strArr(o.productIds), showInResults: o.showInResults === undefined ? true : bool(o.showInResults) };
}

/** Everything in AiDraft except sections/questions. */
function common(o: Obj) {
  const intro = obj(o.intro);
  const rec = obj(o.recommendations);
  const lead = obj(o.leadCapture);
  const res = obj(o.results);
  const leadKeys = (v: unknown) => [...new Set(strArr(v).map((k) => oneOf(k, AI_LEAD_KEYS, 'email', LEAD_ALIASES)))];
  return {
    title: str(o.title),
    description: str(o.description),
    productLine: str(o.productLine),
    intro: {
      eyebrow: str(intro.eyebrow),
      headline: str(intro.headline),
      subheadline: str(intro.subheadline),
      body: str(intro.body),
      bullets: strArr(intro.bullets),
      startLabel: str(intro.startLabel),
      estimatedMinutes: num(intro.estimatedMinutes),
    },
    scoringMethod: oneOf(o.scoringMethod, ['points', 'gaps', 'none'] as const, 'points'),
    tierBasis: oneOf(o.tierBasis, ['percent', 'points'] as const, 'percent'),
    display: oneOf(o.display, ['percent', 'points'] as const, 'percent'),
    tiers: arr(o.tiers).map(tier),
    sectionTiers: arr(o.sectionTiers).map(tier),
    insights: arr(o.insights).map(insight),
    recommendations: { enabled: rec.enabled === undefined ? true : bool(rec.enabled), heading: str(rec.heading), intro: str(rec.intro), emptyMessage: str(rec.emptyMessage) },
    leadCapture: {
      position: oneOf(lead.position, ['beforeResults', 'beforeQuestions', 'off'] as const, 'beforeResults'),
      heading: str(lead.heading),
      body: str(lead.body),
      fieldKeys: leadKeys(lead.fieldKeys),
      requiredKeys: leadKeys(lead.requiredKeys),
    },
    results: {
      eyebrow: str(res.eyebrow),
      headline: str(res.headline),
      body: str(res.body),
      showSectionBreakdown: res.showSectionBreakdown === undefined ? true : bool(res.showSectionBreakdown),
      showGapList: res.showGapList === undefined ? true : bool(res.showGapList),
      showInsights: res.showInsights === undefined ? true : bool(res.showInsights),
      showRecommendations: res.showRecommendations === undefined ? true : bool(res.showRecommendations),
      primaryCtaLabel: str(res.primaryCtaLabel),
      primaryCtaUrl: str(res.primaryCtaUrl),
      footerNote: str(res.footerNote),
      thankYouHeadline: str(res.thankYouHeadline),
      thankYouBody: str(res.thankYouBody),
    },
    designNotes: str(o.designNotes),
  };
}

export function normalizePlan(raw: unknown) {
  const o = unwrap(raw, 'sections');
  return {
    ...common(o),
    sections: arr(o.sections).map((s, i) => {
      const so = obj(s);
      return { ...section(s, i), questionCount: num(so.questionCount), questionBrief: str(so.questionBrief ?? so.brief) };
    }),
  };
}

export function normalizeSectionQuestions(raw: unknown, sectionKey = '') {
  const list = Array.isArray(raw) ? raw : arr(unwrap(raw, 'questions').questions);
  return { questions: list.map((q, i) => question(q, i, sectionKey)) };
}

export function normalizeDraft(raw: unknown) {
  const o = unwrap(raw, 'questions');
  const sections = arr(o.sections).map(section);
  const first = sections[0]?.key ?? '';
  return { ...common(o), sections, questions: arr(o.questions).map((q, i) => question(q, i, first)) };
}
