import * as XLSX from 'xlsx';
import type { ResponseRow } from './types';
import { FOLLOW_UP_LABELS } from './types';

type Cell = string | number | boolean | null;

interface Column {
  key: string;
  header: string;
  get: (r: ResponseRow) => Cell;
}

const LEAD_COLUMNS: Column[] = [
  { key: 'completed_at', header: 'Completed', get: (r) => new Date(r.completed_at).toLocaleString() },
  { key: 'assessment', header: 'Assessment', get: () => '' }, // filled per row by caller
  { key: 'first_name', header: 'First Name', get: (r) => r.first_name },
  { key: 'last_name', header: 'Last Name', get: (r) => r.last_name },
  { key: 'email', header: 'Email', get: (r) => r.email },
  { key: 'organization', header: 'Organization', get: (r) => r.organization },
  { key: 'job_title', header: 'Title', get: (r) => r.job_title },
  { key: 'phone', header: 'Phone', get: (r) => r.phone },
  { key: 'state', header: 'State', get: (r) => r.state },
  { key: 'score_pct', header: 'Score %', get: (r) => r.score_pct },
  { key: 'score_points', header: 'Points', get: (r) => r.score_points },
  { key: 'score_max', header: 'Max Points', get: (r) => r.score_max },
  { key: 'tier_label', header: 'Tier', get: (r) => r.tier_label },
  { key: 'recommendations', header: 'Recommended Solutions', get: (r) => r.recommendations.map((x) => x.name).join('; ') },
  { key: 'follow_up_status', header: 'Follow-up', get: (r) => FOLLOW_UP_LABELS[r.follow_up_status] },
  { key: 'source', header: 'Source', get: (r) => r.source },
  { key: 'rep_code', header: 'Rep', get: (r) => r.rep_code },
  { key: 'utm_source', header: 'UTM Source', get: (r) => r.utm_source },
  { key: 'utm_medium', header: 'UTM Medium', get: (r) => r.utm_medium },
  { key: 'utm_campaign', header: 'UTM Campaign', get: (r) => r.utm_campaign },
  { key: 'internal_notes', header: 'Internal Notes', get: (r) => r.internal_notes },
  { key: 'response_id', header: 'Response ID', get: (r) => r.id },
];

/** Build a "wide" table: one row per response; lead, score, section and question columns. */
export function wideRows(rows: ResponseRow[], assessmentTitle: (id: string) => string): Cell[][] {
  // Union of custom lead fields
  const customKeys = [...new Set(rows.flatMap((r) => Object.keys(r.lead_fields ?? {})))];

  // Sections and questions in first-seen order (answers are stored in display order)
  const sections = new Map<string, string>();
  const questions = new Map<string, string>();
  for (const r of rows) {
    for (const s of r.section_scores ?? []) if (!sections.has(s.section_id)) sections.set(s.section_id, s.section);
    for (const a of r.answers ?? []) if (!questions.has(a.question_id)) questions.set(a.question_id, a.short_label || a.question_text);
  }
  // Disambiguate duplicate question headers
  const seen = new Map<string, number>();
  const qHeaders = [...questions.entries()].map(([id, label]) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return [id, n > 1 ? `${label} (${n})` : label] as const;
  });

  const header: Cell[] = [
    ...LEAD_COLUMNS.map((c) => c.header),
    ...customKeys,
    ...[...sections.values()].map((s) => `${s} %`),
    ...qHeaders.map(([, h]) => h),
  ];

  const body = rows.map((r) => {
    const secMap = new Map((r.section_scores ?? []).map((s) => [s.section_id, s]));
    const ansMap = new Map((r.answers ?? []).map((a) => [a.question_id, a]));
    return [
      ...LEAD_COLUMNS.map((c) => (c.key === 'assessment' ? assessmentTitle(r.assessment_id) : c.get(r))),
      ...customKeys.map((k) => r.lead_fields?.[k] ?? null),
      ...[...sections.keys()].map((id) => {
        const s = secMap.get(id);
        return s ? (s.pct ?? 'N/A') : null;
      }),
      ...qHeaders.map(([id]) => {
        const a = ansMap.get(id);
        return a ? (a.skipped ? '' : a.answer_label) : null;
      }),
    ];
  });

  return [header, ...body];
}

