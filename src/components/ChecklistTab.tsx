"use client";

import { useState, useCallback, useEffect } from "react";
import { Analysis, ChecklistItem, ChecklistStatus } from "@/types";
import { Check, X, AlertCircle, Send, Loader2, RefreshCw, Pencil, Copy, CheckCheck, Trash2, FileSpreadsheet } from "lucide-react";

// ── Inline bold renderer ─────────────────────────────────────────────────────

function InlineText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? <strong key={i} className="font-semibold text-slate-800 dark:text-slate-100">{p}</strong> : p
      )}
    </span>
  );
}

// ── Structured description renderer ──────────────────────────────────────────

function DescriptionLines({ text, className }: { text: string; className?: string }) {
  if (!text.includes("\n")) {
    return <InlineText text={text} className={className} />;
  }
  return (
    <div className={className}>
      {text.split("\n").map((line, i) => {
        const lm = line.match(/^([A-Za-z][A-Za-z ]{0,18}):\s*(.*)/);
        return lm ? (
          <div key={i} className={i > 0 ? "mt-1.5" : ""}>
            <span className="inline-block font-semibold text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1.5">{lm[1]}:</span>
            <InlineText text={lm[2]} />
          </div>
        ) : (
          <div key={i} className={i > 0 ? "mt-1" : ""}>
            <InlineText text={line} />
          </div>
        );
      })}
    </div>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_OPTS: {
  value: ChecklistStatus;
  symbol: string;
  label: string;
  active: string;
  inactive: string;
}[] = [
  { value: "pending",       symbol: "–",  label: "Not tested",           active: "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200",                              inactive: "text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700" },
  { value: "passed",        symbol: "✓",  label: "Passed",               active: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-400 dark:ring-emerald-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400" },
  { value: "failed",        symbol: "✗",  label: "Failed",               active: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 ring-1 ring-red-400 dark:ring-red-600",       inactive: "text-slate-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400" },
  { value: "clarification", symbol: "?",  label: "Clarification Needed", active: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400 dark:ring-amber-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400" },
  { value: "blocked",       symbol: "!",  label: "Blocked",              active: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 ring-1 ring-violet-400 dark:ring-violet-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400" },
];

function statusBadgeClass(s: ChecklistStatus): string {
  switch (s) {
    case "passed":        return "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400";
    case "failed":        return "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400";
    case "clarification": return "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400";
    case "blocked":       return "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400";
    case "na":            return "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-400";
    default:              return "bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400";
  }
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseTestsFromAnalysis(analysis: Analysis): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  let idCounter = 0;

  const parseSection = (content: string, defaultCategory: string) => {
    const lines = content.split("\n");
    let category = defaultCategory;
    let currentDesc: string | null = null;

    const flush = () => {
      if (currentDesc && currentDesc.replace(/\n/g, "").trim().length > 4) {
        items.push({ id: `cl-${++idCounter}`, category, description: currentDesc.trim(), status: "pending" });
      }
      currentDesc = null;
    };

    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.+)/);
      // Bold-only line (e.g. **Happy Path Scenarios**) — treat as a category heading
      const boldHeading = !line.startsWith("-") && !line.startsWith("*") && line.match(/^\*\*([^*\n]+)\*\*\s*$/);
      const b = line.match(/^[-*\u2022]\s+(.+)/);
      const n = line.match(/^\d+\.\s+(.+)/);
      // Indented continuation line (2+ spaces or tab) belonging to the current bullet
      const isContinuation = /^[ \t]{2,}\S/.test(line) && currentDesc !== null;

      if (h) {
        flush();
        category = h[1].replace(/\*\*/g, "").trim();
      } else if (boldHeading) {
        flush();
        category = (boldHeading as RegExpMatchArray)[1].trim();
      } else if (b || n) {
        flush();
        currentDesc = (b?.[1] ?? n?.[1] ?? "").trim();
      } else if (isContinuation) {
        const cont = line.trim();
        if (cont) currentDesc += "\n" + cont;
      }
    }
    flush();
  };

  // Parse deskCheck first so Happy Path / Negative / Edge Cases appear as the leading tabs
  if (analysis.deskCheck?.content)
    parseSection(analysis.deskCheck.content, "Desk Check Scenarios");
  if (analysis.testSuggestions?.content)
    parseSection(analysis.testSuggestions.content, "Test Suggestions");

  return items;
}

// ── Comment builder (per section) ───────────────────────────────────────────

function buildSectionComment(cat: string, catItems: ChecklistItem[]): string {
  const symbolOf: Record<ChecklistStatus, string> = {
    pending: "⏳ Pending", passed: "✅ Passed", failed: "❌ Failed",
    clarification: "⚠️ Clarification Needed", blocked: "🚫 Blocked", na: "⏭️ N/A",
  };

  const passed  = catItems.filter(i => i.status === "passed").length;
  const failed  = catItems.filter(i => i.status === "failed").length;
  const clarif  = catItems.filter(i => i.status === "clarification").length;
  const blocked = catItems.filter(i => i.status === "blocked").length;
  const na      = catItems.filter(i => i.status === "na").length;

  let md = `## 🧪 ${cat}\n\n`;
  md += `**${passed} passed · ${failed} failed · ${clarif} clarification needed · ${blocked} blocked · ${na} N/A — ${catItems.length} total**\n\n`;
  catItems.forEach((item, idx) => {
    md += `${idx + 1}. [${symbolOf[item.status]}] ${item.description}\n`;
  });

  return md.trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ChecklistTabProps {
  analysis: Analysis | null;
  checklist: ChecklistItem[] | undefined;
  storyTitle?: string;
  jiraKey?: string;
  postedCategories?: string[];
  onCategoryPosted?: (category: string) => void;
  onChecklistChange: (items: ChecklistItem[]) => void;
}

// Status → label
const STATUS_LABEL: Record<ChecklistStatus, string> = {
  pending: "Not tested",
  passed: "Passed",
  failed: "Failed",
  clarification: "Clarification Needed",
  blocked: "Blocked",
  na: "N/A",
};

// Status → fill color (ARGB)
const STATUS_COLOR: Record<ChecklistStatus, string> = {
  pending:        "FFE2E8F0", // slate-200
  passed:         "FFD1FAE5", // emerald-100
  failed:         "FFFEE2E2", // red-100
  clarification:  "FFFEF3C7", // amber-100
  blocked:        "FFFFEDD5", // violet-100
  na:             "FFEDE9FE", // violet-100
};

async function downloadSectionXlsx(
  cat: string,
  catItems: ChecklistItem[],
  storyTitle: string,
  jiraKey?: string,
) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(cat.slice(0, 31));

  const dateStr     = new Date().toLocaleDateString("en-GB");
  const fileDateStr = new Date().toISOString().slice(0, 10);

  // Row 1: story title header
  const titleText = jiraKey ? `${jiraKey}: ${storyTitle}` : storyTitle;
  ws.addRow([titleText, "", "", ""]);
  const titleRow = ws.getRow(1);
  ws.mergeCells("A1:D1");
  titleRow.getCell(1).font  = { bold: true, size: 12 };
  titleRow.getCell(1).fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } }; // violet-700
  titleRow.getCell(1).font  = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  titleRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  titleRow.height = 22;

  // Row 2: section name sub-header
  ws.addRow([cat, "", "", ""]);
  const catRow = ws.getRow(2);
  ws.mergeCells("A2:D2");
  catRow.getCell(1).font  = { bold: true, size: 10, color: { argb: "FF4C1D95" } };
  catRow.getCell(1).fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDE9FE" } };
  catRow.getCell(1).alignment = { vertical: "middle", horizontal: "left" };
  catRow.height = 18;

  // Row 3: blank spacer
  ws.addRow(["", "", "", ""]);

  // Row 4: column headers
  ws.addRow(["#", "Test Case", "Status", "Date"]);
  const headerRow = ws.getRow(4);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  headerRow.height = 18;

  // Data rows
  catItems.forEach((item, idx) => {
    const row = ws.addRow([idx + 1, item.description, STATUS_LABEL[item.status], dateStr]);
    const fillColor = STATUS_COLOR[item.status];
    row.eachCell(cell => {
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    row.height = 18;
  });

  // Column widths
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 65;
  ws.getColumn(3).width = 24;
  ws.getColumn(4).width = 14;

  // Download
  const safeTitle = (storyTitle || "story").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 30);
  const safeCat   = cat.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 20);
  const fileName  = `${jiraKey ? jiraKey + "_" : ""}${safeTitle}_${safeCat}_${fileDateStr}.xlsx`;

  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChecklistTab({ analysis, checklist, storyTitle = "", jiraKey, postedCategories = [], onCategoryPosted, onChecklistChange }: ChecklistTabProps) {
  const [sectionJiraStatus, setSectionJiraStatus] = useState<Record<string, "idle" | "posting" | "posted" | "error">>({});
  const [sectionJiraError,  setSectionJiraError]  = useState<Record<string, string>>({});
  const [sConfirming,       setSConfirming]       = useState<Record<string, boolean>>({});
  const [sectionCopied,     setSectionCopied]     = useState<Record<string, boolean>>({});
  const [editingId,         setEditingId]         = useState<string | null>(null);
  const [editValue,         setEditValue]         = useState("");
  const [activeCat,         setActiveCat]         = useState<string | null>(null);
  const [addingCat,         setAddingCat]         = useState<string | null>(null);
  const [addValue,          setAddValue]          = useState("");
  // Categories emptied by item deletion but not yet hard-deleted by the user
  const [emptiedCats,       setEmptiedCats]       = useState<string[]>([]);
  const [editingCatName,    setEditingCatName]    = useState<string | null>(null);
  const [catNameValue,      setCatNameValue]      = useState("");

  // Auto-generate on first visit (when checklist is undefined)
  useEffect(() => {
    if (analysis && checklist === undefined) {
      onChecklistChange(parseTestsFromAnalysis(analysis));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const items      = checklist ?? [];
  const itemCats   = [...new Set(items.map(i => i.category))];
  // Include emptied categories (soft-deleted) so they stay visible until hard-deleted
  const categories = [...itemCats, ...emptiedCats.filter(c => !itemCats.includes(c))];
  // Active category tab — default to first; stay valid when items change
  const effectiveCat = (activeCat && categories.includes(activeCat)) ? activeCat : (categories[0] ?? "");
  const total      = items.length;
  const done       = items.filter(i => i.status !== "pending").length;
  const pct        = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleGenerate = useCallback(() => {
    if (!analysis) return;
    setEmptiedCats([]);
    onChecklistChange(parseTestsFromAnalysis(analysis));
  }, [analysis, onChecklistChange]);

  const updateStatus = useCallback((id: string, status: ChecklistStatus) => {
    onChecklistChange(items.map(i => i.id === id ? { ...i, status } : i));
  }, [items, onChecklistChange]);

  const saveEdit = useCallback((id: string) => {
    onChecklistChange(items.map(i => i.id === id ? { ...i, description: editValue.trim() || i.description } : i));
    setEditingId(null);
  }, [items, editValue, onChecklistChange]);

  const deleteItem = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (item) {
      const catItems = items.filter(i => i.category === item.category);
      if (catItems.length === 1) {
        // Last item in category — soft-delete the section (keep visible as empty)
        setEmptiedCats(prev => prev.includes(item.category) ? prev : [...prev, item.category]);
      }
    }
    onChecklistChange(items.filter(i => i.id !== id));
  }, [items, onChecklistChange]);

  const addItem = useCallback((cat: string) => {
    const text = addValue.trim();
    if (!text) { setAddingCat(null); return; }
    const newItem: ChecklistItem = {
      id: `cl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      category: cat,
      description: text,
      status: "pending",
    };
    // Reactivate section if it was emptied
    setEmptiedCats(prev => prev.filter(c => c !== cat));
    onChecklistChange([...items, newItem]);
    setAddValue("");
    setAddingCat(null);
  }, [items, addValue, onChecklistChange]);

  const deleteSection = useCallback((cat: string) => {
    onChecklistChange(items.filter(i => i.category !== cat));
    setEmptiedCats(prev => prev.filter(c => c !== cat));
    // If the deleted section was active, switch to first remaining
    if (activeCat === cat) setActiveCat(null);
  }, [items, activeCat, onChecklistChange]);

  const renameCat = useCallback((oldCat: string, newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed || trimmed === oldCat) { setEditingCatName(null); return; }
    onChecklistChange(items.map(i => i.category === oldCat ? { ...i, category: trimmed } : i));
    setEmptiedCats(prev => prev.map(c => c === oldCat ? trimmed : c));
    if (activeCat === oldCat) setActiveCat(trimmed);
    setEditingCatName(null);
  }, [items, activeCat, onChecklistChange]);

  const doSendSection = useCallback(async (cat: string, catItems: ChecklistItem[]) => {
    if (!jiraKey) return;
    setSectionJiraStatus(prev => ({ ...prev, [cat]: "posting" }));
    setSectionJiraError(prev => { const n = { ...prev }; delete n[cat]; return n; });
    const content = buildSectionComment(cat, catItems);
    try {
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: jiraKey, title: `Test Checklist: ${cat}`, content }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to post");
      setSectionJiraStatus(prev => ({ ...prev, [cat]: "posted" }));
      onCategoryPosted?.(cat);
    } catch (err) {
      setSectionJiraStatus(prev => ({ ...prev, [cat]: "error" }));
      setSectionJiraError(prev => ({ ...prev, [cat]: err instanceof Error ? err.message : "Failed to post" }));
      setTimeout(() => {
        setSectionJiraStatus(prev => ({ ...prev, [cat]: "idle" }));
        setSectionJiraError(prev => { const n = { ...prev }; delete n[cat]; return n; });
      }, 5000);
    }
  }, [jiraKey]);

  const handleSendSectionJira = useCallback((cat: string, catItems: ChecklistItem[]) => {
    if (sectionJiraStatus[cat] === "posting") return;
    if (postedCategories.includes(cat)) {
      // Already sent before — ask for confirmation
      setSConfirming(prev => ({ ...prev, [cat]: true }));
      return;
    }
    doSendSection(cat, catItems);
  }, [sectionJiraStatus, postedCategories, doSendSection]);

  const handleConfirmResend = useCallback((cat: string, catItems: ChecklistItem[]) => {
    setSConfirming(prev => ({ ...prev, [cat]: false }));
    doSendSection(cat, catItems);
  }, [doSendSection]);

  const handleCopySection = useCallback(async (cat: string, catItems: ChecklistItem[]) => {
    await navigator.clipboard.writeText(buildSectionComment(cat, catItems));
    setSectionCopied(prev => ({ ...prev, [cat]: true }));
    setTimeout(() => setSectionCopied(prev => ({ ...prev, [cat]: false })), 2500);
  }, []);

  // ── No analysis ───────────────────────────────────────────────────────────
  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
        <p className="text-sm">Run an analysis first to generate a checklist.</p>
      </div>
    );
  }

  // ── Empty / loading ───────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-10 flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100 mb-1">No checklist yet</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Generate a test execution checklist parsed from the analysis.</p>
        </div>
        <button onClick={handleGenerate}
          className="flex items-center gap-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl transition-colors">
          <RefreshCw className="w-4 h-4" /> Generate Checklist
        </button>
      </div>
    );
  }

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Overall summary bar */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-2 h-6 rounded-full bg-emerald-500" />
            <span className="font-bold text-slate-800 dark:text-slate-100">Test Execution Checklist</span>
            <span className="text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
              {done}/{total}
            </span>
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-slate-400 dark:text-slate-500">
            <span>{pct}% overall</span>
            <span>{total - done} remaining</span>
          </div>
        </div>
      </div>

      {/* Section tab bar */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat);
            const catDone  = catItems.filter(i => i.status !== "pending").length;
            const isActive  = cat === effectiveCat;
            const isAllDone = catItems.length > 0 && catDone === catItems.length;
            const isSentToJira = postedCategories.includes(cat);
            const isGreen = isAllDone || isSentToJira;
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : isGreen
                    ? "bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-700 dark:hover:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-700"
                }`}
              >
                {/* "Sent to Jira" badge — shown when category was posted */}
                {isSentToJira && !isActive && (
                  <span className="flex-shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-blue-500 text-white leading-none">
                    Jira
                  </span>
                )}
                {cat}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  isActive ? "bg-white/20 text-white" :
                  isGreen  ? "bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300" :
                  "bg-slate-100 dark:bg-slate-600 text-slate-500 dark:text-slate-400"
                }`}>{catDone}/{catItems.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active category group */}
      {categories.filter(cat => cat === effectiveCat).map(cat => {
        const catItems   = items.filter(i => i.category === cat);
        const catDone    = catItems.filter(i => i.status !== "pending").length;
        const catTotal   = catItems.length;
        const catAllDone = catTotal > 0 && catDone === catTotal;
        const catPct     = catTotal > 0 ? Math.round((catDone / catTotal) * 100) : 0;
        const isEmpty    = catTotal === 0;
        const sStatus    = sectionJiraStatus[cat] ?? "idle";
        const sCopied    = sectionCopied[cat] ?? false;
        const alreadySentToJira = postedCategories.includes(cat);

        return (
          <div key={cat} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Category header + section progress */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50">
              <div className="flex items-center justify-between gap-3 mb-2.5">
                {editingCatName === cat ? (
                  <input
                    autoFocus
                    value={catNameValue}
                    onChange={e => setCatNameValue(e.target.value)}
                    onBlur={() => renameCat(cat, catNameValue)}
                    onKeyDown={e => { if (e.key === "Enter") renameCat(cat, catNameValue); if (e.key === "Escape") setEditingCatName(null); }}
                    className="text-sm font-semibold text-slate-700 dark:text-slate-200 bg-transparent border-b-2 border-emerald-400 focus:outline-none flex-1 min-w-0"
                  />
                ) : (
                  <div className="group/catname flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{cat}</h3>
                    <button
                      onClick={() => { setEditingCatName(cat); setCatNameValue(cat); }}
                      title="Rename this section"
                      className="opacity-0 group-hover/catname:opacity-100 p-0.5 rounded text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-opacity"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {!isEmpty && <span className="text-xs font-medium text-slate-400 dark:text-slate-500">{catDone}/{catTotal}</span>}                  {!isEmpty && catDone > 0 && (
                    <button
                      onClick={() => onChecklistChange(items.map(i => i.category === cat ? { ...i, status: "pending" } : i))}
                      title="Reset all statuses in this section to Not tested"
                      className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 px-2 py-0.5 rounded-lg transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  )}                  <button
                    onClick={() => deleteSection(cat)}
                    title="Delete this entire section"
                    className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-2 py-0.5 rounded-lg transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete section</span>
                  </button>
                </div>
              </div>
              {!isEmpty && (
                <div className="h-1 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${catAllDone ? "bg-emerald-500" : "bg-violet-400 dark:bg-violet-500"}`}
                    style={{ width: `${catPct}%` }}
                  />
                </div>
              )}
            </div>

            {/* Items or empty state */}
            {isEmpty ? (
              <div className="px-6 py-8 flex flex-col items-center gap-3 text-center">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No test cases in this section</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Add one below or delete the section entirely.</p>
                </div>
              </div>
            ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {catItems.map(item => (
                <div key={item.id} className="px-6 py-4 flex items-start gap-4">
                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    {editingId === item.id ? (
                      <div className="space-y-2">
                        <textarea
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          rows={Math.max(2, Math.ceil(editValue.length / 80))}
                          className="w-full text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-violet-400 dark:border-violet-500 rounded-lg px-2.5 py-1.5 resize-y focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                        />
                        <div className="flex gap-1.5">
                          <button onClick={() => saveEdit(item.id)}
                            className="flex items-center gap-1 text-xs bg-violet-500 hover:bg-violet-600 text-white px-2.5 py-1 rounded-lg transition-colors">
                            <Check className="w-3 h-3" /> Save
                          </button>
                          <button onClick={() => setEditingId(null)}
                            className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 px-2.5 py-1 rounded-lg transition-colors">
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 group/desc">
                        <div
                          onClick={() => { setEditingId(item.id); setEditValue(item.description); }}
                          title="Click to edit"
                          className={`text-sm leading-relaxed flex-1 cursor-text hover:text-violet-600 dark:hover:text-violet-400 transition-colors ${item.status === "na" ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-300"}`}
                        >
                          <DescriptionLines text={item.description} />
                        </div>
                        <button
                          onClick={() => { setEditingId(item.id); setEditValue(item.description); }}
                          className="opacity-0 group-hover/desc:opacity-100 flex-shrink-0 mt-0.5 text-slate-400 hover:text-violet-500 dark:hover:text-violet-400 transition-opacity"
                          title="Edit description">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Status buttons + delete */}
                  {editingId !== item.id && (
                    <div className="flex-shrink-0 flex items-center gap-1 mt-0.5">
                      {STATUS_OPTS.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => updateStatus(item.id, opt.value)}
                          title={opt.label}
                          className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center font-medium transition-all ${
                            item.status === opt.value ? opt.active : opt.inactive
                          }`}
                        >
                          {opt.symbol}
                        </button>
                      ))}
                      <button
                        onClick={() => deleteItem(item.id)}
                        title="Delete this row"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 dark:hover:text-red-400 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            )} {/* end isEmpty ? ... : items list */}

            {/* Add new item row */}
            {addingCat === cat ? (
              <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-700/60 bg-emerald-50/50 dark:bg-emerald-900/10 flex items-center gap-2">
                <input
                  autoFocus
                  type="text"
                  value={addValue}
                  onChange={e => setAddValue(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addItem(cat); if (e.key === "Escape") { setAddingCat(null); setAddValue(""); } }}
                  placeholder="Describe the new test case…"
                  className="flex-1 text-sm bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 placeholder-slate-400"
                />
                <button onClick={() => addItem(cat)}
                  className="flex items-center gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                  <Check className="w-3.5 h-3.5" /> Add
                </button>
                <button onClick={() => { setAddingCat(null); setAddValue(""); }}
                  className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors">
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            ) : (
              <div className="px-6 py-2.5 border-t border-slate-100 dark:border-slate-700/60">
                <button
                  onClick={() => { setAddingCat(cat); setAddValue(""); }}
                  className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <span className="text-base leading-none">+</span> Add test case
                </button>
              </div>
            )}

            {/* Section footer: status badges + per-section action button */}
            <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-700/20 flex items-center justify-between gap-3 flex-wrap">
              {/* Status summary */}
              <div className="flex gap-2 flex-wrap">
                {!isEmpty && STATUS_OPTS.filter(o => o.value !== "pending").map(opt => {
                  const count = catItems.filter(i => i.status === opt.value).length;
                  if (!count) return null;
                  return (
                    <span key={opt.value} className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadgeClass(opt.value)}`}>
                      {opt.symbol} {count} {opt.label}
                    </span>
                  );
                })}
                {!isEmpty && catItems.every(i => i.status === "pending") && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">No items marked yet</span>
                )}
                {isEmpty && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 italic">Section is empty</span>
                )}
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                {/* Download Excel — only visible when every case in this section has been marked */}
                {!isEmpty && catAllDone && (
                  <button
                    onClick={() => downloadSectionXlsx(cat, catItems, storyTitle, jiraKey)}
                    title={`Download ${cat} as Excel`}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    Download Excel
                  </button>
                )}

              {/* Send/Copy — appears only once this section is fully marked */}
              {!isEmpty && catAllDone && (
                jiraKey ? (
                  sConfirming[cat] ? (
                    // ── Resend confirmation ──
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Already sent — re-send?</span>
                      <button
                        onClick={() => handleConfirmResend(cat, catItems)}
                        className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <Send className="w-3 h-3" /> Yes, resend
                      </button>
                      <button
                        onClick={() => setSConfirming(prev => ({ ...prev, [cat]: false }))}
                        className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-700 dark:text-slate-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  ) : (sStatus === "posted" || alreadySentToJira) ? (
                    // ── Already posted state (transient or persisted) ──
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2.5 py-1.5 rounded-lg">
                        <Check className="w-3 h-3" /> Sent to {jiraKey}
                      </span>
                      <button
                        onClick={() => setSConfirming(prev => ({ ...prev, [cat]: true }))}
                        className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2 transition-colors"
                        title="Send again"
                      >
                        Resend?
                      </button>
                    </div>
                  ) : (
                    // ── Normal send button ──
                    <button
                      onClick={() => handleSendSectionJira(cat, catItems)}
                      disabled={sStatus === "posting"}
                      title={sectionJiraError[cat] ?? `Send ${cat} results to ${jiraKey}`}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-60 flex-shrink-0 ${
                        sStatus === "error"
                          ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                          : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      {sStatus === "posting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                       : sStatus === "error"   ? <AlertCircle className="w-3.5 h-3.5" />
                       : <Send className="w-3.5 h-3.5" />}
                      {sStatus === "posting" ? "Posting…" : sStatus === "error" ? "Failed — retry?" : `Send to ${jiraKey}`}
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleCopySection(cat, catItems)}
                    title="Copy section results to clipboard — paste manually into your tracker"
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all flex-shrink-0 ${
                      sCopied
                        ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                        : "bg-slate-200 dark:bg-slate-600 hover:bg-slate-300 dark:hover:bg-slate-500 text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {sCopied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {sCopied ? "Copied!" : "Copy results"}
                  </button>
                )
              )}
              </div>{/* end actions row */}
            </div>
          </div>
        );
      })}
    </div>
  );
}
