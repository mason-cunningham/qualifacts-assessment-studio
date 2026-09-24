// Dev check: print the JSON schemas the Anthropic SDK will send for structured outputs.
// Usage: node scripts/inspect-ai-schema.mjs
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as S from '../packages/ai/src/schemas.ts';

const names = ['AiDraftSchema', 'RewriteResultSchema', 'OptionsResultSchema', 'TierCopyResultSchema', 'ReviewResultSchema', 'KnowledgeExtractSchema'];
let problems = 0;
for (const n of names) {
  const fmt = zodOutputFormat(S[n]);
  const json = JSON.stringify(fmt.schema ?? fmt);
  const bad = ['"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"additionalProperties":true', '"$schema"'].filter((k) => json.includes(k));
  const objects = (json.match(/"type":"object"/g) || []).length;
  const closed = (json.match(/"additionalProperties":false/g) || []).length;
  if (bad.length || objects !== closed) problems++;
  console.log(`${n}: ${json.length} chars, objects=${objects}, closed=${closed}${bad.length ? `, unsupported: ${bad.join(' ')}` : ''}`);
}
console.log(problems ? `${problems} schema(s) need attention` : 'All schemas look compatible');