/** "Long" table: one row per answered question. */
export function longRows(rows: ResponseRow[], assessmentTitle: (id: string) => string): Cell[][] {
  const header: Cell[] = ['Response ID', 'Completed', 'Assessment', 'Email', 'Organization', 'Section', 'Question', 'Answer', 'Points', 'Max Points', 'Gap', 'Skipped'];
  const body: Cell[][] = [];
  for (const r of rows) {
    for (const a of r.answers ?? []) {
      body.push([
        r.id,
        new Date(r.completed_at).toLocaleString(),
        assessmentTitle(r.assessment_id),
        r.email,
        r.organization,
        a.section_name,
        a.question_text,
        a.answer_label,
        a.points,
        a.max_points,
        a.is_gap === null ? null : a.is_gap ? 'Yes' : 'No',
        a.skipped ? 'Yes' : 'No',
      ]);
    }
  }
  return [header, ...body];
}

function summaryRows(rows: ResponseRow[], assessmentTitle: (id: string) => string, filtersLabel: string): Cell[][] {
  const out: Cell[][] = [
    ['Qualifacts Assessment Studio: Export'],
    ['Generated', new Date().toLocaleString()],
    ['Filters', filtersLabel],
    ['Responses', rows.length],
    [],
    ['Assessment', 'Responses', 'Average Score %', 'Top Tier', 'Latest Response'],
  ];
  const byA = new Map<string, ResponseRow[]>();
  for (const r of rows) byA.set(r.assessment_id, [...(byA.get(r.assessment_id) ?? []), r]);
  for (const [id, list] of byA) {
    const scored = list.filter((r) => r.score_pct !== null);
    const avg = scored.length ? Math.round((scored.reduce((s, r) => s + Number(r.score_pct), 0) / scored.length) * 10) / 10 : null;
    const tiers = new Map<string, number>();
    for (const r of list) if (r.tier_label) tiers.set(r.tier_label, (tiers.get(r.tier_label) ?? 0) + 1);
    const top = [...tiers.entries()].sort((a, b) => b[1] - a[1])[0];
    const latest = list.reduce((m, r) => (r.completed_at > m ? r.completed_at : m), list[0].completed_at);
    out.push([assessmentTitle(id), list.length, avg, top ? `${top[0]} (${top[1]})` : null, new Date(latest).toLocaleString()]);
  }
  out.push([], ['Tier distribution']);
  const tiers = new Map<string, number>();
  for (const r of rows) tiers.set(r.tier_label ?? '(unscored)', (tiers.get(r.tier_label ?? '(unscored)') ?? 0) + 1);
  for (const [t, n] of tiers) out.push([t, n]);
  return out;
}

function widths(data: Cell[][]): { wch: number }[] {
  const cols = Math.max(...data.map((r) => r.length));
  return Array.from({ length: cols }, (_, c) => ({
    wch: Math.min(60, Math.max(10, ...data.slice(0, 200).map((r) => String(r[c] ?? '').length + 2))),
  }));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFileBase(name: string): string {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'responses';
  return `${safe}-${new Date().toISOString().slice(0, 10)}`;
}

export function exportXlsx(rows: ResponseRow[], assessmentTitle: (id: string) => string, filename: string, filtersLabel: string) {
  const wb = XLSX.utils.book_new();
  const summary = summaryRows(rows, assessmentTitle, filtersLabel);
  const wide = wideRows(rows, assessmentTitle);
  const long = longRows(rows, assessmentTitle);
  for (const [name, data] of [['Summary', summary], ['Responses', wide], ['Answers', long]] as const) {
    const ws = XLSX.utils.aoa_to_sheet(data as Cell[][]);
    ws['!cols'] = widths(data as Cell[][]);
    if (name !== 'Summary' && data.length > 1) ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1' };
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, `${filename}.xlsx`, { compression: true });
}

export function exportCsv(rows: ResponseRow[], assessmentTitle: (id: string) => string, filename: string, format: 'wide' | 'long' = 'wide') {
  const data = format === 'wide' ? wideRows(rows, assessmentTitle) : longRows(rows, assessmentTitle);
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Neutralize spreadsheet formula injection from respondent-entered text
    const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = data.map((r) => r.map(esc).join(',')).join('\r\n');
  // BOM so Excel opens UTF-8 correctly
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}${format === 'long' ? '-answers' : ''}.csv`);
}
