import type { Cell, Row } from "exceljs";
import type { ChecklistItem, ChecklistStatus } from "@/types";
import { resultRows, requestText, stepLabel, RESULT, RESULT_ORDER } from "@/lib/jira-results";

// Result cell colours (fill / text), matching the app's status colours
const RESULT_STYLE: Record<ChecklistStatus, { fill: string; font: string }> = {
  passed:        { fill: "FFDCFCE7", font: "FF166534" },
  failed:        { fill: "FFFEE2E2", font: "FF991B1B" },
  clarification: { fill: "FFFEF3C7", font: "FF92400E" },
  blocked:       { fill: "FFEDE9FE", font: "FF5B21B6" },
  na:            { fill: "FFF1F5F9", font: "FF475569" },
  pending:       { fill: "FFF1F5F9", font: "FF64748B" },
};

const BORDER = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
// Strong line between test cases, light lines between columns
const CASE_EDGE = { style: "medium" as const, color: { argb: "FF94A3B8" } };
const BORDERS = { top: CASE_EDGE, left: BORDER, bottom: CASE_EDGE, right: BORDER };
const FONT = "Calibri";

/** Rough row height so wrapped text is fully visible when the file opens. */
function fitHeight(values: string[], widths: number[]): number {
  let lines = 1;
  values.forEach((v, i) => {
    const w = Math.max(4, widths[i] * 1.15);
    const n = String(v ?? "").split("\n").reduce((sum, l) => sum + Math.max(1, Math.ceil(l.length / w)), 0);
    lines = Math.max(lines, n);
  });
  return Math.max(22, lines * 14 + 8);
}

export async function buildResultsXlsx(opts: {
  sheetName: string;
  heading: string;      // e.g. "LSINST-3897: Change interest rate…"
  section: string;      // e.g. "Test cases"
  items: ChecklistItem[];
  refLabel?: string;
  environment?: string;
}) {
  const rows = resultRows(opts.items);
  const withRef = !!opts.refLabel && rows.some((r) => r.ref);
  const withApi = rows.some((r) => r.apis.length);

  const cols: { header: string; width: number }[] = [
    { header: "ID", width: 8 },
    { header: "Test case", width: 34 },
    { header: "Starting point", width: 30 },
    { header: "Steps", width: 46 },
    { header: "Test data", width: 26 },
    { header: "Expected result", width: 42 },
    ...(withApi ? [{ header: "Request", width: 48 }] : []),
    { header: "Type", width: 11 },
    ...(withRef ? [{ header: opts.refLabel!, width: 18 }] : []),
    { header: "Result", width: 20 },
  ];
  const n = cols.length;
  const lastCol = String.fromCharCode(64 + n);
  const resultCol = n;
  const typeCol = withApi ? 8 : 7;
  const apiCol = withApi ? 7 : 0;

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "StoryAnalyzer";
  const ws = wb.addWorksheet(opts.sheetName.slice(0, 31) || "Test results", {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });

  const merged = (rowNo: number, text: string, style: (c: Cell, r: Row) => void) => {
    const r = ws.getRow(rowNo);
    r.getCell(1).value = text;
    ws.mergeCells(`A${rowNo}:${lastCol}${rowNo}`);
    style(r.getCell(1), r);
  };

  // 1–3: title, context line, summary
  merged(1, opts.heading, (c, r) => {
    c.font = { name: FONT, size: 16, bold: true, color: { argb: "FF0F172A" } };
    c.alignment = { vertical: "middle" };
    r.height = 30;
  });
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const env = opts.environment?.trim();
  merged(2, `Environment: ${env || "not specified"}   ·   ${opts.section}   ·   ${date}`, (c, r) => {
    c.font = { name: FONT, size: 11, bold: !!env, color: { argb: env ? "FF1E293B" : "FFB45309" } };
    c.alignment = { vertical: "middle" };
    r.height = 18;
  });

  // Summary: one coloured chip per result that occurs
  const summaryRow = ws.getRow(3);
  summaryRow.height = 22;
  const present = RESULT_ORDER.filter((s) => rows.some((r) => r.status === s));
  summaryRow.getCell(1).value = `${rows.length} total`;
  summaryRow.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: "FF0F172A" } };
  summaryRow.getCell(1).alignment = { vertical: "middle" };
  present.slice(0, n - 1).forEach((s, i) => {
    const c = summaryRow.getCell(i + 2);
    c.value = `${RESULT[s].label}: ${rows.filter((r) => r.status === s).length}`;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: RESULT_STYLE[s].font } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RESULT_STYLE[s].fill } };
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.border = { top: { style: "thin", color: { argb: "FFFFFFFF" } }, bottom: { style: "thin", color: { argb: "FFFFFFFF" } }, left: { style: "medium", color: { argb: "FFFFFFFF" } }, right: { style: "medium", color: { argb: "FFFFFFFF" } } };
  });
  ws.getRow(4).height = 8;

  // 5: column headers
  const header = ws.getRow(5);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: i === 0 || i >= typeCol - 1 ? "center" : "left", indent: i === 0 || i >= typeCol - 1 ? 0 : 1 };
    cell.border = { ...BORDERS, top: { style: "thin", color: { argb: "FF1E293B" } } };
  });
  header.height = 26;

  // Test case rows
  rows.forEach((r, idx) => {
    const values: string[] = [
      r.id,
      r.title,
      r.given,
      r.steps.map((s, i) => `${i + 1}. ${s}${r.apis.some((a) => a.step === i + 1) ? "  [see Request ▶]" : ""}`).join("\n"),
      r.data.map(([k, v]) => (v ? `${k}: ${v}` : k)).join("\n"),
      r.expected.length > 1 ? r.expected.map((e) => `• ${e}`).join("\n") : (r.expected[0] ?? ""),
      ...(withApi ? [r.apis.map((a) => `▶ ${a.step ? `Step ${a.step}` : stepLabel(a, r.steps)}\n${requestText(a)}`).join("\n\n")] : []),
      r.type,
      ...(withRef ? [r.ref] : []),
      RESULT[r.status].label,
    ];
    const row = ws.addRow(values.map((v) => v || "—"));
    const zebra = idx % 2 === 1 ? "FFF8FAFC" : "FFFFFFFF";
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const centered = col === 1 || col >= typeCol;
      cell.font = { name: FONT, size: 10, color: { argb: values[col - 1] ? "FF334155" : "FFCBD5E1" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      cell.alignment = { vertical: "top", horizontal: centered ? "center" : "left", wrapText: true, indent: centered ? 0 : 1 };
      cell.border = BORDERS;
    });
    row.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: "FF0F172A" } };
    row.getCell(2).font = { name: FONT, size: 10, bold: true, color: { argb: "FF0F172A" } };
    if (apiCol && r.apis.length) {
      const c = row.getCell(apiCol);
      c.font = { name: "Consolas", size: 9, color: { argb: "FF0F172A" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    }
    if (r.type) row.getCell(typeCol).font = { name: FONT, size: 10, bold: true, color: { argb: r.type === "Negative" ? "FFBE123C" : "FF047857" } };
    const res = row.getCell(resultCol);
    res.font = { name: FONT, size: 10, bold: true, color: { argb: RESULT_STYLE[r.status].font } };
    res.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RESULT_STYLE[r.status].fill } };
    res.alignment = { vertical: "top", horizontal: "center", wrapText: true };
    row.height = fitHeight(values, cols.map((c) => c.width)) + 6;
  });

  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: n } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}