import { describe, expect, it } from 'vitest';
import { computeResults } from '@qq/engine';
import type { ProductSnapshot } from '@qq/schema';
import { draftToDefinition, summarizeDefinition } from './mapper';
import { AiDraftSchema, type AiDraft, type AiOption, type AiQuestion } from './schemas';
import { contextBlocks, generateTask, SYSTEM_PROMPT } from './prompts';

const opt = (label: string, points: number | null, extra: Partial<AiOption> = {}): AiOption => ({
  label, points, isGap: false, notApplicable: false, allowOtherText: false,
  recommendProductId: null, recommendBadge: null, recommendRank: null, ...extra,
});

const q = (key: string, sectionKey: string, text: string, options: AiOption[], extra: Partial<AiQuestion> = {}): AiQuestion => ({
  key, sectionKey, type: 'single', role: 'scored', text, shortLabel: text.slice(0, 20), helpText: null, required: true, options,
  ratingMin: null, ratingMax: null, ratingMinLabel: null, ratingMaxLabel: null, showIfQuestionKey: null, showIfOptionLabels: [], ...extra,
});

const RCMS = '11111111-1111-1111-1111-111111111111';
const products: ProductSnapshot[] = [{ id: RCMS, name: 'RCMS', productLine: 'RCMS', benefits: ['Fewer denials'] }];

function baseDraft(overrides: Partial<AiDraft> = {}): AiDraft {
  return {
    title: 'RCM Health Check',
    description: 'How healthy is your revenue cycle?',
    productLine: 'RCMS',
    intro: { eyebrow: 'Free Assessment', headline: 'RCM Health Check', subheadline: 'Find your leaks', body: 'Answer honestly.', bullets: [], startLabel: 'Start', estimatedMinutes: 3 },
    scoringMethod: 'points',
    tierBasis: 'percent',
    display: 'percent',
    sections: [
      { key: 's1', name: 'Front end', productIds: [RCMS], showInResults: true },
      { key: 's2', name: 'Back end', productIds: ['not-a-real-product'], showInResults: true },
    ],
    questions: [
      q('q1', 's1', 'When do you verify eligibility?', [opt('3–5 days out', 3), opt('Day of', 2), opt('Rarely', 1, { isGap: true, recommendProductId: RCMS, recommendBadge: 'Top Priority', recommendRank: 0 })]),
      q('q2', 's2', 'How do you work denials?', [opt('Root cause first', 3), opt('Resubmit', 0, { isGap: true, recommendProductId: 'bogus' })]),
    ],
    tiers: [
      { min: 80, max: 100, label: 'Strong', color: 'teal', summary: 'Nice.', body: null },
      { min: 0, max: 79, label: 'Leaky', color: 'magenta', summary: 'Work to do.', body: 'Start with **{{weakestSection}}**.' },
    ],
    sectionTiers: [{ min: 0, max: 100, label: 'Area', color: 'navy', summary: '', body: null }],
    insights: [
      { when: 'weakestInclude', pct: null, atLeast: null, sectionKeys: ['s2'], topN: 1, min: null, max: null, body: 'Denials are your biggest leak.' },
      { when: 'always', pct: null, atLeast: null, sectionKeys: [], topN: null, min: null, max: null, body: 'Focus on {{weakestSection}}.' },
    ],
    recommendations: { enabled: true, heading: 'How RCMS helps', intro: null, emptyMessage: null },
    leadCapture: { position: 'beforeResults', heading: 'Get your results', body: null, fieldKeys: ['first_name', 'email', 'organization'], requiredKeys: ['email'] },
    results: {
      eyebrow: 'Your RCM score', headline: null, body: null, showSectionBreakdown: true, showGapList: true, showInsights: true,
      showRecommendations: true, primaryCtaLabel: 'Talk to us', primaryCtaUrl: 'https://www.qualifacts.com/contact', footerNote: null,
      thankYouHeadline: null, thankYouBody: null,
    },
    designNotes: 'Two areas.',
    ...overrides,
  };
}

