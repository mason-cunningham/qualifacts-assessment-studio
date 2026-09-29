import { describe, expect, it } from 'vitest';
import { pptxPartsToText, slideXmlToText } from './pptx';

const slide = (paras: string[][]) =>
  `<p:sld><p:cSld><p:spTree>${paras.map((runs) => `<a:p>${runs.map((r) => `<a:r><a:rPr lang="en-US"/><a:t>${r}</a:t></a:r>`).join('')}</a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;

describe('pptx text extraction', () => {
  it('joins runs per paragraph and decodes entities', () => {
    expect(slideXmlToText(slide([['Real-time ', 'eligibility'], ['Fewer denials &amp; faster cash']]))).toBe('Real-time eligibility\nFewer denials & faster cash');
  });

  it('orders slides numerically and attaches speaker notes', () => {
    const text = pptxPartsToText([
      { path: 'ppt/slides/slide10.xml', xml: slide([['Ten']]) },
      { path: 'ppt/slides/slide2.xml', xml: slide([['Two']]) },
      { path: 'ppt/notesSlides/notesSlide2.xml', xml: slide([['Say this'], ['2']]) },
      { path: 'ppt/slideLayouts/slideLayout1.xml', xml: slide([['Layout junk']]) },
    ]);
    expect(text).toBe('## Slide 2\nTwo\nNotes: Say this\n\n## Slide 10\nTen');
  });
});
