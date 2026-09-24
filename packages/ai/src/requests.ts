// Request/response contract between Studio and the ai-assist Edge Function.

export type AiMode = 'generate' | 'import' | 'extract_knowledge' | 'rewrite' | 'options' | 'tier_copy' | 'review';

export interface GenerateBrief {
  title: string;
  audience: 'prospect' | 'customer';
  productLine: string;
  functionArea: string;
  goal: string;
  questionCount: number;
  scoringStyle: 'auto' | 'points' | 'gaps' | 'none';
  leadPosition: 'beforeResults' | 'beforeQuestions' | 'off';
  tone: string;
  primaryCtaLabel: string;
  primaryCtaUrl: string;
}

/** A file already uploaded to the private q-quiz-imports bucket (PDFs are sent to Claude natively). */
export interface StoredFile {
  path: string;
  name: string;
  mediaType: string;
}

/** Text extracted in the browser (DOCX, XLSX, CSV, TXT, MD). */
export interface TextAttachment {
  name: string;
  text: string;
}

export interface ContextPayload {
  knowledgeIds: string[];
  productIds: string[];
  notes: string;
  files: StoredFile[];
  attachments: TextAttachment[];
}

export interface GenerateRequest extends ContextPayload {
  mode: 'generate';
  brief: GenerateBrief;
  revisionNotes?: string;
  previousDraft?: unknown;
}

export interface ImportRequest extends ContextPayload {
  mode: 'import';
  brief: GenerateBrief;
}

export interface ExtractKnowledgeRequest {
  mode: 'extract_knowledge';
  files: StoredFile[];
  attachments: TextAttachment[];
  hint: string;
}

export interface QuestionContext {
  assessmentTitle: string;
  audience: string;
  scoringMethod: 'points' | 'gaps' | 'none';
  sectionName: string;
  question: { text: string; type: string; role: string; options: { label: string; points?: number; isGap?: boolean }[] };
}

export interface RewriteRequest extends QuestionContext {
  mode: 'rewrite';
}

export interface OptionsRequest extends QuestionContext {
  mode: 'options';
}

export interface TierCopyRequest {
  mode: 'tier_copy';
  assessmentTitle: string;
  audience: string;
  tierBasis: 'percent' | 'points';
  maxPoints: number | null;
  sections: string[];
  products: string[];
  tiers: { label: string; min: number; max: number }[];
}

export interface ReviewRequest {
  mode: 'review';
  /** Compact text rendering of the assessment (see summarizeDefinition). */
  outline: string;
}

export type AiRequest =
  | GenerateRequest
  | ImportRequest
  | ExtractKnowledgeRequest
  | RewriteRequest
  | OptionsRequest
  | TierCopyRequest
  | ReviewRequest;

/** Server-sent events emitted by ai-assist. */
export type AiEvent =
  | { type: 'progress'; phase: string; chars: number }
  | { type: 'result'; data: unknown; requestId: string | null; usage: { input: number; output: number; cacheRead: number } }
  | { type: 'error'; message: string; code?: string };

export const AI_LIMITS = {
  /** Max characters of knowledge + notes + text attachments per request */
  maxContextChars: 600_000,
  /** Max PDF size in bytes */
  maxFileBytes: 20 * 1024 * 1024,
  maxFiles: 5,
} as const;
