"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import ReportIssueModal from "@/components/ReportIssueModal";
import { emptyDraft } from "@/lib/bug-report";
import { loadBug } from "@/lib/bug-import";
import { pdfSafe, pdfInline, renderMarkdownPdf } from "@/lib/pdf-text";
import { useHistory } from "@/hooks/useHistory";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import StoryInput from "@/components/StoryInput";
import { useCopilotModels } from "@/hooks/useCopilotModels";
import AnalysisCard from "@/components/AnalysisCard";
import StructuredListCard from "@/components/StructuredListCard";
import ChecklistTab from "@/components/ChecklistTab";
import EmptyState from "@/components/EmptyState";
import EpicAnalyzer from "@/components/EpicAnalyzer";
import EpicContextFlow from "@/components/EpicContextFlow";
import TestSuggestionsPanel from "@/components/TestSuggestionsPanel";
import JiraBoardBadge from "@/components/JiraBoardBadge";
import TestDesignPanel from "@/components/TestDesignPanel";
import { checklistFromTestDesign, testDesignToMarkdown, type TestDesign } from "@/lib/test-design";
import { useEpicLibrary } from "@/hooks/useEpicLibrary";
import ReportsPanel from "@/components/ReportsPanel";
import { Analysis, StructuredBlock, type IssueReport } from "@/types";
import { Check, Download, Cpu, RefreshCw, Loader2, X, ExternalLink, BookOpen } from "lucide-react";

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

