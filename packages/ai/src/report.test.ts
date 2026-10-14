import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { buildReportFacts, pickSectionsToAnalyze, reportTask, tidyReportContent, type ReportResponseInput } from './report';
import { buildReportPdf, wrapText } from './report-pdf';
import { ReportSchema, type ReportContent } from './schemas';

const assets = join(__dirname, '../../ui/assets');
const font = (f: string) => new Uint8Array(readFileSync(join(assets, f)));

const response: ReportResponseInput = {
  first_name: 'Bethany', last_name: 'Rich', organization: 'New Life Medicine', job_title: 'Billing Manager',
  completed_at: '2026-06-01T15:00:00Z', score_pct: 92, score_points: 55, score_max: 60, tier_label: 'Strong Foundation', tier_key: 't1',
  section_scores: [
    { section_id: 's1', section: 'Intake & Registration', pct: 100 },
    { section_id: 's2', section: 'Pre-Visit Eligibility', pct: 89 },
    { section_id: 's3', section: 'Real-Time Verification', pct: 78 },
    { section_id: 's4', section: 'Denial Investigation', pct: 89 },
    { section_id: 's5', section: 'Data Integrity', pct: 100 },
  ],
  answers: [
    { section_id: 's3', section_name: 'Real-Time Verification', question_text: 'When do you re-check coverage?', answer_label: 'Night before, in a batch', is_gap: true },
    { section_id: 's1', section_name: 'Intake & Registration', question_text: 'Skipped one', answer_label: null, is_gap: null, skipped: true },
  ],
  recommendations: [{ product_id: 'p1', name: 'RCMS+', features: ['Eligibility checks'] }],
};
const definition = {
  meta: { title: 'Eligibility Healthcheck', productLine: 'RCMS+' },
  scoring: { method: 'points', display: 'points', tiers: [{ id: 't1', min: 80, max: 100, label: 'Strong Foundation', color: '#00B2A9' }] },
  products: [{ id: 'p1', name: 'RCMS+', tagline: 'An embedded revenue cycle extension' }],
};
const facts = () => buildReportFacts({ response, definition, settings: { impactLabel: 'Revenue Impact' }, assessment: { title: 'Eligibility Healthcheck', product_line: 'RCMS+' } });

const long = 'Create a high-risk payer list including Medicaid MCOs and carve-out plans, with eligibility checks required morning-of for these specific payers rather than night-before batch processing. '.repeat(3);
const content: ReportContent = {
  executiveSummary: 'Your team has strong foundations in intake and data integrity. '.repeat(4),
  sections: ['s3', 's2', 's4'].map((id) => ({ sectionId: id, gap: long, impact: long, recommendations: [long, 'Second step.', 'Third step.', 'Fourth (dropped)'] })),
  conclusion: 'These targeted improvements will strengthen an already solid foundation.',
};

describe('report facts', () => {
  it('takes every label from the assessment and response, not the AI', () => {
    const f = facts();
    expect(f.title).toBe('Eligibility Healthcheck Report');
    expect(f.brandLine).toBe('Powered by Qualifacts RCMS+');
    expect(f.impactLabel).toBe('Revenue Impact');
    expect(f.score).toEqual({ kind: 'points', value: 55, max: 60, pct: 92 });
    expect(f.tierColor).toBe('#00B2A9');
    expect(f.sections.map((s) => s.name)).toEqual(['Intake & Registration', 'Pre-Visit Eligibility', 'Real-Time Verification', 'Denial Investigation', 'Data Integrity']);
    expect(f.answers).toHaveLength(1); // skipped answers left out
    expect(f.solutions).toEqual([{ name: 'RCMS+', tagline: 'An embedded revenue cycle extension', features: ['Eligibility checks'] }]);
  });

  it('analyzes sections below the threshold (weakest first), else the 2 weakest', () => {
    const f = facts();
    expect(f.analyzeIds).toEqual(['s3', 's2', 's4']);
    expect(pickSectionsToAnalyze(f.sections, 50)).toEqual(['s3', 's2']);
  });

  it('percent display and surveys', () => {
    const pct = buildReportFacts({ response, definition: { ...definition, scoring: { method: 'points', display: 'percent' } }, assessment: { title: 'X' } });
    expect(pct.score.kind).toBe('percent');
    const survey = buildReportFacts({ response: { ...response, score_pct: null, score_points: null }, definition: { scoring: { method: 'none' } }, assessment: { title: 'X' } });
    expect(survey.score.kind).toBe('none');
    expect(survey.brandLine).toBe('Qualifacts');
  });

  it('prompt lists the sections to analyze and the impact label; tidy keeps only those, 3 recs each', () => {
    const f = facts();
    const task = reportTask(f, 'Never recommend outside vendors.');
    expect(task).toContain('Real-Time Verification [id s3]');
    expect(task).toContain('"Revenue Impact"');
    expect(task).toContain('Never recommend outside vendors.');
    const tidy = tidyReportContent({ ...content, sections: [...content.sections, { sectionId: 's1', gap: 'x', impact: 'y', recommendations: [] }] }, f);
    expect(tidy.sections.map((s) => s.sectionId)).toEqual(['s3', 's2', 's4']);
    expect(tidy.sections[0].recommendations).toHaveLength(3);
  });

  it('ReportSchema works with structured outputs (no unions, closed objects)', () => {
    const json = JSON.stringify(zodOutputFormat(ReportSchema).schema);
    expect(json).not.toMatch(/"anyOf"|"oneOf"|"type":\[/);
    expect((json.match(/"additionalProperties":false/g) ?? []).length).toBe((json.match(/"type":"object"/g) ?? []).length);
  });
});

describe('report PDF', () => {
  it('wraps long text within the width', () => {
    const lines = wrapText('one two three four five six', (s) => s.length * 10, 100);
    expect(lines.every((l) => l.length * 10 <= 100)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six');
  });

  it('renders a multi-page PDF in Ekster, with page numbers', async () => {
    const f = facts();
    const bytes = await buildReportPdf(f, tidyReportContent(content, f), { regular: font('Ekster-Regular.otf'), bold: font('Ekster-Bold.otf'), extraBold: font('Ekster-ExtraBold.otf') });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe('Eligibility Healthcheck Report');
    // Keep a copy to eyeball during development
    const out = process.env.REPORT_SAMPLE_DIR;
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, 'sample-report.pdf'), bytes); }
  });

  it('still renders with no fonts or logo (Helvetica fallback strips unsupported characters)', async () => {
    const f = { ...facts(), title: 'Report → with an arrow ✓' };
    const bytes = await buildReportPdf(f, tidyReportContent(content, f));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
