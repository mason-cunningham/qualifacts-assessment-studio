import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ReportFacts } from './report';
import type { ReportContent } from './schemas';

// ─────────────────────────────────────────────────────────────────────────────
// Draws the per-response report PDF (same look as the original Eligibility
// Healthcheck report). Used by the report-pdf Edge Function and unit tests.
// NOT exported from the package index, so pdf-lib never lands in the Studio bundle.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReportAssets {
  regular?: Uint8Array | null;
  bold?: Uint8Array | null;
  extraBold?: Uint8Array | null;
  /** White logo PNG for the dark header band */
  logoPng?: Uint8Array | null;
}

const PW = 612, PH = 792, M = 40, CW = PW - 2 * M;
const HEADER_H = 80, FLOOR = 64, TOP = PH - HEADER_H - 28;

const hex = (h: string): RGB => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0.4, 0.4, 0.45);
};

const C = {
  navy: hex('#2D2264'),
  lavender: hex('#7E7DB5'),
  headerSub: hex('#C9C4E6'),
  teal: hex('#00B2A9'),
  body: hex('#1A1A2E'),
  muted: hex('#6B6B80'),
  white: rgb(1, 1, 1),
  card: hex('#F6F4FA'),
  divider: hex('#DCDAE6'),
};

/**
 * Swap typographic punctuation for plain equivalents before drawing. Ekster's en/em dash
 * glyphs come out as a stray "s" plus broken lines in PDF viewers; hyphens render fine.
 */
export function plainText(s: string): string {
  return String(s ?? '')
    .replace(/\s*[\u2014\u2015]\s*/g, ' - ') // em dash / horizontal bar -> spaced hyphen
    .replace(/(\d)\s*[\u2012\u2013]\s*(\d)/g, '$1-$2') // numeric en-dash ranges -> 3-5
    .replace(/\s*[\u2012\u2013]\s*/g, ' - ')
    .replace(/[\u2010\u2011\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u200C\u200D\u2060\uFEFF]/g, '')
    .replace(/[\u2028\u2029\r]/g, '\n');
}

export function wrapText(text: string, measure: (s: string) => number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (measure(test) > maxW && cur) {
        out.push(cur);
        cur = w;
      } else cur = test;
    }
    out.push(cur);
  }
  return out.length ? out : [''];
}

