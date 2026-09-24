import { describe, expect, it } from 'vitest';
import type { Answers, AssessmentDefinition } from '@qq/schema';
import { BUILT_IN_TEMPLATES } from '@qq/templates';
import {
  buildSubmission,
  computeResults,
  isVisible,
  renderTemplate,
  buildMergeContext,
  validateDefinition,
  visibleQuestions,
} from './index';

const tpl = (key: string): AssessmentDefinition => {
  const t = BUILT_IN_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(key);
  return t.definition;
};

/** Pick the option at `idx` for each listed question. */
function pick(def: AssessmentDefinition, choices: Record<string, number>): Answers {
  const a: Answers = {};
  for (const [qid, idx] of Object.entries(choices)) {
    const q = def.questions.find((x) => x.id === qid)!;
    a[qid] = { optionIds: [q.options[idx].id] };
  }
  return a;
}

/** The first non-gap, applicable option for every scored question (gaps scoring). */
function allOnTrack(def: AssessmentDefinition): Answers {
  const a: Answers = {};
  for (const q of def.questions) {
    if (q.role !== 'scored' || !q.options.length) continue;
    const o = q.options.find((x) => !x.isGap && !x.notApplicable) ?? q.options[0];
    a[q.id] = { optionIds: [o.id] };
  }
  return a;
}

/** Same option index for every scored question. */
function all(def: AssessmentDefinition, idx: number): Answers {
  const a: Answers = {};
  for (const q of def.questions) if (q.role === 'scored' && q.options.length) a[q.id] = { optionIds: [q.options[idx].id] };
  return a;
}

describe('templates are valid', () => {
  for (const t of BUILT_IN_TEMPLATES) {
    it(`${t.key} passes the pre-publish checklist`, () => {
      const errors = validateDefinition(t.definition).filter((i) => i.level === 'error');
      expect(errors).toEqual([]);
    });
  }
});

// ── Eligibility (legacy: raw points out of 60; tiers at 48 / 33) ─────────────
describe('Eligibility parity', () => {
  const def = tpl('eligibility');

  it('best case = 60 points, Strong Foundation', () => {
    const r = computeResults(def, all(def, 0));
    expect(r.points).toBe(60);
    expect(r.max).toBe(60);
    expect(r.tier?.label).toBe('Strong Foundation');
    expect(r.sections.every((s) => s.pct === 100 && s.tier?.label === 'Solid')).toBe(true);
  });

  it('worst case = 20 points, Significant Gaps', () => {
    const r = computeResults(def, all(def, 2));
    expect(r.points).toBe(20);
    expect(r.tier?.label).toBe('Significant Gaps');
    // every section at 33% (< 60) → "spread" insight wins
    expect(r.insight?.id).toBe('i_spread');
  });

  it('tier boundaries: 48 → Strong, 47 → Room, 33 → Room, 32 → Significant', () => {
    const at = (target: number) => {
      // Start from all-2s (40) and move answers up/down one step at a time.
      const a = all(def, 1);
      const scored = def.questions.filter((q) => q.role === 'scored');
      let total = 40;
      for (const q of scored) {
        if (total < target) { a[q.id] = { optionIds: [q.options[0].id] }; total++; }
        else if (total > target) { a[q.id] = { optionIds: [q.options[2].id] }; total--; }
      }
      return computeResults(def, a);
    };
    expect(at(48).tier?.label).toBe('Strong Foundation');
    expect(at(47).tier?.label).toBe('Room to Improve');
    expect(at(33).tier?.label).toBe('Room to Improve');
    expect(at(32).tier?.label).toBe('Significant Gaps');
  });

  it('insight: weakest include Intake + Data Integrity → upstream data quality', () => {
    const a = all(def, 0);
    // Tank Intake (s1: e1–e3) and Data Integrity (s5: e13–e15) to 1s; give 2 other sections a 2
    Object.assign(a, pick(def, { e1: 2, e2: 2, e3: 2, e13: 2, e14: 2, e15: 2, e4: 1, e10: 1 }));
    const r = computeResults(def, a);
    expect(r.insight?.id).toBe('i_upstream');
  });

  it('fallback insight names the weakest section', () => {
    const a = all(def, 0);
    // Weak-but-not-failing: s1 88.9, s2 88.9, s4 77.8, s6 83.3 → top-4 weakest = s4, s6, s1, s2.
    // None of the pairs {s1,s5} {s2,s3} {s4,s7} are all present, so the fallback wins.
    Object.assign(a, pick(def, { e1: 1, e4: 1, e10: 1, e11: 1, e16: 1 }));
    const r = computeResults(def, a);
    expect(r.weakestSection?.sectionId).toBe('s4');
    expect(r.insight?.id).toBe('i_fallback');
    const text = renderTemplate(r.insight!.body, buildMergeContext(def, r));
    expect(text).toContain('**Denial Investigation**');
  });

  it('a single weak section still matches the workflow rule when s2 and s3 tie into the top 4 (legacy behavior)', () => {
    const a = all(def, 0);
    Object.assign(a, pick(def, { e18: 1 }));
    expect(computeResults(def, a).insight?.id).toBe('i_workflow');
  });
});

