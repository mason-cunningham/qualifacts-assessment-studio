import * as XLSX from 'xlsx';
import type { StoredFile, TextAttachment } from '@qq/ai';
import { supabase } from './supabase';

export const ACCEPTED_CONTEXT_FILES = '.pdf,.docx,.xlsx,.xls,.csv,.txt,.md';
const MAX_BYTES = 20 * 1024 * 1024;

export type PreparedFile =
  | { kind: 'stored'; file: StoredFile; size: number }
  | { kind: 'text'; attachment: TextAttachment; size: number };

/**
 * Get a file ready for AI:
 *  - PDF       → uploaded to the private q-quiz-imports bucket (Claude reads PDFs natively)
 *  - DOCX      → text via mammoth (loaded on demand)
 *  - XLSX/CSV  → text via SheetJS (one CSV block per sheet)
 *  - TXT/MD    → read as text
 */
export async function prepareFile(file: File): Promise<PreparedFile> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
  const name = file.name;
  const lower = name.toLowerCase();

  if (lower.endsWith('.pdf')) {
    const { data: u } = await supabase.auth.getUser();
    const safe = lower.replace(/[^a-z0-9.]+/g, '-').slice(-80);
    const path = `ai/${u.user?.id ?? 'anon'}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage.from('q-quiz-imports').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (error) throw new Error(`Upload failed for ${name}: ${error.message}`);
    return { kind: 'stored', file: { path, name, mediaType: 'application/pdf' }, size: file.size };
  }

  let text: string;
  if (lower.endsWith('.docx')) {
    const mammoth = (await import('mammoth')).default;
    const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = res.value;
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    text = wb.SheetNames.map((n) => `## Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
  } else if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.md')) {
    text = await file.text();
  } else {
    throw new Error(`${name}: unsupported file type. Use PDF, Word (.docx), Excel, CSV, TXT or Markdown.`);
  }
  text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) throw new Error(`${name} doesn't contain any readable text.`);
  return { kind: 'text', attachment: { name, text }, size: text.length };
}

export function splitPrepared(files: PreparedFile[]): { files: StoredFile[]; attachments: TextAttachment[] } {
  return {
    files: files.flatMap((f) => (f.kind === 'stored' ? [f.file] : [])),
    attachments: files.flatMap((f) => (f.kind === 'text' ? [f.attachment] : [])),
  };
}

/** Rough token estimate for the context meter (~4 chars per token; PDFs ~1 token per 5 bytes). */
export function estimateTokens(chars: number, pdfBytes = 0): number {
  return Math.round(chars / 4 + pdfBytes / 5);
}
