// Plain-text extraction from PowerPoint (.pptx) files for AI context.
// A .pptx is a zip; slide text lives in <a:t> runs inside ppt/slides/slideN.xml and
// speaker notes in ppt/notesSlides/notesSlideN.xml. Images aren't extracted: for
// visual-heavy decks, exporting to PDF lets Claude see the slides themselves.

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** Text of one slide/notes XML part: one line per paragraph (<a:p>), runs joined. */
export function slideXmlToText(xml: string): string {
  return xml
    .split(/<a:p[\s>]/)
    .slice(1)
    .map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1])).join('').trim())
    .filter(Boolean)
    .join('\n');
}

const slideNum = (path: string) => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);

/** Build "## Slide N" sections (with "Notes:") from the zip's XML parts. */
export function pptxPartsToText(parts: { path: string; xml: string }[]): string {
  const notes = new Map(
    parts.filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p.path)).map((p) => [slideNum(p.path), slideXmlToText(p.xml)]),
  );
  return parts
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p.path))
    .sort((a, b) => slideNum(a.path) - slideNum(b.path))
    .map((p) => {
      const n = slideNum(p.path);
      const body = slideXmlToText(p.xml);
      // Notes slides repeat the slide number placeholder; drop a lone number
      const note = (notes.get(n) ?? '').replace(/^\d+$/m, '').trim();
      return [`## Slide ${n}`, body, note && `Notes: ${note}`].filter(Boolean).join('\n');
    })
    .join('\n\n');
}