// ── InSync (legacy: gaps, soft & hard gates, healthPct rounded) ──────────────
describe('InSync parity', () => {
  const def = tpl('insync-operational');

  it('hard gate: "No" to grant funding hides the grant follow-ups', () => {
    const a = pick(def, { gm_g: 1 });
    const gm1 = def.questions.find((q) => q.id === 'gm1')!;
    expect(isVisible(gm1, def, a)).toBe(false);
    const visible = visibleQuestions(def, a).map((q) => q.id);
    expect(visible).not.toContain('gm1');
    expect(visible).toContain('mbc1'); // soft gate still asks its questions
  });

  it('soft gate: MBC "not that we know of" → questions asked but not counted', () => {
    const a = allOnTrack(def);
    Object.assign(a, pick(def, { gm_g: 0, mbc_g: 0 }));
    // Answer every MBC question as a gap
    Object.assign(a, pick(def, { mbc1: 1, mbc2: 1, mbc3: 1 }));
    const r = computeResults(def, a);
    const mbc = r.sections.find((s) => s.sectionId === 'mbc')!;
    expect(mbc.applicable).toBe(false);
    expect(mbc.pct).toBeNull();
    expect(mbc.items.filter((i) => i.isGap && !i.counted)).toHaveLength(3); // shown as "monitor"
    expect(r.pct).toBe(100); // the uncounted MBC gaps don't hurt the score
  });

  it('health % = on-track ÷ counted, rounded; matches legacy tiers', () => {
    const a = allOnTrack(def); // all non-gap
    Object.assign(a, pick(def, { gm_g: 0, mbc_g: 2 }));
    // 3 cd + 4 gm + 4 rcm + 3 mbc + 4 ar = 18 counted. Make 5 gaps → 13/18 = 72.2% → 72
    Object.assign(a, pick(def, { cd1: 1, rcm1: 1, rcm2: 1, ar1: 1, mbc2: 1 }));
    const r = computeResults(def, a);
    expect(r.countedCount).toBe(18);
    expect(r.gapCount).toBe(5);
    expect(r.pct).toBe(72);
    expect(r.tier?.label).toBe('Solid, With Gaps');
    const rcm = r.sections.find((s) => s.sectionId === 'rcm')!;
    expect(rcm.pct).toBe(50);
    expect(rcm.tier?.label).toBe('Needs Attention');
  });

  it('hard-gated section with "No" is not applicable and skipped questions are recorded', () => {
    const a = all(def, 0);
    Object.assign(a, pick(def, { gm_g: 1, mbc_g: 2 }));
    for (const id of ['gm1', 'gm2', 'gm3', 'gm4']) delete a[id];
    const r = computeResults(def, a);
    const gm = r.sections.find((s) => s.sectionId === 'gm')!;
    expect(gm.applicable).toBe(false);
    expect(gm.gateAnswerLabel).toBe('No');
    expect(gm.pct).toBeNull();
    const payload = buildSubmission({
      def, assessmentId: 'x', sessionId: 's', answers: a, results: r, lead: { email: 'a@b.co', first_name: 'A' },
    });
    const gm1 = payload.answers!.find((x) => x.question_id === 'gm1')!;
    expect(gm1.skipped).toBe(true);
    expect(payload.email).toBe('a@b.co');
  });
});

