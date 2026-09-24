import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const supabase = createClient(SUPABASE_URL, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'qq-studio-auth' },
});

/** Table / view names (hyphenated per the q-quiz- naming convention). */
export const T = {
  profiles: 'q-quiz-profiles',
  products: 'q-quiz-products',
  assessments: 'q-quiz-assessments',
  versions: 'q-quiz-versions',
  responses: 'q-quiz-responses',
  events: 'q-quiz-events',
  notifications: 'q-quiz-notifications',
  config: 'q-quiz-config',
  outbox: 'q-quiz-outbox',
  stats: 'q-quiz-assessment-stats',
  knowledge: 'q-quiz-knowledge',
  aiRequests: 'q-quiz-ai-requests',
  answersView: 'q-quiz-response-answers',
} as const;

export const ASSET_BUCKET = 'q-quiz-assets';

/** Upload an image to the public assets bucket and return its public URL. */
export async function uploadAsset(file: File, folder: string): Promise<string> {
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').slice(-60);
  const path = `${folder}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
  const { error } = await supabase.storage.from(ASSET_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from(ASSET_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function errorMessage(e: unknown): string {
  if (!e) return 'Something went wrong.';
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong.';
}
