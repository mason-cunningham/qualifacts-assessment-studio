// Read-only smoke checks of the live Supabase schema from an anonymous (prospect) client.
// Usage: node scripts/check-db.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

let failures = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const TABLES = [
  'q-quiz-profiles', 'q-quiz-products', 'q-quiz-assessments', 'q-quiz-versions', 'q-quiz-responses',
  'q-quiz-events', 'q-quiz-config', 'q-quiz-notifications', 'q-quiz-outbox', 'q-quiz-ai-requests',
  'q-quiz-response-answers', 'q-quiz-assessment-stats',
];
for (const t of TABLES) {
  const { data, error } = await sb.from(t).select('*').limit(1);
  ok(`anon cannot read "${t}"`, !!error || (Array.isArray(data) && data.length === 0), error ? error.code + ' ' + error.message : `returned ${data?.length} rows`);
}

{
  const { data, error } = await sb.rpc('q_quiz_get_published', { p_slug: 'does-not-exist' });
  ok('q_quiz_get_published(unknown slug) returns null', !error && data === null, error?.message ?? JSON.stringify(data));
}
{
  const { error } = await sb.rpc('q_quiz_publish', { p_assessment_id: '00000000-0000-0000-0000-000000000000', p_definition: {}, p_change_note: null });
  ok('anon cannot call q_quiz_publish', !!error, error?.code + ' ' + error?.message);
}
{
  const { error } = await sb.rpc('q_quiz_is_admin');
  ok('anon cannot call role helpers', !!error, error?.code + ' ' + error?.message);
}
{
  const { error } = await sb.rpc('q_quiz_submit_response', { p_payload: { assessment_id: '00000000-0000-0000-0000-000000000000' } });
  ok('submit to a non-existent assessment is rejected', !!error && /not found/i.test(error.message), error?.message);
}
{
  const { error } = await sb.rpc('q_quiz_track_event', {
    p_assessment_id: '00000000-0000-0000-0000-000000000000', p_session_id: '00000000-0000-0000-0000-000000000000',
    p_event_type: 'view', p_question_id: null, p_meta: {}, p_version_id: null,
  });
  ok('anon can call q_quiz_track_event (no-op for unknown assessment)', !error, error?.message);
}
{
  const { data, error } = await sb.storage.from('q-quiz-assets').list('', { limit: 1 });
  ok('q-quiz-assets bucket exists', !error, error?.message ?? `${data?.length ?? 0} objects listed`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
