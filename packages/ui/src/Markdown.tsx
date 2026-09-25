import { Fragment, type ReactNode } from 'react';

// Tiny, safe Markdown subset for editor-authored copy:
//   paragraphs (blank line), "- " bullet lists, "#"–"######" headings, **bold**, *italic* / _italic_, [text](https://…)
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

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

function renderBlock(lines: string[], key: string): ReactNode {
  if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
    return (
      <ul key={key}>
        {lines.map((l, li) => (
          <li key={li}>{inline(l.replace(/^\s*[-*•]\s+/, ''), `${key}-${li}`)}</li>
        ))}
      </ul>
    );
  }
  return (
    <p key={key}>
      {lines.map((l, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {inline(l, `${key}-${li}`)}
        </Fragment>
      ))}
    </p>
  );
}

export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  if (!text || !text.trim()) return null;
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    // Headings end the current run of lines; "# / ##" → h3, deeper → h4 (never outranks the card title)
    let run: string[] = [];
    const flush = () => {
      if (run.length) out.push(renderBlock(run, `${bi}-${out.length}`));
      run = [];
    };
    for (const line of block.split('\n')) {
      const h = HEADING.exec(line);
      if (h) {
        flush();
        const Tag = h[1].length <= 2 ? 'h3' : 'h4';
        out.push(<Tag key={`${bi}-${out.length}`}>{inline(h[2], `${bi}-h${out.length}`)}</Tag>);
      } else if (line.trim() || run.length) {
        run.push(line);
      }
    }
    flush();
  });
  return <div className={className}>{out}</div>;
}

/** Inline-only variant (no paragraphs) for headings and short labels. */
export function InlineMarkdown({ text }: { text?: string | null }) {
  if (!text) return null;
  return <>{inline(text, 'i')}</>;
}
