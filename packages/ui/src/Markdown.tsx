import { Fragment, type ReactNode } from 'react';

// Tiny, safe Markdown subset for editor-authored copy:
//   paragraphs (blank line), "- " bullet lists, **bold**, *italic* / _italic_, [text](https://…)
// Renders React elements only (never innerHTML), and only allows http(s)/mailto links,
// so respondent-supplied merge values (names, orgs) can't inject markup.

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*(.+?)\*|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyPrefix}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] !== undefined) {
      const url = m[3];
      out.push(
        SAFE_URL.test(url) ? (
          <a key={k} href={url} target="_blank" rel="noopener noreferrer">
            {m[2]}
          </a>
        ) : (
          <Fragment key={k}>{m[2]}</Fragment>
        ),
      );
    } else if (m[4] !== undefined) out.push(<em key={k}>{inline(m[4], k)}</em>);
    else if (m[5] !== undefined) out.push(<em key={k}>{inline(m[5], k)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  if (!text || !text.trim()) return null;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Inline-only variant (no paragraphs) for headings and short labels. */
export function InlineMarkdown({ text }: { text?: string | null }) {
  if (!text) return null;
  return <>{inline(text, 'i')}</>;
}