export async function buildReportPdf(f: ReportFacts, content: ReportContent, assets: ReportAssets = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(f.title);
  doc.setAuthor('Qualifacts');
  doc.setSubject(f.assessmentTitle);
  doc.setCreator('Qualifacts Assessment Studio');

  // Ekster when available; Helvetica fallback (WinAnsi only, so text is sanitized)
  let fallback = false;
  const embed = async (bytes: Uint8Array | null | undefined, std: StandardFonts): Promise<PDFFont> => {
    if (bytes?.length) {
      // Full embed: fontkit's subsetter breaks Ekster (lost weights, spacing, "fi" ligatures)
      try { return await doc.embedFont(bytes, { subset: false }); } catch { /* fall through */ }
    }
    fallback = true;
    return doc.embedFont(std);
  };
  const fReg = await embed(assets.regular, StandardFonts.Helvetica);
  const fBold = await embed(assets.bold, StandardFonts.HelveticaBold);
  const fBlack = await embed(assets.extraBold ?? assets.bold, StandardFonts.HelveticaBold);
  const t = (s: string) => {
    const p = plainText(s);
    return fallback ? p.replace(/[^\n\x20-\x7E\xA0-\xFF•€™]/g, '') : p;
  };

  let logo: PDFImage | null = null;
  if (assets.logoPng?.length) {
    try { logo = await doc.embedPng(assets.logoPng); } catch { logo = null; }
  }

  const roundRect = (page: PDFPage, x: number, yBot: number, w: number, h: number, r: number, color: RGB) => {
    const cr = Math.min(r, w / 2, h / 2);
    const p = `M ${cr},0 H ${w - cr} Q ${w},0 ${w},${cr} V ${h - cr} Q ${w},${h} ${w - cr},${h} H ${cr} Q 0,${h} 0,${h - cr} V ${cr} Q 0,0 ${cr},0 Z`;
    page.drawSvgPath(p, { x, y: yBot + h, color });
  };
  const wrap = (text: string, font: PDFFont, size: number, maxW: number) => wrapText(t(text), (s) => font.widthOfTextAtSize(s, size), maxW);

  const newPage = () => {
    const page = doc.addPage([PW, PH]);
    page.drawRectangle({ x: 0, y: PH - HEADER_H, width: PW, height: HEADER_H, color: C.navy });
    if (logo) {
      const lh = 30, lw = (logo.width / logo.height) * lh;
      page.drawImage(logo, { x: M, y: PH - HEADER_H + 30, width: Math.min(lw, 220), height: lh });
    } else {
      page.drawText('QUALIFACTS', { x: M, y: PH - 44, size: 20, font: fBlack, color: C.white });
    }
    page.drawText(t(f.brandLine), { x: M, y: PH - HEADER_H + 12, size: 7.5, font: fReg, color: C.headerSub });
    return page;
  };

  let page = newPage();
  let y = TOP;
  const ensure = (h: number) => {
    if (y - h < FLOOR) {
      page = newPage();
      y = TOP;
    }
  };
  const para = (text: string, font: PDFFont, size: number, color: RGB, x: number, maxW: number, lineH: number) => {
    for (const line of wrap(text, font, size, maxW)) {
      ensure(lineH);
      page.drawText(line, { x, y, size, font, color });
      y -= lineH;
    }
  };
  const label = (text: string, color = C.lavender, size = 8) => {
    page.drawText(t(text.toUpperCase()), { x: M, y, size, font: fBold, color });
  };

  // ── Page 1: title, prepared-for, score, sections, summary ──
  for (const line of wrap(f.title, fBlack, 18, CW)) {
    page.drawText(line, { x: M, y, size: 18, font: fBlack, color: C.navy });
    y -= 22;
  }
  y -= 2;
  const who = [f.respondent.name, f.respondent.organization].filter(Boolean).join('  ·  ') || 'Prepared for you';
  const date = new Date(f.completedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  page.drawText(t(who), { x: M, y, size: 9, font: fReg, color: C.muted });
  page.drawText(t(date), { x: PW - M - fReg.widthOfTextAtSize(t(date), 9), y, size: 9, font: fReg, color: C.muted });
  y -= 22;

  if (f.score.kind !== 'none') {
    const cardH = 88;
    const accent = hex(f.tierColor);
    roundRect(page, M, y - cardH, CW, cardH, 12, C.card);
    page.drawText('OVERALL SCORE', { x: M + 18, y: y - 18, size: 8, font: fBold, color: C.lavender });
    const big = f.score.kind === 'points' ? String(f.score.value ?? 0) : `${f.score.pct ?? 0}%`;
    page.drawText(big, { x: M + 18, y: y - 70, size: 46, font: fBlack, color: accent });
    const lx = M + 18 + fBlack.widthOfTextAtSize(big, 46) + 16;
    if (f.tierLabel) page.drawText(t(f.tierLabel), { x: lx, y: y - 44, size: 15, font: fBold, color: accent });
    const sub = f.score.kind === 'points' ? `out of ${f.score.max ?? '—'}` : 'overall';
    page.drawText(t(sub), { x: lx, y: f.tierLabel ? y - 62 : y - 50, size: 9, font: fReg, color: C.muted });
    y -= cardH + 22;
  }

  if (f.sections.length) {
    label('Section breakdown');
    y -= 14;
    const cols = 4, gap = 8, cellW = (CW - (cols - 1) * gap) / cols, cellH = 64;
    const rows = Math.ceil(f.sections.length / cols);
    ensure(rows * (cellH + gap));
    f.sections.forEach((s, i) => {
      const cx = M + (i % cols) * (cellW + gap);
      const cy = y - (Math.floor(i / cols) + 1) * (cellH + gap) + gap;
      roundRect(page, cx, cy, cellW, cellH, 10, C.card);
      const val = s.pct == null ? 'N/A' : `${s.pct}%`;
      page.drawText(val, { x: cx + 10, y: cy + cellH - 26, size: 20, font: fBlack, color: hex(s.color) });
      wrap(s.name, fReg, 7.5, cellW - 18).slice(0, 2).forEach((ln, li) => {
        page.drawText(ln, { x: cx + 10, y: cy + 20 - li * 10, size: 7.5, font: fReg, color: C.body });
      });
    });
    y -= rows * (cellH + gap) + 18;
  }

  if (content.executiveSummary) {
    ensure(60);
    label('Executive summary');
    y -= 16;
    para(content.executiveSummary, fReg, 10, C.body, M, CW, 15);
  }

  // ── Gap analysis & recommendations ──
  if (content.sections.length) {
    if (y < 300) { page = newPage(); y = TOP; } else y -= 26;
    label('Gap analysis & recommendations', C.lavender, 9);
    y -= 28;
    content.sections.forEach((sec, si) => {
      const s = f.sections.find((x) => x.id === sec.sectionId);
      const name = s?.name ?? 'Section';
      // Keep the heading with the start of its content
      ensure(110);
      page.drawText(t(name), { x: M, y, size: 13, font: fBold, color: C.navy });
      if (s?.pct != null) {
        page.drawText(` - ${s.pct}%`, { x: M + fBold.widthOfTextAtSize(t(name), 13), y, size: 13, font: fBold, color: hex(s.color) });
      }
      y -= 20;
      const block = (heading: string, text: string, color = C.body) => {
        // Heading + at least two lines stay together
        ensure(14 + Math.min(2, wrap(text, fReg, 9, CW - 12).length) * 13);
        page.drawText(t(heading), { x: M, y, size: 9, font: fBold, color });
        y -= 14;
        para(text, fReg, 9, C.muted, M + 12, CW - 12, 13);
        y -= 8;
      };
      if (sec.gap) block('Gap', sec.gap);
      if (sec.impact) block(f.impactLabel, sec.impact);
      if (sec.recommendations.length) {
        // Never strand the heading: keep it with the whole first recommendation
        ensure(14 + wrap(sec.recommendations[0], fReg, 9, CW - 28).length * 13);
        page.drawText('Recommendations', { x: M, y, size: 9, font: fBold, color: C.teal });
        y -= 14;
        for (const rec of sec.recommendations) {
          const lines = wrap(rec, fReg, 9, CW - 28);
          ensure(lines.length * 13);
          lines.forEach((ln, li) => {
            if (li === 0) page.drawText('•', { x: M + 12, y, size: 9, font: fReg, color: C.teal });
            page.drawText(ln, { x: M + 22, y, size: 9, font: fReg, color: C.body });
            y -= 13;
          });
          y -= 3;
        }
      }
      if (si < content.sections.length - 1) {
        y -= 8;
        if (y > FLOOR + 10) page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: C.divider });
        y -= 20;
      }
    });
  }

  // ── How Qualifacts can help (only when solutions were recommended) ──
  if (f.solutions.length) {
    y -= 22;
    ensure(60);
    page.drawText('How Qualifacts can help', { x: M, y, size: 12, font: fBold, color: C.navy });
    y -= 18;
    for (const sol of f.solutions) {
      const head = sol.name + (sol.tagline ? `: ${sol.tagline}` : '');
      const lines = wrap(head, fBold, 9, CW - 22);
      ensure(lines.length * 13 + 14);
      lines.forEach((ln, li) => {
        if (li === 0) page.drawText('•', { x: M + 4, y, size: 9, font: fReg, color: C.teal });
        page.drawText(ln, { x: M + 14, y, size: 9, font: fBold, color: C.body });
        y -= 13;
      });
      if (sol.features.length) para(sol.features.join(' · '), fReg, 8.5, C.muted, M + 14, CW - 14, 12);
      y -= 4;
    }
  }

  if (content.conclusion) {
    y -= 18;
    ensure(50);
    page.drawText('Conclusion', { x: M, y, size: 12, font: fBold, color: C.navy });
    y -= 18;
    para(content.conclusion, fReg, 9.5, C.muted, M, CW, 14);
  }

  // ── Footer on every page, with page numbers ──
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const fy = 28;
    p.drawLine({ start: { x: M, y: fy + 22 }, end: { x: PW - M, y: fy + 22 }, thickness: 0.5, color: C.divider });
    p.drawText(t(f.footerLine), { x: M, y: fy + 10, size: 7, font: fReg, color: C.muted });
    p.drawText('This report was generated with AI assistance. Content should be reviewed by a qualified professional.', { x: M, y: fy - 2, size: 7, font: fReg, color: C.muted });
    const right = `Confidential  ·  Page ${i + 1} of ${pages.length}`;
    p.drawText(right, { x: PW - M - fReg.widthOfTextAtSize(right, 7), y: fy - 2, size: 7, font: fReg, color: C.muted });
  });

  return doc.save();
}
