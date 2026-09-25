import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown', () => {
  it('renders headings instead of printing "#" marks', () => {
    expect(html('### Next steps\nCall us today.')).toBe('<div><h4>Next steps</h4><p>Call us today.</p></div>');
    expect(html('## Big one')).toBe('<div><h3>Big one</h3></div>');
    expect(html('Intro line\n# Heading\n- a\n- b')).toBe('<div><p>Intro line</p><h3>Heading</h3><ul><li>a</li><li>b</li></ul></div>');
  });
  it('keeps paragraphs, bullets and bold working', () => {
    expect(html('Hello **there**\nline two\n\n- one\n- two')).toBe('<div><p>Hello <strong>there</strong><br/>line two</p><ul><li>one</li><li>two</li></ul></div>');
  });
  it('treats "#tag" without a space as text', () => {
    expect(html('#1 priority')).toBe('<div><p>#1 priority</p></div>');
  });
});