describe('draftToDefinition', () => {
  it('fixture draft matches the structured-output schema', () => {
    expect(AiDraftSchema.safeParse(baseDraft()).success).toBe(true);
  });

  it('produces a publishable definition and drops unknown products', () => {
    const { definition, issues, repairs } = draftToDefinition(baseDraft(), products);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(definition.sections).toHaveLength(2);
    expect(definition.sections[0].productIds).toEqual([RCMS]);
    expect(definition.sections[1].productIds).toEqual([]);
    expect(definition.products.map((p) => p.id)).toEqual([RCMS]);
    expect(definition.questions[1].options[1].recommend).toBeUndefined();
    expect(repairs.length).toBeGreaterThanOrEqual(2);
    expect(definition.leadCapture.fields.find((f) => f.key === 'email')?.required).toBe(true);
    expect(definition.leadCapture.fields.find((f) => f.key === 'first_name')?.required).toBe(false);
    expect(definition.results.primaryCta?.url).toBe('https://www.qualifacts.com/contact');
  });

  it('scores and recommends through the real engine', () => {
    const { definition } = draftToDefinition(baseDraft(), products);
    const [q1, q2] = definition.questions;
    const r = computeResults(definition, {
      [q1.id]: { optionIds: [q1.options[2].id] },
      [q2.id]: { optionIds: [q2.options[1].id] },
    });
    expect(r.points).toBe(1);
    expect(r.max).toBe(6);
    expect(r.tier?.label).toBe('Leaky');
    expect(r.recommendations.map((x) => x.productId)).toEqual([RCMS]);
    expect(r.insight?.body).toBe('Denials are your biggest leak.');
  });

  it('handles gaps scoring with a gate and branching', () => {
    const draft = baseDraft({
      scoringMethod: 'gaps',
      questions: [
        q('g', 's1', 'Do you bill Medicaid?', [opt('Yes', null), opt('No', null, { notApplicable: true })], { role: 'gate' }),
        q('q1', 's1', 'Do you track Medicaid denials?', [opt('Yes', null), opt('No', null, { isGap: true })], { showIfQuestionKey: 'g', showIfOptionLabels: ['Yes'] }),
        q('q2', 's2', 'Later question', [opt('Fine', null), opt('Bad', null, { isGap: true })], { showIfQuestionKey: 'q9', showIfOptionLabels: ['x'] }),
      ],
    });
    const { definition, issues, repairs } = draftToDefinition(draft, products);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    const gate = definition.questions[0];
    expect(gate.role).toBe('gate');
    expect(definition.questions[1].showIf?.conditions[0].questionId).toBe(gate.id);
    expect(definition.questions[2].showIf).toBeUndefined();
    expect(repairs.some((r) => r.includes('branching'))).toBe(true);
    expect(definition.questions[1].options.every((o) => o.points === undefined)).toBe(true);
  });

  it('turns a survey into a thank-you-only assessment with no scored questions', () => {
    const draft = baseDraft({
      scoringMethod: 'none',
      questions: [
        q('q1', 's1', 'Your role?', [opt('Exec', null), opt('Other', null, { allowOtherText: true })], { role: 'segment' }),
        q('q2', 's1', 'Anything else?', [], { type: 'longtext', role: 'scored', required: false }),
        q('q3', 's2', 'Rate us', [], { type: 'rating', role: 'scored', ratingMin: 1, ratingMax: 5 }),
      ],
      recommendations: { enabled: false, heading: '', intro: null, emptyMessage: null },
    });
    const { definition, issues } = draftToDefinition(draft, []);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(definition.results.thankYouOnly).toBe(true);
    expect(definition.scoring.tiers).toEqual([]);
    expect(definition.questions.every((x) => x.role !== 'scored')).toBe(true);
    expect(definition.questions[2].scale).toEqual({ min: 1, max: 5, minLabel: undefined, maxLabel: undefined });
  });

  it('fills missing points by position', () => {
    const draft = baseDraft({ questions: [q('q1', 's1', 'X?', [opt('a', null), opt('b', null), opt('c', null)])] });
    const { definition } = draftToDefinition(draft, products);
    expect(definition.questions[0].options.map((o) => o.points)).toEqual([2, 1, 0]);
  });

  it('summarizes a definition for review', () => {
    const { definition } = draftToDefinition(baseDraft(), products);
    const s = summarizeDefinition(definition);
    expect(s).toContain('Q1 [Front end]');
    expect(s).toContain('recommends RCMS');
  });
});

describe('prompts', () => {
  it('keeps the system prompt free of request data so it caches', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\$\{|\{\{brief|\d{4}-\d{2}-\d{2}/);
  });

  it('puts reference material before the task and lists only provided products', () => {
    const blocks = contextBlocks({
      knowledge: [{ id: 'k1', title: 'RCM best practices', kind: 'best_practices', topic: 'RCM', product_line: null, content: 'Verify early.' }],
      products: [{ id: RCMS, name: 'RCMS', product_line: 'RCMS', category: null, tagline: null, what_it_does: 'Billing', why_it_matters: null, benefits: [] }],
      notes: 'Focus on CCBHCs',
      attachments: [],
      pdfs: [{ name: 'guide.pdf', base64: 'AAAA' }],
    });
    expect(blocks[0].type).toBe('document');
    const txt = blocks[1].type === 'text' ? blocks[1].text : '';
    expect(txt.indexOf('<knowledge_documents>')).toBeLessThan(txt.indexOf('<products'));
    expect(txt).toContain(`id: ${RCMS}`);
    expect(txt).toContain('Focus on CCBHCs');
    expect(generateTask({
      title: 'RCM', audience: 'prospect', productLine: '', functionArea: 'RCM', goal: '', questionCount: 10,
      scoringStyle: 'auto', leadPosition: 'beforeResults', tone: '', primaryCtaLabel: '', primaryCtaUrl: '',
    })).toContain('about 10');
  });
});
