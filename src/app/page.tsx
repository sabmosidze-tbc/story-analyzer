"use client";

import { useState, useCallback, useRef } from "react";
import { useHistory } from "@/hooks/useHistory";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import StoryInput from "@/components/StoryInput";
import AnalysisCard from "@/components/AnalysisCard";
import StructuredListCard from "@/components/StructuredListCard";
import ChecklistTab from "@/components/ChecklistTab";
import EmptyState from "@/components/EmptyState";
import EpicAnalyzer from "@/components/EpicAnalyzer";
import JiraBoardBadge from "@/components/JiraBoardBadge";
import { useEpicLibrary } from "@/hooks/useEpicLibrary";
import { Analysis, StructuredBlock } from "@/types";
import { Check, Download, Cpu, RefreshCw, Loader2, X, ExternalLink } from "lucide-react";

// ── Progressive JSON section extractor for SSE streaming ────────────────────
function tryExtractJsonObject(text: string, key: string): unknown {
  const keyIdx = text.indexOf(`"${key}"`);
  if (keyIdx === -1) return null;
  let pos = keyIdx + key.length + 2;
  while (pos < text.length && /[\s:]/.test(text[pos])) pos++;
  if (pos >= text.length || (text[pos] !== "{" && text[pos] !== "[")) return null;
  const start = pos;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\" && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{" || c === "[") { stack.push(c); continue; }
    if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function tryParsePartialAnalysis(text: string): Partial<Analysis> {
  const result: Partial<Analysis> = {};
  const e = tryExtractJsonObject(text, "explanation");
  if (e) result.explanation = e as Analysis["explanation"];
  const d = tryExtractJsonObject(text, "deskCheck");
  if (d) result.deskCheck = d as Analysis["deskCheck"];
  const ts = tryExtractJsonObject(text, "testSuggestions");
  if (ts) result.testSuggestions = ts as Analysis["testSuggestions"];
  const amb = tryExtractJsonObject(text, "ambiguities");
  if (amb) result.ambiguities = amb as StructuredBlock;
  const ass = tryExtractJsonObject(text, "assumptions");
  if (ass) result.assumptions = ass as StructuredBlock;
  const oq = tryExtractJsonObject(text, "openQuestions");
  if (oq) result.openQuestions = oq as StructuredBlock;
  return result;
}

function isCompleteAnalysis(a: Partial<Analysis> | null): a is Analysis {
  return !!(a?.explanation && a?.deskCheck && a?.testSuggestions);
}

