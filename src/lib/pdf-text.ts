import type { jsPDF } from "jspdf";

// jsPDF's built-in fonts only cover WinAnsi (Latin-1 + a few typographic chars).
// Anything else (→, ≤, ✓, emoji…) makes jsPDF fall back to a broken encoding for the
// whole string — garbled glyphs ("!’") and stray spaces inside words ("val idat ion").
const REPLACEMENTS: Record<string, string> = {
  "→": "->", "⇒": "=>", "←": "<-", "↔": "<->", "↑": "^", "↓": "v",
  "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", "×": "x",
  "✓": "OK", "✔": "OK", "✅": "OK", "✗": "X", "✘": "X", "❌": "X",
  "⚠": "!", "‑": "-", "‐": "-", "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u200b": "",
};
const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

export function pdfSafe(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.includes(ch)) {
      out += REPLACEMENTS[ch] ?? ch;
    } else if (REPLACEMENTS[ch] !== undefined) {
      out += REPLACEMENTS[ch];
    }
    // other unsupported chars (emoji, symbols) are dropped
  }
  return out.replace(/ {2,}/g, " ");
}

/** Strip inline markdown and make the text printable with jsPDF's standard fonts. */
export function pdfInline(s: string): string {
  return pdfSafe(
    s
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1"),
  ).trim();
}

export interface PdfMarkdownOpts {
  margin: number;
  contentW: number;
  pageW: number;
  pageH: number;
  lineH: number;
  bodySize: number;
  rgb: [number, number, number];
}

/** Render a markdown block into the doc starting at y; returns the new y. */
export function renderMarkdownPdf(doc: jsPDF, content: string, startY: number, o: PdfMarkdownOpts): number {
  let y = startY;
  const { margin, contentW, pageW, pageH, lineH, bodySize, rgb } = o;
  const checkPage = (needed: number) => {
    if (y + needed > pageH - 56) { doc.addPage(); y = 56; }
  };
  const body = () => { doc.setFont("helvetica", "normal"); doc.setFontSize(bodySize); doc.setTextColor(51, 65, 85); };

  for (const rawLine of content.split("\n")) {
    if (!rawLine.trim()) { y += 5; continue; }
    const indentLevel = Math.min(3, Math.floor((rawLine.match(/^\s*/)?.[0].replace(/\t/g, "  ").length ?? 0) / 2));
    const line = rawLine.trim();
    const hm = line.match(/^#{1,6}\s+(.+)/);
    const bm = line.match(/^[-*+]\s+(.+)/);
    const nm = line.match(/^(\d+)[.)]\s+(.+)/);
    const ind = indentLevel * 16;

    if (hm) {
      checkPage(32); y += 10;
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      const wh = doc.splitTextToSize(pdfInline(hm[1]).toUpperCase(), contentW - 20);
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.rect(margin, y - 10, 3.5, 14, "F");
      doc.text(wh, margin + 10, y);
      y += wh.length * lineH + 4;
      doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.3);
      doc.line(margin + 10, y - 2, pageW - margin, y - 2);
      y += 8;
      continue;
    }

    body();
    if (bm) {
      const w = doc.splitTextToSize(pdfInline(bm[1]), contentW - 28 - ind);
      checkPage(w.length * lineH + 4);
      if (indentLevel > 0) {
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.8);
        doc.circle(margin + 10 + ind, y - 3.5, 1.8, "S");
      } else {
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.circle(margin + 10, y - 3.5, 2.5, "F");
      }
      doc.text(w, margin + 20 + ind, y);
      y += w.length * lineH + 2;
      continue;
    }
    if (nm) {
      const w = doc.splitTextToSize(pdfInline(nm[2]), contentW - 28 - ind);
      checkPage(w.length * lineH + 4);
      doc.setFont("helvetica", "bold"); doc.setFontSize(bodySize - 1); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
      doc.text(`${nm[1]}.`, margin + 8 + ind, y);
      body();
      doc.text(w, margin + 24 + ind, y);
      y += w.length * lineH + 2;
      continue;
    }
    const w = doc.splitTextToSize(pdfInline(line), contentW - 12 - ind);
    checkPage(w.length * lineH + 2);
    doc.text(w, margin + 6 + ind, y);
    y += w.length * lineH + 3;
  }
  return y;
}