// ── CES (legacy: points 0/5/10, recs sorted by answer score then impact) ─────
describe('CES parity', () => {
  const def = tpl('ces-healthcheck');

  it('all "fully using" → 100%, Power User, no recommendations', () => {
    const r = computeResults(def, all(def, 0));
    expect(r.pct).toBe(100);
    expect(r.tier?.label).toBe('CES Power User');
    expect(r.recommendations).toHaveLength(0);
  });

  it('recommendations: Top Priority (0) before Opportunity (5), then by impact', () => {
    const a = all(def, 0);
    // forms (impact 2) = partial, broadcast (6) = none, esignatures (1) = partial, telehealth (7) = none
    Object.assign(a, pick(def, { c4: 1, c2: 2, c5: 1, c10: 2 }));
    const r = computeResults(def, a);
    expect(r.recommendations.map((x) => x.productId)).toEqual([
      'broadcast-messaging', 'telehealth-analytics', 'esignatures', 'forms',
    ]);
    expect(r.recommendations[0].badge).toBe('Top Priority');
    expect(r.recommendations[3].badge).toBe('Opportunity');
    // 11 questions × 10 = 110 max; 110 - 5 - 10 - 5 - 10 = 80 → 73%
    expect(r.max).toBe(110);
    expect(r.points).toBe(80);
    expect(r.pct).toBe(73);
    expect(r.tier?.label).toBe('Room to Grow');
  });

  it('segment question (platform) never affects the score', () => {
    const a = all(def, 0);
    Object.assign(a, pick(def, { platform: 1 }));
    expect(computeResults(def, a).pct).toBe(100);
  });
});

// ── Payment Posting survey (unscored) ────────────────────────────────────────
describe('Payment Posting survey', () => {
  const def = tpl('payment-posting-survey');

  it('has no score or tier; ratings and "Other" text are recorded', () => {
    const a: Answers = {
      ...pick(def, { org_segment_type: 6, org_segment_setting: 0, role: 1, biggest_challenge: 2 }),
      satisfaction: { value: 2 },
      posting_interest: { value: 5 },
    };
    a.org_segment_type!.otherText = 'Tribal health';
    const r = computeResults(def, a);
    expect(r.pct).toBeNull();
    expect(r.tier).toBeNull();
    const payload = buildSubmission({ def, assessmentId: 'x', sessionId: 's', answers: a, results: r, lead: {} });
    expect(payload.score_pct).toBeNull();
    const seg = payload.answers!.find((x) => x.question_id === 'org_segment_type')!;
    expect(seg.answer_label).toBe('Other: Tribal health');
    expect(payload.answers!.find((x) => x.question_id === 'posting_interest')!.value).toBe(5);
  });
});

describe('general engine behavior', () => {
  it('weightedSections averages section % by weight', () => {
    const def = tpl('eligibility');
    const d: AssessmentDefinition = {
      ...def,
      scoring: { ...def.scoring, overall: 'weightedSections', tierBasis: 'percent' },
      sections: def.sections.map((s) => ({ ...s, weight: s.id === 's1' ? 3 : 0 })),
    };
    const a = all(d, 0);
    Object.assign(a, pick(d, { e1: 2 })); // s1 = 7/9 = 77.8%
    expect(computeResults(d, a).pct).toBe(78);
  });

  it('unknown merge tags are left visible', () => {
    expect(renderTemplate('Hi {{firstName}} {{nope}}', { firstName: 'Sam' })).toBe('Hi Sam {{nope}}');
  });
});