function CardSkeleton({ barColor = "bg-violet-500" }: { barColor?: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden animate-pulse">
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2.5">
        <div className={`w-2 h-6 rounded-full ${barColor} opacity-30`} />
        <div className="h-4 w-48 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-16 rounded bg-slate-100 dark:bg-slate-700 ml-auto" />
      </div>
      <div className="px-6 py-5 space-y-2.5">
        {[100, 85, 70, 95, 75, 60, 88].map((w, i) => (
          <div key={i} className="h-3 rounded bg-slate-100 dark:bg-slate-700" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
const { entries, addPendingEntry, finalizeEntry, updateEntry, patchAnalysis, patchChecklist, markJiraPosted, markChecklistCategoryPosted, removeEntry, renameEntry, getEntry } = useHistory();
  const { findEpicByStoryKey } = useEpicLibrary();
  const [mainView, setMainView] = useState<"stories" | "epics">("stories");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<Partial<Analysis> | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [reanalyzeStates, setReanalyzeStates] = useState<Record<string, { show: boolean; text: string }>>({}); 
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<{ id: string; chatId: string; title: string }[]>([]);
  const [jiraRefreshing, setJiraRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"analysis" | "checklists">("analysis");
  const [activeSection, setActiveSection] = useState<"explanation" | "deskCheck" | "testSuggestions" | "ambiguities" | "assumptions" | "openQuestions">("explanation");

  const handleSelect = useCallback(
    (id: string) => {
      const entry = getEntry(id);
      if (entry) {
        setSelectedId(id);
        selectedIdRef.current = id;
        setCurrentAnalysis(entry.analysis ?? null);
        setError(null);
        setSidebarOpen(false);
        setActiveTab("analysis");
        setActiveSection("explanation");
      }
    },
    [getEntry]
  );

  const handleNew = useCallback(() => {
    setSelectedId(null);
    selectedIdRef.current = null;
    setCurrentAnalysis(null);
    setError(null);
    setSidebarOpen(false);
    setActiveTab("analysis");
    setActiveSection("explanation");
  }, []);

  /** Patch a specific field in the current analysis and persist to localStorage. */
  const handlePatch = useCallback(
    (patch: Partial<Analysis>) => {
      const id = selectedIdRef.current;
      if (!id) return;
      setCurrentAnalysis((prev) => (prev ? { ...prev, ...patch } : prev));
      patchAnalysis(id, patch);
    },
    [patchAnalysis]
  );

  const [isRegeneratingExplanation, setIsRegeneratingExplanation] = useState(false);

  const handleRegenerateExplanation = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id || isRegeneratingExplanation) return;
    const entry = getEntry(id);
    if (!entry?.storyText) return;
    setIsRegeneratingExplanation(true);
    try {
      const epicContextBlock = entry.jiraKey ? (findEpicByStoryKey(entry.jiraKey)?.contextBlock ?? null) : null;
      const modelToUse = entry.analysis?.meta?.model ?? "copilot/default";
      const res = await fetch("/api/analyze/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story: entry.storyText,
          model: modelToUse,
          ...(epicContextBlock ? { epicContext: epicContextBlock } : {}),
        }),
      });
      const data = await res.json() as { explanation?: { title: string; content: string }; error?: string };
      if (!res.ok || !data.explanation) throw new Error(data.error ?? "Regeneration failed");
      const patch = { explanation: data.explanation };
      setCurrentAnalysis((prev) => (prev ? { ...prev, ...patch } : prev));
      patchAnalysis(id, patch);
    } catch (err) {
      console.error("[regenerateExplanation]", err);
    } finally {
      setIsRegeneratingExplanation(false);
    }
  }, [isRegeneratingExplanation, getEntry, findEpicByStoryKey, patchAnalysis]);

  const handleAnalyze = useCallback(
    async (text: string, model?: string, jiraKey?: string, jiraUrl?: string) => {
      const resolvedModel = model ?? "copilot/default";
      setError(null);
      const pending = addPendingEntry(text, jiraKey, jiraUrl);
      setSelectedId(pending.id);
      selectedIdRef.current = pending.id;
      setCurrentAnalysis(null);
      setLoadingIds((prev) => new Set([...prev, pending.id]));
      try {
        // Automatically inject epic context if we have a saved epic that includes this story key
        const epicContextBlock = jiraKey ? (findEpicByStoryKey(jiraKey)?.contextBlock ?? null) : null;

        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ story: text, model: resolvedModel, ...(epicContextBlock ? { epicContext: epicContextBlock } : {}) }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Analysis failed");
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(dataLine.slice(6)); } catch { continue; }
            if (evt.type === "error") throw new Error((evt.error as string) ?? "Analysis failed");
            if (evt.type === "chunk" && typeof evt.text === "string") {
              fullText += evt.text;
              const partial = tryParsePartialAnalysis(fullText);
              if (Object.keys(partial).length > 0 && selectedIdRef.current === pending.id) {
                setCurrentAnalysis((prev) => ({ ...(prev ?? {}), ...partial }));
              }
            } else if (evt.type === "done") {
              const cleanText = fullText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
              const parsed = JSON.parse(cleanText) as Record<string, unknown> & { generatedTitle?: string };
              const { generatedTitle, ...rest } = parsed;
              const analysis = rest as unknown as Analysis;
              if (evt.tokenUsage) analysis.tokenUsage = evt.tokenUsage as Analysis["tokenUsage"];
              if (evt.meta) analysis.meta = { ...(evt.meta as object), generatedTitle: generatedTitle ?? analysis.meta?.generatedTitle } as Analysis["meta"];
              finalizeEntry(pending.id, analysis);
              if (selectedIdRef.current === pending.id) {
                setCurrentAnalysis(analysis);
              } else {
                const words = text.trim().split(/\s+/);
                const toastTitle = analysis.meta?.generatedTitle ?? (words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : ""));
                const toastId = Math.random().toString(36).slice(2);
                setToasts((prev) => [...prev, { id: toastId, chatId: pending.id, title: toastTitle }]);
                setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 5000);
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        removeEntry(pending.id);
        if (selectedIdRef.current === pending.id) {
          setSelectedId(null);
          selectedIdRef.current = null;
          setCurrentAnalysis(null);
        }
      } finally {
        setLoadingIds((prev) => { const n = new Set(prev); n.delete(pending.id); return n; });
      }
    },
    [addPendingEntry, finalizeEntry, removeEntry]
  );

  const handleReanalyze = useCallback(
    async (text: string, model?: string, jiraKey?: string, jiraUrl?: string) => {
      const resolvedModel = model ?? "copilot/default";
      const entryId = selectedIdRef.current;
      if (!entryId) return;
      setError(null);
      setLoadingIds((prev) => new Set([...prev, entryId]));
      setCurrentAnalysis(null);
      setActiveSection("explanation");
      setReanalyzeStates((prev) => { const n = { ...prev }; delete n[entryId]; return n; });
      try {
        const epicContextBlock = jiraKey ? (findEpicByStoryKey(jiraKey)?.contextBlock ?? null) : null;
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ story: text, model: resolvedModel, ...(epicContextBlock ? { epicContext: epicContextBlock } : {}) }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Analysis failed");
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let evt: Record<string, unknown>;
            try { evt = JSON.parse(dataLine.slice(6)); } catch { continue; }
            if (evt.type === "error") throw new Error((evt.error as string) ?? "Analysis failed");
            if (evt.type === "chunk" && typeof evt.text === "string") {
              fullText += evt.text;
              const partial = tryParsePartialAnalysis(fullText);
              if (Object.keys(partial).length > 0 && selectedIdRef.current === entryId) {
                setCurrentAnalysis((prev) => ({ ...(prev ?? {}), ...partial }));
              }
            } else if (evt.type === "done") {
              const cleanText = fullText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
              const parsed = JSON.parse(cleanText) as Record<string, unknown> & { generatedTitle?: string };
              const { generatedTitle, ...rest } = parsed;
              const analysis = rest as unknown as Analysis;
              if (evt.tokenUsage) analysis.tokenUsage = evt.tokenUsage as Analysis["tokenUsage"];
              if (evt.meta) analysis.meta = { ...(evt.meta as object), generatedTitle: generatedTitle ?? analysis.meta?.generatedTitle } as Analysis["meta"];
              updateEntry(entryId, text, analysis, jiraKey, jiraUrl);
              if (selectedIdRef.current === entryId) {
                setCurrentAnalysis(analysis);
              } else {
                const words = text.trim().split(/\s+/);
                const toastTitle = analysis.meta?.generatedTitle ?? (words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : ""));
                const toastId = Math.random().toString(36).slice(2);
                setToasts((prev) => [...prev, { id: toastId, chatId: entryId, title: toastTitle }]);
                setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 5000);
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        const prevEntry = getEntry(entryId);
        if (selectedIdRef.current === entryId) {
          setCurrentAnalysis(prevEntry?.analysis ?? null);
          setReanalyzeStates((prev) => ({ ...prev, [entryId]: { show: true, text } }));
        }
      } finally {
        setLoadingIds((prev) => { const n = new Set(prev); n.delete(entryId); return n; });
      }
    },
    [updateEntry, getEntry]
  );

  const handleExportAll = async () => {
    if (!isCompleteAnalysis(currentAnalysis)) return;
    const { jsPDF } = await import("jspdf");

    const LINE_H   = 15;
    const BODY_SZ  = 10.5;
    const margin   = 52;

    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW    = doc.internal.pageSize.getWidth();
    const pageH    = doc.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;
    let y = 68;

    const checkPage = (needed: number) => {
      if (y + needed > pageH - 56) { doc.addPage(); y = 56; }
    };

    // ── Cover / title block ───────────────────────────────────
    // Large violet left bar
    doc.setFillColor(124, 58, 237);
    doc.rect(margin, y - 4, 4, 32, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42);
    doc.text("Story Analysis Report", margin + 14, y + 20);
    y += 36;

    const subtitle = currentAnalysis.meta?.generatedTitle;
    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, margin + 14, y);
      y += 18;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
      margin + 14, y
    );
    y += 24;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(margin, y, pageW - margin, y);
    y += 28;

    // ── Shared line-renderer ──────────────────────────────────
    const renderContent = (content: string, rgb: [number, number, number]) => {
      for (const rawLine of content.split("\n")) {
        const hm = rawLine.match(/^#{1,6}\s+(.+)/);
        const bm = rawLine.match(/^[-*]\s+(.+)/);
        const nm = rawLine.match(/^(\d+)\.\s+(.+)/);
        if (!rawLine.trim()) { y += 5; continue; }
        if (hm) {
          checkPage(32); y += 10;
          const ht = hm[1].replace(/\*\*(.*?)\*\*/g, "$1");
          doc.setFillColor(rgb[0], rgb[1], rgb[2]);
          doc.rect(margin, y - 10, 3.5, 14, "F");
          doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          const wh = doc.splitTextToSize(ht.toUpperCase(), contentW - 20);
          doc.text(wh, margin + 10, y);
          y += wh.length * LINE_H + 4;
          doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.3);
          doc.line(margin + 10, y - 2, pageW - margin, y - 2);
          y += 8; doc.setTextColor(51, 65, 85); continue;
        }
        doc.setFont("helvetica", "normal"); doc.setFontSize(BODY_SZ); doc.setTextColor(51, 65, 85);
        if (bm) {
          const t = bm[1].replace(/\*\*(.*?)\*\*/g, "$1");
          const w = doc.splitTextToSize(t, contentW - 28);
          checkPage(w.length * LINE_H + 4);
          doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.circle(margin + 10, y - 3.5, 2.5, "F");
          doc.text(w, margin + 20, y); y += w.length * LINE_H; continue;
        }
        if (nm) {
          const t = nm[2].replace(/\*\*(.*?)\*\*/g, "$1");
          const w = doc.splitTextToSize(t, contentW - 28);
          checkPage(w.length * LINE_H + 4);
          doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
          doc.text(`${nm[1]}.`, margin + 8, y);
          doc.setFont("helvetica", "normal"); doc.setFontSize(BODY_SZ); doc.setTextColor(51, 65, 85);
          doc.text(w, margin + 24, y); y += w.length * LINE_H; continue;
        }
        const t = rawLine.replace(/\*\*(.*?)\*\*/g, "$1");
        const w = doc.splitTextToSize(t, contentW - 12);
        checkPage(w.length * LINE_H + 2);
        doc.text(w, margin + 6, y); y += w.length * LINE_H + 3;
      }
    };

    // ── Main content sections ─────────────────────────────────
    const sections = [
      { title: currentAnalysis.explanation.title,     content: currentAnalysis.explanation.content,     rgb: [124, 58, 237] as [number, number, number] },
      { title: currentAnalysis.deskCheck.title,       content: currentAnalysis.deskCheck.content,       rgb: [37, 99, 235]  as [number, number, number] },
      { title: currentAnalysis.testSuggestions.title, content: currentAnalysis.testSuggestions.content, rgb: [5, 150, 105]  as [number, number, number] },
    ];

    for (let si = 0; si < sections.length; si++) {
      const { title, content, rgb } = sections[si];
      checkPage(64);
      if (si > 0) {
        doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
        doc.line(margin, y - 8, pageW - margin, y - 8);
        y += 4;
      }
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.roundedRect(margin, y, contentW, 36, 6, 6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(255, 255, 255);
      doc.text(title, margin + 14, y + 23);
      y += 50;
      renderContent(content, rgb);
      y += 20;
    }

    // ── Structured list sections ──────────────────────────────
    const listSections = [
      currentAnalysis.ambiguities   ? { ...currentAnalysis.ambiguities,   rgb: [217, 119, 6]  as [number, number, number] } : null,
      currentAnalysis.assumptions   ? { ...currentAnalysis.assumptions,   rgb: [234, 88, 12]  as [number, number, number] } : null,
      currentAnalysis.openQuestions ? { ...currentAnalysis.openQuestions, rgb: [2, 132, 199]  as [number, number, number] } : null,
    ].filter(Boolean) as Array<{ title: string; items: string[]; rgb: [number, number, number] }>;

    for (const ls of listSections) {
      checkPage(64);
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
      doc.line(margin, y - 8, pageW - margin, y - 8);
      y += 4;
      doc.setFillColor(ls.rgb[0], ls.rgb[1], ls.rgb[2]);
      doc.roundedRect(margin, y, contentW, 36, 6, 6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(255, 255, 255);
      doc.text(ls.title, margin + 14, y + 23);
      y += 50;
      ls.items.forEach((item, i) => {
        const txt = item.replace(/\*\*(.*?)\*\*/g, "$1");
        const w   = doc.splitTextToSize(txt, contentW - 32);
        checkPage(w.length * LINE_H + 6);
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(ls.rgb[0], ls.rgb[1], ls.rgb[2]);
        doc.text(`${i + 1}.`, margin + 8, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(BODY_SZ); doc.setTextColor(51, 65, 85);
        doc.text(w, margin + 24, y);
        y += w.length * LINE_H + 4;
      });
      y += 10;
    }

    // ── Page numbers + footer ─────────────────────────────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
      doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
      doc.text(`${i} / ${pageCount}`, pageW - margin, pageH - 17, { align: "right" });
      doc.text("Story Analyzer", margin, pageH - 17);
    }

    doc.save("story-analysis.pdf");
  };

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-950 overflow-hidden">
      <Sidebar
        entries={entries}
        selectedId={selectedId}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={renameEntry}
        onDelete={(id) => {
          removeEntry(id);
          if (selectedId === id) handleNew();
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuOpen={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 space-y-6">

          {/* Top-level view switcher */}
          <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
            <button
              onClick={() => setMainView("stories")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mainView === "stories"
                  ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              Story Analyzer
            </button>
            <button
              onClick={() => setMainView("epics")}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                mainView === "epics"
                  ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              Epic Analyzer
            </button>
          </div>

          {/* ── Epic Analyzer view — always mounted to preserve loading state ── */}
          <div className={mainView === "epics" ? undefined : "hidden"}>
            <EpicAnalyzer />
          </div>

          {/* ── Story Analyzer view — always mounted to preserve state ── */}
          <div className={`space-y-6 ${mainView === "stories" ? "" : "hidden"}`}>
          <>

          {/* Input area */}
          {selectedId === null ? (
            // New analysis mode — always show the full textarea input
            <StoryInput onAnalyze={handleAnalyze} isLoading={false} initialValue="" autoAnalyzeOnJiraLoad />
          ) : (reanalyzeStates[selectedId]?.show ?? false) ? (
            // Existing chat — user clicked Reanalyze, show textarea
            <StoryInput
              onAnalyze={handleReanalyze}
              isLoading={loadingIds.has(selectedId)}
              initialValue={reanalyzeStates[selectedId]?.text ?? ""}
              initialJiraKey={getEntry(selectedId)?.jiraKey}
              onCancel={() => setReanalyzeStates((prev) => ({ ...prev, [selectedId]: { show: false, text: prev[selectedId]?.text ?? "" } }))}
              onTextChange={(t) => setReanalyzeStates((prev) => ({ ...prev, [selectedId]: { show: true, text: t } }))}
            />
          ) : (
            // Existing chat default — compact Reanalyze bar
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {loadingIds.has(selectedId ?? '') ? "Re-analysis in progress…" : "Analysis complete"}
                  </p>
                  {!loadingIds.has(selectedId ?? '') && getEntry(selectedId ?? '')?.jiraUrl && (
                    <a
                      href={getEntry(selectedId!)!.jiraUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 font-mono text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      {getEntry(selectedId!)!.jiraKey}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  {loadingIds.has(selectedId ?? '')
                    ? "Your new analysis is being generated"
                    : "Paste a new story to re-analyze this chat"}
                </p>
              </div>
              {!loadingIds.has(selectedId ?? '') && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {getEntry(selectedId)?.jiraKey && (
                    <button
                      onClick={async () => {
                        const key = getEntry(selectedId!)!.jiraKey!;
                        setJiraRefreshing(true);
                        try {
                          const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
                          const data = await res.json() as { storyText?: string; error?: string };
                          if (res.ok && data.storyText) {
                            setReanalyzeStates((prev) => ({ ...prev, [selectedId!]: { show: true, text: data.storyText! } }));
                          }
                        } finally {
                          setJiraRefreshing(false);
                        }
                      }}
                      disabled={jiraRefreshing}
                      className="flex items-center gap-2 text-sm font-medium border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                    >
                      {jiraRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Refresh from Jira
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const entry = getEntry(selectedId!);
                      const text = reanalyzeStates[selectedId!]?.text ?? entry?.storyText ?? "";
                      setReanalyzeStates((prev) => ({ ...prev, [selectedId!]: { show: true, text } }));
                    }}
                    className="flex items-center gap-2 text-sm font-medium border border-violet-400 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-4 py-2 rounded-xl transition-colors shadow-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reanalyze
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl px-5 py-4 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Analysis results — shown as soon as first section arrives */}
          {currentAnalysis ? (
            <>
              {/* Streaming progress bar */}
              {loadingIds.has(selectedId ?? "") && (() => {
                const sectionsDone = [
                  currentAnalysis?.explanation, currentAnalysis?.deskCheck,
                  currentAnalysis?.testSuggestions, currentAnalysis?.ambiguities,
                  currentAnalysis?.assumptions, currentAnalysis?.openQuestions,
                ].filter(Boolean).length;
                const pct = Math.round((sectionsDone / 6) * 100);
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                        <span>Generating analysis… {sectionsDone}/6 sections</span>
                      </div>
                      <span className="font-medium">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Tab bar — shown when streaming is complete */}
              {!loadingIds.has(selectedId ?? "") && (
                <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700 pt-2">
                  <button
                    onClick={() => setActiveTab("analysis")}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                      activeTab === "analysis"
                        ? "border-violet-500 text-violet-600 dark:text-violet-400 bg-white dark:bg-slate-800"
                        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    Analysis
                  </button>
                  <button
                    onClick={() => setActiveTab("checklists")}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                      activeTab === "checklists"
                        ? "border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-800"
                        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    Checklists
                    {selectedId && getEntry(selectedId)?.checklist?.some(c => c.status !== "pending") && (
                      <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">
                        {getEntry(selectedId)!.checklist!.filter(c => c.status !== "pending").length}/{getEntry(selectedId)!.checklist!.length}
                      </span>
                    )}
                  </button>
                  {/* Epic context badge — shown if this story was analyzed with epic context */}
                  {selectedId && (() => {
                    const jKey = getEntry(selectedId)?.jiraKey;
                    const epic = jKey ? findEpicByStoryKey(jKey) : null;
                    if (!epic) return null;
                    const badge = (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-600 dark:text-violet-400 bg-transparent border border-violet-400 dark:border-violet-500 px-2.5 py-1 rounded-full">
                        <span className="w-2 h-2 rounded-full bg-violet-500 dark:bg-violet-400 inline-block" />
                        Epic context: {epic.epicKey}
                      </span>
                    );
                    return (
                      <span className="ml-auto">
                        {epic.browseUrl ? (
                          <a href={epic.browseUrl} target="_blank" rel="noopener noreferrer" title={`Open ${epic.epicKey} in Jira`} className="hover:opacity-80 transition-opacity">
                            {badge}
                          </a>
                        ) : badge}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* ── Checklists tab ── */}
              {activeTab === "checklists" && !loadingIds.has(selectedId ?? "") && (
                <ChecklistTab
                  analysis={isCompleteAnalysis(currentAnalysis) ? currentAnalysis : null}
                  checklist={selectedId ? getEntry(selectedId)?.checklist : undefined}
                  storyTitle={selectedId ? (getEntry(selectedId)?.title ?? "") : ""}
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedCategories={selectedId ? (getEntry(selectedId)?.checklistPostedCategories ?? []) : []}
                  onCategoryPosted={(cat) => { if (selectedId) markChecklistCategoryPosted(selectedId, cat); }}
                  onChecklistChange={(items) => { if (selectedId) patchChecklist(selectedId, items); }}
                />
              )}

              {/* ── Analysis tab ── */}
              {activeTab === "analysis" && (
                <>
              {/* ── STREAMING: progressive section tabs + single content pane ── */}
              {loadingIds.has(selectedId ?? "") && (() => {
                const streamDefs = [
                  { key: "explanation"     as typeof activeSection, label: "Story Explanation", color: "violet",  barColor: "bg-violet-500",  hasData: !!currentAnalysis.explanation },
                  { key: "deskCheck"       as typeof activeSection, label: "Desk Check",        color: "violet",  barColor: "bg-blue-500",    hasData: !!currentAnalysis.deskCheck },
                  { key: "testSuggestions" as typeof activeSection, label: "Test Cases",         color: "violet",  barColor: "bg-emerald-500", hasData: !!currentAnalysis.testSuggestions },
                  { key: "ambiguities"     as typeof activeSection, label: "Ambiguities",        color: "violet",  barColor: "bg-amber-500",   hasData: !!(currentAnalysis.ambiguities?.items?.length) },
                  { key: "assumptions"     as typeof activeSection, label: "Assumptions",        color: "violet",  barColor: "bg-violet-500",  hasData: !!(currentAnalysis.assumptions?.items?.length) },
                  { key: "openQuestions"   as typeof activeSection, label: "Open Questions",     color: "violet",  barColor: "bg-sky-500",     hasData: !!(currentAnalysis.openQuestions?.items?.length) },
                ];
                const completedDefs = streamDefs.filter(s => s.hasData);
                const activeBarColor = streamDefs.find(s => s.key === activeSection)?.barColor ?? "bg-violet-500";
                return (
                  <>
                    {/* Tab row: only render once at least one section has streamed in */}
                    {completedDefs.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto tab-scroll pb-1">
                      {completedDefs.map(({ key, label, color }) => (
                        <button
                          key={key}
                          onClick={() => setActiveSection(key)}
                          className={`animate-tab-pop flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                            activeSection === key
                              ? `bg-${color}-600 text-white shadow-sm`
                              : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      <div className="flex items-center gap-1.5 flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border border-dashed border-violet-300 dark:border-violet-700/50 text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        <span className="flex items-center gap-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "160ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "320ms" }} />
                        </span>
                        Generating
                      </div>
                    </div>
                    )}
                    {/* Single active section content — remounts on tab switch for entrance animation */}
                    <div key={activeSection} className="animate-section-in">
                      {activeSection === "explanation" && (
                        currentAnalysis.explanation
                          ? <AnalysisCard
                              title={currentAnalysis.explanation.title}
                              content={currentAnalysis.explanation.content}
                              accentColor="violet"
                              isLoading
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.explanation.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.explanation!.title, fp); }}
                              onContentChange={(c) => handlePatch({ explanation: { ...currentAnalysis.explanation!, content: c } })}
                              onTitleChange={(t) => handlePatch({ explanation: { ...currentAnalysis.explanation!, title: t } })}
                              onRegenerate={handleRegenerateExplanation}
                              isRegenerating={isRegeneratingExplanation}
                            />
                          : <CardSkeleton barColor="bg-violet-500" />
                      )}
                      {activeSection === "deskCheck" && (
                        currentAnalysis.deskCheck
                          ? <AnalysisCard
                              title={currentAnalysis.deskCheck.title}
                              content={currentAnalysis.deskCheck.content}
                              accentColor="blue"
                              isLoading
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.deskCheck.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.deskCheck!.title, fp); }}
                              onContentChange={(c) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, content: c } })}
                              onTitleChange={(t) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, title: t } })}
                            />
                          : <CardSkeleton barColor="bg-blue-500" />
                      )}
                      {activeSection === "testSuggestions" && (
                        currentAnalysis.testSuggestions
                          ? <AnalysisCard
                              title={currentAnalysis.testSuggestions.title}
                              content={currentAnalysis.testSuggestions.content}
                              accentColor="emerald"
                              isLoading
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.testSuggestions.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.testSuggestions!.title, fp); }}
                              onContentChange={(c) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, content: c } })}
                              onTitleChange={(t) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, title: t } })}
                            />
                          : <CardSkeleton barColor="bg-emerald-500" />
                      )}
                      {activeSection === "ambiguities" && (
                        currentAnalysis.ambiguities?.items?.length
                          ? <StructuredListCard
                              title={currentAnalysis.ambiguities.title}
                              items={currentAnalysis.ambiguities.items}
                              accentColor="amber"
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.ambiguities.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.ambiguities!.title, fp); }}
                              onItemsChange={(items) => handlePatch({ ambiguities: { ...currentAnalysis.ambiguities!, items } })}
                              onTitleChange={(t) => handlePatch({ ambiguities: { ...currentAnalysis.ambiguities!, title: t } })}
                            />
                          : <CardSkeleton barColor="bg-amber-500" />
                      )}
                      {activeSection === "assumptions" && (
                        currentAnalysis.assumptions?.items?.length
                          ? <StructuredListCard
                              title={currentAnalysis.assumptions.title}
                              items={currentAnalysis.assumptions.items}
                              accentColor="violet"
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.assumptions.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.assumptions!.title, fp); }}
                              onItemsChange={(items) => handlePatch({ assumptions: { ...currentAnalysis.assumptions!, items } })}
                              onTitleChange={(t) => handlePatch({ assumptions: { ...currentAnalysis.assumptions!, title: t } })}
                            />
                          : <CardSkeleton barColor="bg-violet-500" />
                      )}
                      {activeSection === "openQuestions" && (
                        currentAnalysis.openQuestions?.items?.length
                          ? <StructuredListCard
                              title={currentAnalysis.openQuestions.title}
                              items={currentAnalysis.openQuestions.items}
                              accentColor="sky"
                              jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                              postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.openQuestions.title] : undefined}
                              onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.openQuestions!.title, fp); }}
                              onItemsChange={(items) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, items } })}
                              onTitleChange={(t) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, title: t } })}
                            />
                          : <CardSkeleton barColor={activeBarColor} />
                      )}
                    </div>
                  </>
                );
              })()}

              {/* Action bar — only when streaming is complete */}
              {!loadingIds.has(selectedId ?? "") && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Analysis Results</h1>
                    {selectedId && getEntry(selectedId)?.jiraUrl && (
                      <a
                        href={getEntry(selectedId)!.jiraUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-mono text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        {getEntry(selectedId)!.jiraKey}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {selectedId && <JiraBoardBadge jiraKey={getEntry(selectedId)?.jiraKey} />}
                    {currentAnalysis?.meta?.isFallback && (
                      <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 rounded-full">
                        <span>⚠</span>
                        <span>Rule-based (no API key)</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportAll}
                      className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export Full PDF
                    </button>
                  </div>
                </div>
              )}

              {/* Section sub-tabs — only after streaming completes */}
              {!loadingIds.has(selectedId ?? "") && isCompleteAnalysis(currentAnalysis) && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {([
                    { key: "explanation",     label: "Explanation",    color: "violet",  count: undefined },
                    { key: "deskCheck",       label: "Desk Check",     color: "violet",  count: undefined },
                    { key: "testSuggestions", label: "Test Cases",     color: "violet",  count: undefined },
                    { key: "ambiguities",     label: "Ambiguities",    color: "violet",  count: currentAnalysis.ambiguities?.items?.length },
                    { key: "assumptions",     label: "Assumptions",    color: "violet",  count: currentAnalysis.assumptions?.items?.length },
                    { key: "openQuestions",   label: "Open Questions", color: "violet",  count: currentAnalysis.openQuestions?.items?.length },
                  ] as { key: typeof activeSection; label: string; color: string; count: number | undefined }[]).map(({ key, label, color, count }) => (
                    <button
                      key={key}
                      onClick={() => setActiveSection(key)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                        activeSection === key
                          ? `bg-${color}-600 text-white shadow-sm`
                          : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                      }`}
                    >
                      {label}
                      {count != null && count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                          activeSection === key ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-slate-600 text-slate-500"
                        }`}>{count}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Explanation */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "explanation") && (
                currentAnalysis.explanation ? (
                  <AnalysisCard
                    title={currentAnalysis.explanation.title}
                    content={currentAnalysis.explanation.content}
                    accentColor="violet"
                    jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                    postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.explanation.title] : undefined}
                    onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.explanation!.title, fp); }}
                    onContentChange={(c) => handlePatch({ explanation: { ...currentAnalysis.explanation!, content: c } })}
                    onTitleChange={(t) => handlePatch({ explanation: { ...currentAnalysis.explanation!, title: t } })}
                    onRegenerate={handleRegenerateExplanation}
                    isRegenerating={isRegeneratingExplanation}
                  />
                ) : null
              )}

              {/* Ambiguities */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "ambiguities") && currentAnalysis.ambiguities?.items?.length ? (
                <StructuredListCard
                  title={currentAnalysis.ambiguities.title}
                  items={currentAnalysis.ambiguities.items}
                  accentColor="amber"
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.ambiguities.title] : undefined}
                  onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.ambiguities!.title, fp); }}
                  onItemsChange={(items) => handlePatch({ ambiguities: { ...currentAnalysis.ambiguities!, items } })}
                  onTitleChange={(t) => handlePatch({ ambiguities: { ...currentAnalysis.ambiguities!, title: t } })}
                />
              ) : null}

              {/* Assumptions */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "assumptions") && currentAnalysis.assumptions?.items?.length ? (
                <StructuredListCard
                  title={currentAnalysis.assumptions.title}
                  items={currentAnalysis.assumptions.items}
                  accentColor="violet"
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.assumptions.title] : undefined}
                  onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.assumptions!.title, fp); }}
                  onItemsChange={(items) => handlePatch({ assumptions: { ...currentAnalysis.assumptions!, items } })}
                  onTitleChange={(t) => handlePatch({ assumptions: { ...currentAnalysis.assumptions!, title: t } })}
                />
              ) : null}

              {/* Open Questions */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "openQuestions") && currentAnalysis.openQuestions?.items?.length ? (
                <StructuredListCard
                  title={currentAnalysis.openQuestions.title}
                  items={currentAnalysis.openQuestions.items}
                  accentColor="sky"
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.openQuestions.title] : undefined}
                  onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.openQuestions!.title, fp); }}
                  onItemsChange={(items) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, items } })}
                  onTitleChange={(t) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, title: t } })}
                />
              ) : null}

              {/* Desk Check */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "deskCheck") && (
                currentAnalysis.deskCheck ? (
                  <AnalysisCard
                    title={currentAnalysis.deskCheck.title}
                    content={currentAnalysis.deskCheck.content}
                    accentColor="blue"
                    jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                    postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.deskCheck.title] : undefined}
                    onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.deskCheck!.title, fp); }}
                    onContentChange={(c) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, content: c } })}
                    onTitleChange={(t) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, title: t } })}
                  />
                ) : <CardSkeleton barColor="bg-blue-500" />
              )}

              {/* Test Suggestions */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "testSuggestions") && (
                currentAnalysis.testSuggestions ? (
                  <AnalysisCard
                    title={currentAnalysis.testSuggestions.title}
                    content={currentAnalysis.testSuggestions.content}
                    accentColor="emerald"
                    jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                    postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.testSuggestions.title] : undefined}
                    onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.testSuggestions!.title, fp); }}
                    onContentChange={(c) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, content: c } })}
                    onTitleChange={(t) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, title: t } })}
                  />
                ) : <CardSkeleton barColor="bg-emerald-500" />
              )}
                </> /* end analysis tab */
              )}
            </>
          ) : (
            !selectedId && <EmptyState />
          )}

          {/* Skeleton layout — shown before any streaming content arrives */}
          {loadingIds.has(selectedId ?? "") && !currentAnalysis && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                    <span>Generating analysis… 0/6 sections</span>
                  </div>
                  <span className="font-medium">0%</span>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all duration-500" style={{ width: "4%" }} />
                </div>
              </div>
              <div className="flex gap-1.5 overflow-x-auto tab-scroll pb-1">
                <div className="flex items-center gap-1.5 flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-white dark:bg-slate-800 border border-dashed border-violet-300 dark:border-violet-700/50 text-slate-400 dark:text-slate-500 whitespace-nowrap">
                  <span className="flex items-center gap-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "0ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "160ms" }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: "320ms" }} />
                  </span>
                  Generating
                </div>
              </div>
              <CardSkeleton barColor="bg-violet-500" />
            </>
          )}
          </>
          </div>
        </main>
      </div>

      {/* Toast notifications — background analysis completions */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-end pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className="animate-toast-in pointer-events-auto flex items-center gap-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-2xl px-5 py-4 w-96"
            >
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
                <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">Analysis complete</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{toast.title}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => {
                    handleSelect(toast.chatId);
                    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                  }}
                  className="text-xs font-semibold text-violet-500 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 px-2.5 py-1.5 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
                >
                  View
                </button>
                <button
                  onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