/** The model answers {"rejected":true,"reason":…} when the input isn't a testable requirement. */
function throwIfRejected(parsed: Record<string, unknown>) {
  if (parsed.rejected === true) {
    const reason = typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "This doesn't look like a user story or requirement.";
    throw new Error(`Not analyzed: ${reason}`);
  }
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
  return !!(a?.explanation && a?.testSuggestions);
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

// The project the user analyzes most often, e.g. "LSINST"
function mostUsedProject(keys: (string | undefined)[]): string | undefined {
  const count = new Map<string, number>();
  for (const k of keys) {
    const p = k?.split("-")[0];
    if (p) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export default function Home() {
const { entries, addPendingEntry, finalizeEntry, updateEntry, patchAnalysis, patchChecklist, replaceUntouchedChecklist, markJiraPosted, markChecklistCategoryPosted, setChecklistRefLabel, setChecklistEnvironment, setReports, removeEntry, renameEntry, getEntry } = useHistory();
  const { findEpicByStoryKey } = useEpicLibrary();
  const [mainView, setMainView] = useState<"stories" | "epics">("stories");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<Partial<Analysis> | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [reanalyzeStates, setReanalyzeStates] = useState<Record<string, { show: boolean; text: string }>>({}); 
  const [error, setError] = useState<string | null>(null);
  // Last submitted new-analysis input, restored into StoryInput if the analysis fails
  const [newDraft, setNewDraft] = useState<{ text: string; jiraKey?: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reportingBug, setReportingBug] = useState(false);
  const [myBugs, setMyBugs] = useState<IssueReport[]>([]);
  const [showBugs, setShowBugs] = useState(false);
  const [editingMyBug, setEditingMyBug] = useState<IssueReport | null>(null);
  const [loadedNote, setLoadedNote] = useState("");
  const myBugsRef = useRef(myBugs);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem("story-analyzer:my-bugs") ?? "[]"); if (Array.isArray(v)) {
        // Bugs are forgotten 30 days after you last saved them; they stay in Jira
        const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
        const fresh = (v as IssueReport[]).filter((b) => !b.createdAt || new Date(b.createdAt).getTime() > cutoff);
        myBugsRef.current = fresh; setMyBugs(fresh);
        if (fresh.length !== v.length) localStorage.setItem("story-analyzer:my-bugs", JSON.stringify(fresh));
      } } catch { /* ignore */ }
  }, []);
  const saveMyBugs = useCallback((list: IssueReport[]) => {
    myBugsRef.current = list;
    setMyBugs(list);
    try { localStorage.setItem("story-analyzer:my-bugs", JSON.stringify(list)); } catch { /* ignore */ }
  }, []);
  const upsertMyBug = useCallback((r: IssueReport) => {
    const cur = myBugsRef.current;
    // Newest first, and never more than 100 so the list stays light
    saveMyBugs((cur.some((x) => x.id === r.id) ? cur.map((x) => (x.id === r.id ? r : x)) : [r, ...cur]).slice(0, 100));
  }, [saveMyBugs]);
  // Warm up the bug form's Jira data for the last-used project
  useEffect(() => {
    try {
      const p = (JSON.parse(localStorage.getItem("story-analyzer:bug-defaults") ?? "{}") as { project?: string }).project;
      if (p) void fetch(`/api/jira/bug-meta?project=${p}`).catch(() => {});
    } catch { /* ignore */ }
  }, []);
  const [toasts, setToasts] = useState<{ id: string; chatId: string; title: string }[]>([]);
  const [jiraRefreshing, setJiraRefreshing] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<{ id: string; key: string; text: string; url?: string; epicKey?: string } | null>(null);
  const [jiraNotice, setJiraNotice] = useState<{ id: string; text: string } | null>(null);
  const { models: copilotModels, model: copilotModel, setModel: setCopilotModel } = useCopilotModels();
  const [activeTab, setActiveTab] = useState<"analysis" | "checklists">("analysis");
  const [activeSection, setActiveSection] = useState<"explanation" | "deskCheck" | "testSuggestions" | "ambiguities" | "assumptions" | "openQuestions">("explanation");
  // A section with nothing in it has no tab, so jump back if we were on it
  useEffect(() => {
    if (!currentAnalysis) return;
    const empty = (k: "ambiguities" | "assumptions" | "openQuestions") => !currentAnalysis[k]?.items?.length;
    if ((activeSection === "ambiguities" || activeSection === "assumptions" || activeSection === "openQuestions") && empty(activeSection) && isCompleteAnalysis(currentAnalysis)) setActiveSection("explanation");
  }, [currentAnalysis, activeSection]);

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
  const [designLoadingIds, setDesignLoadingIds] = useState<Set<string>>(new Set());
  const [designErrors, setDesignErrors] = useState<Record<string, string>>({});

  /** Formal test design (EP/BVA/DT/ST) — runs as its own request after the main analysis. */
  const generateTestDesign = useCallback(async (id: string, story: string, model: string, jiraKey?: string, epicKey?: string) => {
    setDesignLoadingIds((prev) => new Set([...prev, id]));
    setDesignErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const epicContextBlock = jiraKey ? (findEpicByStoryKey(jiraKey, epicKey)?.contextBlock ?? null) : null;
      const res = await fetch("/api/analyze/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story, model, ...(epicContextBlock ? { epicContext: epicContextBlock } : {}) }),
      });
      const data = await res.json().catch(() => ({})) as { testDesign?: TestDesign; error?: string };
      if (!res.ok || !data.testDesign) throw new Error(data.error ?? "Scenario generation failed");
      const testDesign = data.testDesign;
      patchAnalysis(id, { testDesign });
      if (selectedIdRef.current === id) setCurrentAnalysis((prev) => (prev ? { ...prev, testDesign } : prev));
      // Rebuild the checklist from the new scenarios unless the tester already started marking it
      replaceUntouchedChecklist(id, checklistFromTestDesign(testDesign));
    } catch (err) {
      setDesignErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "Scenario generation failed" }));
    } finally {
      setDesignLoadingIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  }, [findEpicByStoryKey, patchAnalysis, replaceUntouchedChecklist]);

  const handleRegenerateExplanation = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id || isRegeneratingExplanation) return;
    const entry = getEntry(id);
    if (!entry?.storyText) return;
    setIsRegeneratingExplanation(true);
    try {
      const epicContextBlock = entry.jiraKey ? (findEpicByStoryKey(entry.jiraKey, entry.epicKey)?.contextBlock ?? null) : null;
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
    async (text: string, model?: string, jiraKey?: string, jiraUrl?: string, epicKey?: string) => {
      const resolvedModel = model ?? "copilot/default";
      setError(null);
      setNewDraft(jiraKey ? { text: "", jiraKey } : { text });
      const pending = addPendingEntry(text, jiraKey, jiraUrl, epicKey);
      setSelectedId(pending.id);
      selectedIdRef.current = pending.id;
      setCurrentAnalysis(null);
      setLoadingIds((prev) => new Set([...prev, pending.id]));
      try {
        // Automatically inject epic context if this story's epic was analyzed
        const epicContextBlock = jiraKey ? (findEpicByStoryKey(jiraKey, epicKey)?.contextBlock ?? null) : null;

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
              throwIfRejected(parsed);
              const { generatedTitle, ...rest } = parsed;
              const analysis = rest as unknown as Analysis;
              if (evt.tokenUsage) analysis.tokenUsage = evt.tokenUsage as Analysis["tokenUsage"];
              if (evt.meta) analysis.meta = { ...(evt.meta as object), generatedTitle: generatedTitle ?? analysis.meta?.generatedTitle } as Analysis["meta"];
              finalizeEntry(pending.id, analysis);
              setNewDraft(null);
              void generateTestDesign(pending.id, text, resolvedModel, jiraKey, epicKey);
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
    [addPendingEntry, finalizeEntry, removeEntry, generateTestDesign, findEpicByStoryKey]
  );

  const handleReanalyze = useCallback(
    async (text: string, model?: string, jiraKey?: string, jiraUrl?: string, epicKey?: string) => {
      const resolvedModel = model ?? "copilot/default";
      const entryId = selectedIdRef.current;
      if (!entryId) return;
      setError(null);
      setLoadingIds((prev) => new Set([...prev, entryId]));
      setCurrentAnalysis(null);
      setActiveSection("explanation");
      setReanalyzeStates((prev) => { const n = { ...prev }; delete n[entryId]; return n; });
      try {
        const epicKeyToUse = epicKey ?? getEntry(entryId)?.epicKey;
        const epicContextBlock = jiraKey ? (findEpicByStoryKey(jiraKey, epicKeyToUse)?.contextBlock ?? null) : null;
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
              throwIfRejected(parsed);
              const { generatedTitle, ...rest } = parsed;
              const analysis = rest as unknown as Analysis;
              if (evt.tokenUsage) analysis.tokenUsage = evt.tokenUsage as Analysis["tokenUsage"];
              if (evt.meta) analysis.meta = { ...(evt.meta as object), generatedTitle: generatedTitle ?? analysis.meta?.generatedTitle } as Analysis["meta"];
              updateEntry(entryId, text, analysis, jiraKey, jiraUrl, epicKey);
              void generateTestDesign(entryId, text, resolvedModel, jiraKey, epicKeyToUse);
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
    [updateEntry, getEntry, generateTestDesign, findEpicByStoryKey]
  );

  const [pdfBusy, setPdfBusy] = useState(false);
  const handleExportAll = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try { await exportPdf(); } finally { setPdfBusy(false); }
  };

  const exportPdf = async () => {
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
      doc.text(pdfSafe(subtitle), margin + 14, y);
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
      y = renderMarkdownPdf(doc, content, y, { margin, contentW, pageW, pageH, lineH: LINE_H, bodySize: BODY_SZ, rgb });
    };

    // ── Main content sections ─────────────────────────────────
    const scenarioSection = currentAnalysis.testDesign
      ? { title: "Test Scenarios", content: testDesignToMarkdown(currentAnalysis.testDesign) }
      : currentAnalysis.deskCheck;
    const sections = [
      { title: currentAnalysis.explanation.title,     content: currentAnalysis.explanation.content,     rgb: [124, 58, 237] as [number, number, number] },
      ...(scenarioSection ? [{ title: scenarioSection.title, content: scenarioSection.content, rgb: [37, 99, 235] as [number, number, number] }] : []),
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
      doc.text(pdfSafe(title), margin + 14, y + 23);
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
      doc.text(pdfSafe(ls.title), margin + 14, y + 23);
      y += 50;
      ls.items.forEach((item, i) => {
        doc.setFont("helvetica", "normal"); doc.setFontSize(BODY_SZ);
        const w   = doc.splitTextToSize(pdfInline(item), contentW - 32);
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

  // Parent epic whose context feeds the story currently being analyzed
  const loadingEntry = selectedId && loadingIds.has(selectedId) ? getEntry(selectedId) : undefined;
  const loadingEpic = loadingEntry?.jiraKey ? findEpicByStoryKey(loadingEntry.jiraKey, loadingEntry.epicKey) : undefined;
  const epicFlow = loadingEpic ? <EpicContextFlow epicKey={loadingEpic.epicKey} epicSummary={loadingEpic.epicSummary} storyKey={loadingEntry?.jiraKey} /> : null;

  return (
    <div className="flex h-screen bg-slate-100 dark:bg-slate-950 overflow-hidden">
      <Sidebar
        entries={entries}
        selectedId={selectedId}
        onSelect={handleSelect}
        onNew={handleNew}
        onReportBug={() => { setReportingBug(true); setSidebarOpen(false); }}
        bugCount={myBugs.length}
        onShowBugs={() => { setShowBugs(true); setSidebarOpen(false); }}
        onRename={renameEntry}
        onDelete={(id) => {
          removeEntry(id);
          if (selectedId === id) handleNew();
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {reportingBug && (
        <ReportIssueModal
          kind="bug"
          initial={emptyDraft()}
          defaultProject={mostUsedProject(entries.map((e) => e.jiraKey))}
          observationNumber={1}
          onSaved={upsertMyBug}
          onOpenExisting={(rep, foreign) => { setReportingBug(false); setLoadedNote(foreign ? "This ticket wasn't written by this app, so its text was put into Notes. Saving rewrites the description." : ""); setEditingMyBug(rep); }}
          onClose={() => setReportingBug(false)}
        />
      )}
      {editingMyBug?.snapshot && (
        <ReportIssueModal
          kind="bug"
          initial={editingMyBug.snapshot.draft}
          editing={editingMyBug}
          startNotice={loadedNote}
          storyKey={editingMyBug.snapshot.storyKey}
          observationNumber={0}
          onSaved={upsertMyBug}
          onClose={() => { setEditingMyBug(null); setLoadedNote(""); }}
        />
      )}
      {showBugs && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/40" onClick={() => setShowBugs(false)}>
          <div className="w-full max-w-xl max-h-[80vh] overflow-y-auto nice-scroll rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center mb-3">
              <h2 className="flex-1 font-semibold text-slate-800 dark:text-slate-100">Bugs I reported</h2>
              <button onClick={() => setShowBugs(false)} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
            </div>
            {myBugs.length === 0 && <p className="text-sm text-slate-500 py-4">Nothing here yet. Bugs you create with “Report a bug” from now on will show up here, with an edit (pencil) button.</p>}
            <ReportsPanel reports={myBugs} onChange={saveMyBugs} onEdit={(r) => { setShowBugs(false); setEditingMyBug(r); }}
              onRefresh={async (r) => {
                const { report } = await loadBug(r.key!);
                const fresh = { ...report, id: r.id, createdAt: r.createdAt };
                const same = JSON.stringify([r.title, r.snapshot]) === JSON.stringify([fresh.title, fresh.snapshot]);
                if (!same) upsertMyBug(fresh);
                return same ? "Already up to date" : "Updated from Jira";
              }} />
          </div>
        </div>
      )}

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
            <EpicAnalyzer
              entries={entries}
              analyzingKeys={entries.filter((e) => loadingIds.has(e.id) && e.jiraKey).map((e) => e.jiraKey!)}
              onOpenStory={(id) => { handleSelect(id); setMainView("stories"); }}
              onAnalyzeStory={async (key) => {
                try {
                  const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
                  const data = await res.json() as { storyText?: string; browseUrl?: string; epicKey?: string; error?: string };
                  if (!res.ok || !data.storyText) return data.error ?? "Could not load the story from Jira";
                  void handleAnalyze(data.storyText, copilotModel, key, data.browseUrl, data.epicKey);
                  return null;
                } catch {
                  return "Network error";
                }
              }}
            />
          </div>

          {/* ── Story Analyzer view — always mounted to preserve state ── */}
          <div className={`space-y-6 ${mainView === "stories" ? "" : "hidden"}`}>
          <>

          {/* Input area */}
          {selectedId === null ? (
            // New analysis mode — always show the full textarea input
            <StoryInput
              onAnalyze={handleAnalyze}
              isLoading={false}
              initialValue={newDraft?.text ?? ""}
              initialJiraKey={newDraft?.jiraKey}
              autoAnalyzeOnJiraLoad
            />
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
                </div>
                <p className={`text-xs mt-0.5 ${jiraNotice?.id === selectedId ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-slate-500"}`}>
                  {loadingIds.has(selectedId ?? '')
                    ? "Your new analysis is being generated"
                    : jiraNotice?.id === selectedId
                      ? jiraNotice.text
                      : getEntry(selectedId ?? '')?.jiraKey
                        ? "Changed the ticket in Jira? Update to re-run the analysis with the latest text."
                        : "Edit the story text and re-run the analysis."}
                </p>
                {!loadingIds.has(selectedId ?? '') && pendingUpdate?.id === selectedId && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-3 py-2">
                    <span className="text-xs text-amber-800 dark:text-amber-200">{pendingUpdate.key} changed in Jira. Re-analyzing replaces the current analysis. Do it?</span>
                    <button
                      onClick={() => { const p = pendingUpdate; setPendingUpdate(null); void handleReanalyze(p.text, copilotModel, p.key, p.url, p.epicKey); }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-500">Yes, re-analyze</button>
                    <button onClick={() => setPendingUpdate(null)} className="text-xs px-3 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800">Keep current</button>
                  </div>
                )}
                {!loadingIds.has(selectedId ?? '') && jiraNotice?.id === selectedId && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs text-slate-500 dark:text-slate-400">Not happy with the result?</span>
                    {copilotModels.length > 0 && (
                      <select
                        value={copilotModel ?? ""}
                        onChange={(e) => setCopilotModel(e.target.value)}
                        title="GitHub Copilot model"
                        className="h-7 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 px-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {copilotModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                    )}
                    <button
                      onClick={() => {
                        const entry = getEntry(selectedId!);
                        if (!entry?.storyText) return;
                        setJiraNotice(null);
                        void handleReanalyze(entry.storyText, copilotModel, entry.jiraKey, entry.jiraUrl, entry.epicKey);
                      }}
                      className="text-xs font-medium text-violet-600 dark:text-violet-300 hover:underline"
                    >
                      Re-run anyway
                    </button>
                  </div>
                )}
              </div>
              {!loadingIds.has(selectedId ?? '') && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {getEntry(selectedId)?.jiraKey ? (
                    <button
                      onClick={async () => {
                        const id = selectedId!;
                        const entry = getEntry(id)!;
                        const key = entry.jiraKey!;
                        setJiraRefreshing(true);
                        setPendingUpdate(null);
                        setJiraNotice(null);
                        setError(null);
                        try {
                          const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
                          const data = await res.json() as { storyText?: string; browseUrl?: string; epicKey?: string; error?: string };
                          if (!res.ok || !data.storyText?.trim()) throw new Error(data.error ?? `Couldn't load ${key} from Jira.`);
                          const norm = (s: string) => s.replace(/\s+/g, " ").trim();
                          if (norm(data.storyText) === norm(entry.storyText ?? "")) {
                            setJiraNotice({ id, text: `Up to date: ${key} hasn't changed in Jira since this analysis.` });
                            return;
                          }
                          setPendingUpdate({ id, key, text: data.storyText, url: data.browseUrl ?? entry.jiraUrl, epicKey: data.epicKey });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "Couldn't load the ticket from Jira.");
                        } finally {
                          setJiraRefreshing(false);
                        }
                      }}
                      disabled={jiraRefreshing}
                      title="Fetch the latest ticket text and re-analyze only if it changed"
                      className="flex items-center gap-2 text-sm font-medium border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
                    >
                      {jiraRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {jiraRefreshing ? "Checking Jira…" : "Update from Jira"}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        const entry = getEntry(selectedId!);
                        const text = reanalyzeStates[selectedId!]?.text ?? entry?.storyText ?? "";
                        setReanalyzeStates((prev) => ({ ...prev, [selectedId!]: { show: true, text } }));
                      }}
                      className="flex items-center gap-2 text-sm font-medium border border-violet-400 dark:border-violet-600 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-4 py-2 rounded-xl transition-colors shadow-sm"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Edit &amp; reanalyze
                    </button>
                  )}
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
              {epicFlow}
              {loadingIds.has(selectedId ?? "") && (() => {
                const sectionsDone = [
                  currentAnalysis?.explanation,
                  currentAnalysis?.testSuggestions, currentAnalysis?.ambiguities,
                  currentAnalysis?.assumptions, currentAnalysis?.openQuestions,
                ].filter(Boolean).length;
                const pct = Math.round((sectionsDone / 5) * 100);
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
                        <span>Generating analysis… {sectionsDone}/5 sections</span>
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
                  {(() => {
                    const preparing = designLoadingIds.has(selectedId ?? "");
                    return (
                  <button
                    onClick={() => !preparing && setActiveTab("checklists")}
                    disabled={preparing}
                    title={preparing ? "Available when the test scenarios are ready" : undefined}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px flex items-center gap-1.5 disabled:cursor-not-allowed ${
                      preparing
                        ? "border-transparent text-slate-400 dark:text-slate-500"
                        : activeTab === "checklists"
                        ? "border-emerald-500 text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-800"
                        : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    Checklists
                    {preparing && <span className="flex items-center gap-1 text-[11px] font-normal"><Loader2 className="w-3 h-3 animate-spin" /> preparing…</span>}
                    {!preparing && selectedId && getEntry(selectedId)?.checklist?.some(c => c.status !== "pending") && (
                      <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">
                        {getEntry(selectedId)!.checklist!.filter(c => c.status !== "pending").length}/{getEntry(selectedId)!.checklist!.length}
                      </span>
                    )}
                  </button>
                    );
                  })()}
                  {/* Parent epic badge — this story's analysis included the epic summary */}
                  {selectedId && (() => {
                    const jKey = getEntry(selectedId)?.jiraKey;
                    const epic = jKey ? findEpicByStoryKey(jKey, getEntry(selectedId)?.epicKey) : null;
                    if (!epic) return null;
                    return (
                      <span className="ml-auto relative group">
                        <a href={epic.browseUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 border border-violet-300 dark:border-violet-500/50 bg-violet-50 dark:bg-violet-500/10 pl-2 pr-2.5 py-1 rounded-full hover:border-violet-500 transition-colors">
                          <BookOpen className="w-3.5 h-3.5 text-violet-500 dark:text-violet-300" />
                          Knows parent epic
                          <span className="font-mono font-semibold text-violet-700 dark:text-violet-300">{epic.epicKey}</span>
                        </a>
                        <span role="tooltip" className="pointer-events-none absolute right-0 top-full mt-2 z-30 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-300 shadow-xl opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all">
                          <span className="block font-semibold text-slate-800 dark:text-slate-100 mb-1">{epic.epicKey} · {epic.epicSummary}</span>
                          This story was analyzed together with a summary of its parent epic, so the AI could spot gaps and conflicts with the other stories. Click to open the epic in Jira.
                        </span>
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* ── Checklists tab ── */}
              {activeTab === "checklists" && !loadingIds.has(selectedId ?? "") && designLoadingIds.has(selectedId ?? "") && (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-14 text-center">
                  <Loader2 className="w-7 h-7 mx-auto animate-spin text-violet-500 mb-3" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Preparing the test checklist…</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">It&apos;s built from the test scenarios, which are still being generated.</p>
                </div>
              )}
              {activeTab === "checklists" && !loadingIds.has(selectedId ?? "") && !designLoadingIds.has(selectedId ?? "") && (
                <ChecklistTab
                  analysis={isCompleteAnalysis(currentAnalysis) ? currentAnalysis : null}
                  checklist={selectedId ? getEntry(selectedId)?.checklist : undefined}
                  storyTitle={selectedId ? (getEntry(selectedId)?.title ?? "") : ""}
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedCategories={selectedId ? (getEntry(selectedId)?.checklistPostedCategories ?? []) : []}
                  onCategoryPosted={(cat) => { if (selectedId) markChecklistCategoryPosted(selectedId, cat); }}
                  refLabel={selectedId ? getEntry(selectedId)?.checklistRefLabel : undefined}
                  onRefLabelChange={(l) => { if (selectedId) setChecklistRefLabel(selectedId, l); }}
                environment={selectedId ? getEntry(selectedId)?.checklistEnvironment : undefined}
                onEnvironmentChange={(env) => { if (selectedId) setChecklistEnvironment(selectedId, env); }}
                  reports={selectedId ? (getEntry(selectedId)?.reports ?? []) : []}
                  onReportsChange={(r) => { if (selectedId) setReports(selectedId, r); }}
                  onChecklistChange={(items) => { if (selectedId) patchChecklist(selectedId, items); }}
                />
              )}

              {/* ── Analysis tab ── */}
              {activeTab === "analysis" && (
                <>
              {/* ── STREAMING: progressive section tabs + single content pane ── */}
              {loadingIds.has(selectedId ?? "") && (() => {
                const streamDefs = [
                  { key: "explanation"     as typeof activeSection, label: "Explanation",    hasData: !!currentAnalysis.explanation },
                  { key: "deskCheck"       as typeof activeSection, label: "Scenarios",      hasData: false, later: true },
                  { key: "testSuggestions" as typeof activeSection, label: "Test Cases",     hasData: !!currentAnalysis.testSuggestions },
                  { key: "ambiguities"     as typeof activeSection, label: "Ambiguities",    hasData: !!(currentAnalysis.ambiguities?.items?.length) },
                  { key: "assumptions"     as typeof activeSection, label: "Assumptions",    hasData: !!(currentAnalysis.assumptions?.items?.length) },
                  { key: "openQuestions"   as typeof activeSection, label: "Open Questions", hasData: !!(currentAnalysis.openQuestions?.items?.length) },
                ];
                const writingKey = streamDefs.find(s => !s.later && !s.hasData)?.key;
                const activeBarColor = "bg-violet-500";
                return (
                  <>
                    <div className="flex gap-1.5 overflow-x-auto tab-scroll pb-1">
                      {streamDefs.map(({ key, label, hasData, later }) => {
                        const isActive = activeSection === key && hasData;
                        const isWriting = key === writingKey;
                        return (
                          <button
                            key={key}
                            onClick={() => hasData && setActiveSection(key)}
                            disabled={!hasData}
                            title={later ? "Generated after the analysis finishes" : isWriting ? "Being written now" : !hasData ? "Waiting" : undefined}
                            className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                              isActive
                                ? "bg-violet-600 text-white shadow-sm"
                                : hasData
                                  ? "bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white"
                                  : isWriting
                                    ? "border border-dashed border-violet-300 dark:border-violet-500/40 text-violet-600 dark:text-violet-300 cursor-default"
                                    : "border border-slate-200/70 dark:border-slate-700/50 text-slate-400 dark:text-slate-600 cursor-default"
                            }`}
                          >
                            {label}
                            {isWriting && <Loader2 className="w-3 h-3 animate-spin" />}
                            {hasData && !isActive && <Check className="w-3 h-3 text-emerald-500" />}
                          </button>
                        );
                      })}
                    </div>
                    {/* Single active section content — remounts on tab switch for entrance animation */}
                    <div key={activeSection} className="animate-section-in">
                      {activeSection === "explanation" && (
                        currentAnalysis.explanation
                          ? <AnalysisCard
                              sectioned
                              title={currentAnalysis.explanation.title}
                              content={currentAnalysis.explanation.content}
                              accentColor="violet"
                              isLoading
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
                              kind="ambiguity"
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
                              kind="assumption"
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
                              kind="question"
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
                      disabled={pdfBusy}
                      title="Download the whole analysis as a PDF"
                      className="group flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-xl text-sm font-medium bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-rose-300 dark:hover:border-rose-500/50 transition-all disabled:opacity-70"
                    >
                      <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 text-white flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                        {pdfBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      </span>
                      <span className="flex flex-col items-start leading-tight">
                        <span>{pdfBusy ? "Preparing…" : "Export PDF"}</span>
                        <span className="text-[10px] font-normal text-slate-400 dark:text-slate-500">Full analysis</span>
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Section sub-tabs — only after streaming completes */}
              {!loadingIds.has(selectedId ?? "") && isCompleteAnalysis(currentAnalysis) && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {([
                    { key: "explanation",     label: "Explanation",    color: "violet",  count: undefined },
                    { key: "deskCheck",       label: "Scenarios",      color: "violet",  count: currentAnalysis.testDesign?.scenarios.length, loading: designLoadingIds.has(selectedId ?? "") },
                    { key: "testSuggestions", label: "Test Cases",     color: "violet",  count: undefined },
                    { key: "ambiguities",     label: "Ambiguities",    color: "violet",  count: currentAnalysis.ambiguities?.items?.length, optional: true },
                    { key: "assumptions",     label: "Assumptions",    color: "violet",  count: currentAnalysis.assumptions?.items?.length, optional: true },
                    { key: "openQuestions",   label: "Open Questions", color: "violet",  count: currentAnalysis.openQuestions?.items?.length, optional: true },
                  ] as { key: typeof activeSection; label: string; color: string; count: number | undefined; loading?: boolean; optional?: boolean }[]).filter((t) => !t.optional || (t.count ?? 0) > 0).map(({ key, label, color, count, loading }) => (
                    <button
                      key={key}
                      onClick={() => setActiveSection(key)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                        activeSection === key
                          ? `bg-${color}-600 text-white shadow-sm`
                          : "bg-white dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-white"
                      }`}
                    >
                      {label}
                      {loading && <Loader2 className="w-3 h-3 animate-spin opacity-70" />}
                      {count != null && count > 0 && (
                        <span className={`text-[10px] min-w-[18px] text-center px-1.5 py-px rounded-full font-semibold ${
                          activeSection === key ? "bg-white/20 text-white" : "bg-slate-100 dark:bg-violet-500/15 text-slate-500 dark:text-violet-300"
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
                    key={`explanation-${selectedId}`}
                    sectioned
                    title={currentAnalysis.explanation.title}
                    content={currentAnalysis.explanation.content}
                    accentColor="violet"
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
                  kind="ambiguity"
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
                  kind="assumption"
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
                  kind="question"
                  jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                  postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.openQuestions.title] : undefined}
                  onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.openQuestions!.title, fp); }}
                  onItemsChange={(items) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, items } })}
                  onTitleChange={(t) => handlePatch({ openQuestions: { ...currentAnalysis.openQuestions!, title: t } })}
                />
              ) : null}

              {/* Scenarios (formal test design); legacy desk check shown below for older analyses */}
              {!loadingIds.has(selectedId ?? "") && isCompleteAnalysis(currentAnalysis) && activeSection === "deskCheck" && (
                <div className="space-y-4">
                  <TestDesignPanel
                    design={currentAnalysis.testDesign}
                    loading={designLoadingIds.has(selectedId ?? "")}
                    error={selectedId ? designErrors[selectedId] : null}
                    onGenerate={() => {
                      const entry = selectedId ? getEntry(selectedId) : undefined;
                      if (entry?.storyText) void generateTestDesign(entry.id, entry.storyText, currentAnalysis.meta?.model ?? "copilot/default", entry.jiraKey);
                    }}
                  />
                  {!currentAnalysis.testDesign && currentAnalysis.deskCheck && (
                    <AnalysisCard
                      title={`${currentAnalysis.deskCheck.title} (previous format)`}
                      content={currentAnalysis.deskCheck.content}
                      accentColor="blue"
                      jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                      postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.deskCheck.title] : undefined}
                      onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.deskCheck!.title, fp); }}
                      onContentChange={(c) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, content: c } })}
                      onTitleChange={(t) => handlePatch({ deskCheck: { ...currentAnalysis.deskCheck!, title: t } })}
                    />
                  )}
                </div>
              )}

              {/* Test Suggestions */}
              {!loadingIds.has(selectedId ?? "") && (!isCompleteAnalysis(currentAnalysis) || activeSection === "testSuggestions") && (
                currentAnalysis.testSuggestions ? (
                  <TestSuggestionsPanel key={`ts-${selectedId}`} content={currentAnalysis.testSuggestions.content} onSave={(c) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, content: c } })} editor={<AnalysisCard
                    title={currentAnalysis.testSuggestions.title}
                    content={currentAnalysis.testSuggestions.content}
                    accentColor="emerald"
                    jiraKey={selectedId ? getEntry(selectedId)?.jiraKey : undefined}
                    postedFingerprint={selectedId ? getEntry(selectedId)?.jiraPostedSections?.[currentAnalysis.testSuggestions.title] : undefined}
                    onPosted={(fp) => { if (selectedId) markJiraPosted(selectedId, currentAnalysis.testSuggestions!.title, fp); }}
                    onContentChange={(c) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, content: c } })}
                    onTitleChange={(t) => handlePatch({ testSuggestions: { ...currentAnalysis.testSuggestions!, title: t } })}
                  />} />
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
              {epicFlow}
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
