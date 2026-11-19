"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AlertTriangle, BookOpen, ChevronRight, ExternalLink, Loader2, RefreshCw, Sparkles, Square, Trash2, XCircle } from "lucide-react";
import type { EpicContext, EpicStory, StoryEntry } from "@/types";
import { useEpicLibrary } from "@/hooks/useEpicLibrary";
import { useCopilotModels } from "@/hooks/useCopilotModels";
import JiraBoardBadge from "@/components/JiraBoardBadge";
import { epicDrift, parseEpicOutput, storyHash, storyProgress } from "@/lib/epic";
import { ContextTab, NeedsAnalysis, OverviewTab, StoriesTab, StrategyTab } from "@/components/EpicTabs";
import ErrorNotice from "@/components/ErrorNotice";

interface LoadedEpic { key: string; summary: string; description: string; browseUrl?: string; stories: EpicStory[] }
type Tab = "stories" | "overview" | "strategy" | "context";

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

function ago(iso?: string): string {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export default function EpicAnalyzer({ entries, analyzingKeys, onOpenStory, onAnalyzeStory }: {
  entries: StoryEntry[];
  analyzingKeys: string[];
  onOpenStory: (entryId: string) => void;
  onAnalyzeStory: (key: string) => Promise<string | null>;
}) {
  const { epics, saveEpic, deleteEpic, updateEpicStories } = useEpicLibrary();
  const { models, model: modelId, setModel: setModelId } = useCopilotModels();

  const [pickedKey, setSelectedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stories");

  // Load input
  const [epicInput, setEpicInput] = useState("");
  const [autoCheck, setAutoCheck] = useState<"idle" | "checking" | "ok" | "not-epic">("idle");
  const [autoCheckError, setAutoCheckError] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // AI analysis
  const [analyzingEpic, setAnalyzingEpic] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [streamChars, setStreamChars] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Default to the most recent epic.
  // "" means you closed it; null means nothing picked yet, so the first epic opens
  const selectedKey = pickedKey === "" ? null : pickedKey && epics.some((e) => e.epicKey === pickedKey) ? pickedKey : epics[0]?.epicKey ?? null;
  const selected = selectedKey ? epics.find((e) => e.epicKey === selectedKey) ?? null : null;

  // ── Debounced check that the typed key is an Epic ──────────────────────────
  useEffect(() => {
    const key = epicInput.trim().toUpperCase();
    if (!KEY_RE.test(key)) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
        const data = await res.json() as { issueType?: string; error?: string };
        if (!res.ok) { setAutoCheck("not-epic"); setAutoCheckError(data.error ?? "Could not check the ticket"); return; }
        if (data.issueType?.toLowerCase() !== "epic") {
          setAutoCheck("not-epic");
          setAutoCheckError(`${key} is a ${data.issueType ?? "non-epic"}, not an Epic.`);
        } else setAutoCheck("ok");
      } catch { setAutoCheck("idle"); }
    }, 600);
    return () => clearTimeout(t);
  }, [epicInput]);

  // ── Jira ───────────────────────────────────────────────────────────────────
  const fetchEpic = useCallback(async (key: string): Promise<LoadedEpic | null> => {
    setLoadingKey(key);
    setLoadError(null);
    try {
      const res = await fetch(`/api/jira/epic-context?key=${encodeURIComponent(key)}`);
      const data = await res.json() as { error?: string; epicKey?: string; epicSummary?: string; epicDescription?: string; browseUrl?: string; stories?: EpicStory[] };
      if (!res.ok) { setLoadError(data.error ?? "Failed to load epic"); return null; }
      return { key: data.epicKey ?? key, summary: data.epicSummary ?? "", description: data.epicDescription ?? "", browseUrl: data.browseUrl, stories: data.stories ?? [] };
    } catch {
      setLoadError("Network error — check your connection");
      return null;
    } finally {
      setLoadingKey(null);
    }
  }, []);

  /** Load from Jira and store; an existing epic keeps its analysis. */
  const syncEpic = useCallback(async (key: string): Promise<LoadedEpic | null> => {
    const loaded = await fetchEpic(key);
    if (!loaded) return null;
    const patch = { stories: loaded.stories, epicSummary: loaded.summary, epicDescription: loaded.description, browseUrl: loaded.browseUrl };
    if (epics.some((e) => e.epicKey === loaded.key)) updateEpicStories(loaded.key, patch);
    else saveEpic({
      epicKey: loaded.key, epicSummary: loaded.summary, epicDescription: loaded.description, browseUrl: loaded.browseUrl,
      storyCount: loaded.stories.length, analyzedStoryKeys: [], analyzedAt: "", contextBlock: "",
      stories: loaded.stories, storiesFetchedAt: new Date().toISOString(),
    });
    return loaded;
  }, [epics, fetchEpic, saveEpic, updateEpicStories]);

  const handleLoad = async () => {
    const key = epicInput.trim().toUpperCase();
    if (!KEY_RE.test(key)) { setLoadError("Enter a valid Jira key, e.g. PROJ-123"); return; }
    if (autoCheck === "not-epic") return;
    const loaded = await syncEpic(key);
    if (loaded) {
      setSelectedKey(loaded.key);
      setTab("stories");
      setEpicInput("");
      setAutoCheck("idle");
    }
  };

  // ── AI analysis ────────────────────────────────────────────────────────────
  const analyze = useCallback(async (epic: EpicContext) => {
    if (analyzingEpic) { abortRef.current?.abort(); return; }
    setAnalyzeError(null);
    setStreamChars(0);
    setAnalyzingEpic(epic.epicKey);
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const loaded = await syncEpic(epic.epicKey);
      if (!loaded || abort.signal.aborted) return;
      if (!loaded.stories.length) { setAnalyzeError("This epic has no child issues in Jira."); return; }

      const res = await fetch("/api/analyze/epic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({ epicKey: loaded.key, epicSummary: loaded.summary, epicDescription: loaded.description, stories: loaded.stories, model: modelId }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setAnalyzeError(err.error ?? "Analysis failed");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let ev: { type: string; text?: string; error?: string };
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === "chunk" && ev.text) { text += ev.text; setStreamChars(text.length); }
          else if (ev.type === "error") { setAnalyzeError(ev.error ?? "Analysis failed"); return; }
          else if (ev.type === "done") {
            const parsed = parseEpicOutput(text);
            if (!parsed) { setAnalyzeError("The AI answer could not be read. Try again or pick another model."); return; }
            saveEpic({
              epicKey: loaded.key, epicSummary: loaded.summary, epicDescription: loaded.description, browseUrl: loaded.browseUrl,
              storyCount: loaded.stories.length,
              analyzedStoryKeys: loaded.stories.map((s) => s.key),
              analyzedAt: new Date().toISOString(),
              contextBlock: parsed.contextBlock,
              analysis: parsed.analysis,
              stories: loaded.stories,
              storiesFetchedAt: new Date().toISOString(),
              analyzedHashes: Object.fromEntries(loaded.stories.map((s) => [s.key, storyHash(s)])),
            });
            setTab((t) => (t === "stories" ? "overview" : t));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzingEpic(null);
      abortRef.current = null;
    }
  }, [analyzingEpic, modelId, saveEpic, syncEpic]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const stories = selected?.stories ?? [];
    const ps = stories.map((s) => storyProgress(s.key, entries));
    return {
      total: stories.length,
      analyzed: ps.filter((p) => p.analyzed).length,
      failed: ps.filter((p) => p.state === "failed").length,
      passed: ps.filter((p) => p.state === "passed").length,
    };
  }, [selected, entries]);
  const drift = selected ? epicDrift(selected) : { added: [], changed: [], removed: [] };
  const driftCount = drift.added.length + drift.changed.length + drift.removed.length;
  const isAnalyzing = !!selected && analyzingEpic === selected.epicKey;
  const isLoadingSelected = !!selected && loadingKey === selected.epicKey;
  const hasAnalysis = !!selected?.analysis;

  const typedKey = KEY_RE.test(epicInput.trim().toUpperCase()) ? epicInput.trim().toUpperCase() : null;

  const TABS: { id: Tab; label: string }[] = [
    { id: "stories", label: `Stories${stats.total ? ` (${stats.total})` : ""}` },
    { id: "overview", label: "Overview" },
    { id: "strategy", label: "Test strategy" },
    { id: "context", label: "AI context" },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Epics</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">See every story of an epic, its test progress, and what to test across stories.</p>
        </div>
        {/* Load an epic */}
        <div className="relative w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 rounded-xl border bg-white dark:bg-slate-900 px-3 py-2 w-full sm:w-72 focus-within:ring-2 transition-colors ${autoCheck === "not-epic" ? "border-red-400 dark:border-red-500/70 focus-within:ring-red-500/40" : "border-slate-300 dark:border-slate-600 focus-within:ring-violet-500"}`}>
              <BookOpen className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <input
                value={epicInput}
                onChange={(e) => {
                  setEpicInput(e.target.value);
                  setLoadError(null);
                  setAutoCheckError(null);
                  setAutoCheck(KEY_RE.test(e.target.value.trim().toUpperCase()) ? "checking" : "idle");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                placeholder="Load epic, e.g. PROJ-100"
                className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none"
              />
              {autoCheck === "checking" && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" />}
              {autoCheck === "ok" && <span className="text-[10px] font-semibold text-violet-600 dark:text-violet-300">Epic</span>}
              {autoCheck === "not-epic" && (
                <button type="button" title="Clear" aria-label="Clear"
                  onClick={() => { setEpicInput(""); setAutoCheck("idle"); setAutoCheckError(null); setLoadError(null); }}
                  className="p-0.5 -mr-1 rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              onClick={handleLoad}
              disabled={!typedKey || autoCheck === "not-epic" || !!loadingKey}
              className="flex items-center gap-1 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium"
            >
              {loadingKey && loadingKey === typedKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />} Load
            </button>
          </div>
          {(autoCheckError || (loadError && !selected)) && (
            // Floats under the input so the layout doesn't shift
            <div className="epic-flow-in absolute left-0 top-full mt-2 z-20 w-full sm:w-96 max-w-[calc(100vw-2rem)]">
              <ErrorNotice message={autoCheckError ?? loadError} className="shadow-lg" />
            </div>
          )}
        </div>
      </div>

      {/* Saved epics */}
      {epics.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {epics.map((e) => {
            const active = e.epicKey === selectedKey;
            const busy = analyzingEpic === e.epicKey;
            const count = e.stories?.length ?? e.storyCount;
            return (
              <div key={e.epicKey} role="button" tabIndex={0}
                onClick={() => setSelectedKey(selectedKey === e.epicKey ? null : e.epicKey)}
                onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSelectedKey(selectedKey === e.epicKey ? null : e.epicKey)}
                className={`group relative rounded-xl border pl-3.5 pr-2 py-2.5 cursor-pointer transition-all overflow-hidden ${active
                  ? "bg-violet-50 dark:bg-violet-500/10 border-violet-400 dark:border-violet-500/60 shadow-sm shadow-violet-500/10"
                  : "bg-white dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-500/40"}`}>
                <span className={`absolute left-0 inset-y-0 w-1 ${active ? "bg-violet-500" : "bg-transparent group-hover:bg-violet-300/50"}`} />
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-violet-600 dark:text-violet-300 whitespace-nowrap">{e.epicKey}</span>
                  {busy ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-violet-600 dark:text-violet-300"><Loader2 className="w-3 h-3 animate-spin" /> Analyzing</span>
                  ) : e.contextBlock ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Analyzed</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Not analyzed</span>
                  )}
                  <ChevronRight className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${active ? "rotate-90 text-violet-500" : ""}`} />
                  <button
                    onClick={(ev) => { ev.stopPropagation(); if (confirm(`Remove ${e.epicKey} from your saved epics?`)) { deleteEpic(e.epicKey); if (active) setSelectedKey(""); } }}
                    title="Remove from saved epics" aria-label={`Remove ${e.epicKey}`}
                    className="p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-200 truncate mt-0.5" title={e.epicSummary}>{e.epicSummary || "Untitled epic"}</p>
                {count > 0 && <p className="text-[11px] text-slate-400 mt-0.5">{count} {count === 1 ? "story" : "stories"}</p>}
              </div>
            );
          })}
        </div>
      )}

      {!selected ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-16 text-center">
          <BookOpen className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No epic open</p>
          <p className="text-xs text-slate-400 mt-1">Type an epic key above and press Load.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700">
          {/* Header */}
          <div className="p-5 border-b border-slate-100 dark:border-slate-700 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.browseUrl
                    ? <a href={selected.browseUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-mono text-sm font-bold text-violet-600 dark:text-violet-300 hover:underline">{selected.epicKey}<ExternalLink className="w-3 h-3" /></a>
                    : <span className="font-mono text-sm font-bold text-violet-600 dark:text-violet-300">{selected.epicKey}</span>}
                  <JiraBoardBadge jiraKey={selected.epicKey} />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mt-0.5">{selected.epicSummary}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {selected.analyzedAt ? `Analyzed ${ago(selected.analyzedAt)}` : "Not analyzed yet"}
                  {selected.storiesFetchedAt && <> · Jira synced {ago(selected.storiesFetchedAt)}</>}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => { if (confirm(`Remove ${selected.epicKey} from your saved epics? Stories you analyzed stay in history.`)) { deleteEpic(selected.epicKey); setSelectedKey(""); } }}
                  disabled={isAnalyzing}
                  title="Remove this epic from saved epics"
                  className="p-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-red-400 hover:text-red-600 disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => syncEpic(selected.epicKey)} disabled={isLoadingSelected || isAnalyzing}
                  title="Reload stories and statuses from Jira (no AI)"
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-violet-400 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSelected && !isAnalyzing ? "animate-spin" : ""}`} /> Refresh from Jira
                </button>
                {models.length > 0 && (
                  <select value={modelId ?? ""} onChange={(e) => setModelId(e.target.value)} disabled={isAnalyzing}
                    className="text-xs rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500">
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                )}
                <button onClick={() => analyze(selected)} disabled={!!analyzingEpic && !isAnalyzing}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3.5 py-2 rounded-lg text-white disabled:opacity-50 ${isAnalyzing ? "bg-slate-600 hover:bg-red-600" : "bg-violet-600 hover:bg-violet-700"}`}>
                  {isAnalyzing ? <><Square className="w-3 h-3 fill-current" /> Cancel</> : <><Sparkles className="w-3.5 h-3.5" /> {hasAnalysis || selected.contextBlock ? "Re-analyze" : "Analyze epic"}</>}
                </button>
              </div>
            </div>

            {/* Stats */}
            {stats.total > 0 && (
              <div className="flex gap-5 text-xs">
                <span className="text-slate-500 dark:text-slate-400"><b className="text-slate-800 dark:text-slate-100 text-sm">{stats.total}</b> stories</span>
                <span className="text-slate-500 dark:text-slate-400"><b className="text-slate-800 dark:text-slate-100 text-sm">{stats.analyzed}</b> analyzed here</span>
                <span className="text-slate-500 dark:text-slate-400"><b className="text-emerald-600 dark:text-emerald-400 text-sm">{stats.passed}</b> fully passed</span>
                <span className="text-slate-500 dark:text-slate-400"><b className={`text-sm ${stats.failed ? "text-red-600 dark:text-red-400" : "text-slate-800 dark:text-slate-100"}`}>{stats.failed}</b> with failures</span>
              </div>
            )}

            {isAnalyzing && (
              <div className="flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-500/10 rounded-lg px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {isLoadingSelected ? "Loading stories from Jira…" : streamChars ? `AI is writing the analysis… ${Math.round(streamChars / 1000)}k characters` : "Waiting for the AI…"}
                <span className="text-violet-400 ml-auto">Big epics can take 1–2 minutes</span>
              </div>
            )}
            {(analyzeError || loadError) && !isAnalyzing && <ErrorNotice message={analyzeError ?? loadError} />}
            {selected.contextBlock && driftCount > 0 && !isAnalyzing && (
              <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>
                  Jira changed since the analysis:
                  {drift.added.length > 0 && <> {drift.added.length} new</>}
                  {drift.changed.length > 0 && <>{drift.added.length ? "," : ""} {drift.changed.length} edited</>}
                  {drift.removed.length > 0 && <>{drift.added.length || drift.changed.length ? "," : ""} {drift.removed.length} removed</>}
                  {" "}— the overview and strategy may be out of date.
                </span>
                <button onClick={() => analyze(selected)} className="ml-auto font-semibold hover:underline flex-shrink-0">Re-analyze</button>
              </div>
            )}
            {selected.contextBlock && !hasAnalysis && !isAnalyzing && (
              <p className="text-xs text-slate-500 dark:text-slate-400">This epic was analyzed with an older version. Re-analyze to get the overview and test strategy.</p>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 pt-3 border-b border-slate-100 dark:border-slate-700">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.id
                  ? "border-violet-600 text-violet-700 dark:text-violet-300"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "stories" && (selected.stories ? (
              <StoriesTab epic={selected} entries={entries} analyzingKeys={analyzingKeys} onOpenStory={onOpenStory} onAnalyzeStory={onAnalyzeStory} />
            ) : (
              <div className="text-center py-10">
                <p className="text-sm text-slate-600 dark:text-slate-300">Story list not loaded for this saved epic.</p>
                <button onClick={() => syncEpic(selected.epicKey)} disabled={isLoadingSelected}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-600 hover:border-violet-400 text-slate-700 dark:text-slate-200">
                  <RefreshCw className={`w-4 h-4 ${isLoadingSelected ? "animate-spin" : ""}`} /> Load stories from Jira
                </button>
              </div>
            ))}
            {tab === "overview" && (hasAnalysis ? <OverviewTab epic={selected} /> : <NeedsAnalysis onAnalyze={() => analyze(selected)} busy={!!analyzingEpic} />)}
            {tab === "strategy" && (hasAnalysis ? <StrategyTab epic={selected} /> : <NeedsAnalysis onAnalyze={() => analyze(selected)} busy={!!analyzingEpic} />)}
            {tab === "context" && (selected.contextBlock ? <ContextTab epic={selected} /> : <NeedsAnalysis onAnalyze={() => analyze(selected)} busy={!!analyzingEpic} />)}
          </div>
        </div>
      )}
    </div>
  );
}
