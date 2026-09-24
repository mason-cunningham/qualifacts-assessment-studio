/**
 * Parse a JSON object out of a model response that was NOT produced with
 * constrained decoding (see AiDraft in schemas.ts). Tolerates surrounding
 * whitespace, a ```json code fence, and stray prose before/after the object.
 * Throws if no valid JSON object can be found.
 */
export function extractJsonObject(raw: string): unknown {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1];
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No JSON object found');
    return JSON.parse(s.slice(start, end + 1));
  }
}
