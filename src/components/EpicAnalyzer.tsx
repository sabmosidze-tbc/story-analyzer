"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, Trash2, RefreshCw, BookOpen, RotateCcw, AlertCircle, CheckCircle2, Clock, ChevronRight, XCircle } from "lucide-react";
import { EpicContext, EpicStory } from "@/types";
import { useEpicLibrary } from "@/hooks/useEpicLibrary";
import { useCopilotModels } from "@/hooks/useCopilotModels";
import JiraBoardBadge from "@/components/JiraBoardBadge";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseEpicAIOutput(raw: string): { contextBlock: string; overviewDocument: string } | null {
  try {
    const parsed = JSON.parse(raw) as { contextBlock?: string; overviewDocument?: string };
    if (parsed.contextBlock) return { contextBlock: parsed.contextBlock, overviewDocument: parsed.overviewDocument ?? "" };
  } catch { /* not pure JSON — try extracting from markdown fences */ }

  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]) as { contextBlock?: string; overviewDocument?: string };
      if (parsed.contextBlock) return { contextBlock: parsed.contextBlock, overviewDocument: parsed.overviewDocument ?? "" };
    } catch { /* fall through */ }
  }
  return null;
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function EpicAnalyzer() {
  const { epics, saveEpic, deleteEpic } = useEpicLibrary();

  // Input / fetch state
  const [epicInput, setEpicInput] = useState("");
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedStories, setFetchedStories] = useState<EpicStory[] | null>(null);
  const [fetchedEpicKey, setFetchedEpicKey] = useState<string | null>(null);
  const [fetchedEpicSummary, setFetchedEpicSummary] = useState<string>("");
  const [fetchedBrowseUrl, setFetchedBrowseUrl] = useState<string | null>(null);

  // Auto-check: debounced type validation before user clicks Load
  const [autoCheck, setAutoCheck] = useState<"idle" | "checking" | "ok" | "not-epic">("idle");
  const [autoCheckError, setAutoCheckError] = useState<string | null>(null);
  const autoCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Analysis state
  const [analyzeStatus, setAnalyzeStatus] = useState<"idle" | "loading" | "error">("idle");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [streamBuffer, setStreamBuffer] = useState<string>("");

  // View state
  const [viewingEpicKey, setViewingEpicKey] = useState<string | null>(null);
  const { models, model: modelId, setModel: setModelId } = useCopilotModels();

  const abortRef = useRef<AbortController | null>(null);

  // ── Debounced auto-check: validate ticket type as user types ──────────────
  useEffect(() => {
    const key = epicInput.trim().toUpperCase();
    const isValidFormat = /^[A-Z]{2,10}-\d+$/.test(key);

    if (!isValidFormat) {
      setAutoCheck("idle");
      setAutoCheckError(null);
      if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);
      return;
    }

    // Don't re-check if already loaded
    if (fetchedEpicKey === key && fetchedStories !== null) return;

    setAutoCheck("checking");
    setAutoCheckError(null);
    if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current);

    autoCheckTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
        const data = await res.json() as { issueType?: string; error?: string };
        if (!res.ok) {
          setAutoCheck("not-epic");
          setAutoCheckError(data.error ?? "Failed to check ticket");
          return;
        }
        if (data.issueType?.toLowerCase() !== "epic") {
          setAutoCheck("not-epic");
          setAutoCheckError(`${key} is a "${data.issueType ?? "Unknown"}" ticket, not an Epic.`);
        } else {
          setAutoCheck("ok");
          setAutoCheckError(null);
        }
      } catch {
        // Silent — don't block user if check fails
        setAutoCheck("idle");
      }
    }, 650);

    return () => { if (autoCheckTimerRef.current) clearTimeout(autoCheckTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epicInput]);

  // ── Fetch epic from Jira ────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    const key = epicInput.trim().toUpperCase();
    if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
      setFetchError("Enter a valid Jira key, e.g. PROJ-123");
      return;
    }

    setFetchStatus("loading");
    setFetchError(null);
    setFetchedStories(null);
    setFetchedEpicKey(null);

    try {
      const res = await fetch(`/api/jira/epic-context?key=${encodeURIComponent(key)}`);
      const data = await res.json() as { error?: string; epicKey?: string; epicSummary?: string; browseUrl?: string; stories?: EpicStory[] };

      if (!res.ok) {
        setFetchError(data.error ?? "Failed to load epic");
        setFetchStatus("error");
        return;
      }

      setFetchedEpicKey(data.epicKey ?? key);
      setFetchedEpicSummary(data.epicSummary ?? "");
      setFetchedBrowseUrl(data.browseUrl ?? null);
      setFetchedStories(data.stories ?? []);
      setFetchStatus("idle");
    } catch {
      setFetchError("Network error — check your connection");
      setFetchStatus("error");
    }
  }, [epicInput]);

  // ── Run AI analysis (new or re-analyze) ───────────────────────────────────
  const handleAnalyze = useCallback(async (
    epicKey: string,
    epicSummary: string,
    stories: EpicStory[],
  ) => {
    if (analyzeStatus === "loading") {
      abortRef.current?.abort();
      return;
    }

    setAnalyzeStatus("loading");
    setAnalyzeError(null);
    setStreamBuffer("");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/analyze/epic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({ epicKey, epicSummary, stories, model: modelId }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setAnalyzeError(err.error ?? "Analysis failed");
        setAnalyzeStatus("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as { type: string; text?: string; error?: string };
            if (event.type === "chunk" && event.text) {
              accumulated += event.text;
              setStreamBuffer(accumulated);
            } else if (event.type === "done") {
              // Parse final output
              const parsed = parseEpicAIOutput(accumulated);
              if (parsed) {
                const ctx: EpicContext = {
                  epicKey,
                  epicSummary,
                  browseUrl: fetchedBrowseUrl ?? undefined,
                  storyCount: stories.length,
                  analyzedStoryKeys: stories.map((s) => s.key),
                  analyzedAt: new Date().toISOString(),
                  contextBlock: parsed.contextBlock,
                  overviewDocument: parsed.overviewDocument,
                };
                saveEpic(ctx);
                // Collapse the stories panel and clear the input — analysis is done
                setFetchedStories(null);
                setFetchedEpicKey(null);
                setFetchedBrowseUrl(null);
                setEpicInput("");
                setAutoCheck("idle");
                setAutoCheckError(null);
                setViewingEpicKey(epicKey); // auto-expand in library
              } else {
                setAnalyzeError("AI returned output in unexpected format. Please retry.");
                setAnalyzeStatus("error");
                return;
              }
            } else if (event.type === "error") {
              setAnalyzeError(event.error ?? "Analysis failed");
              setAnalyzeStatus("error");
              return;
            }
          } catch { /* skip malformed lines */ }
        }
      }

      setAnalyzeStatus("idle");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setAnalyzeError(err instanceof Error ? err.message : "Analysis failed");
        setAnalyzeStatus("error");
      } else {
        setAnalyzeStatus("idle");
      }
    }
  }, [analyzeStatus, modelId, saveEpic, fetchedBrowseUrl]);

  // ── Re-analyze an existing epic ────────────────────────────────────────────
  const handleReAnalyze = useCallback(async (existing: EpicContext) => {
    if (!fetchedStories || fetchedEpicKey !== existing.epicKey) {
      // Need to re-fetch first
      setEpicInput(existing.epicKey);
      setFetchError("Click 'Load Stories' first to refresh the story list before re-analyzing.");
      return;
    }
    await handleAnalyze(existing.epicKey, existing.epicSummary, fetchedStories);
  }, [fetchedStories, fetchedEpicKey, handleAnalyze]);

  const viewingCtx = viewingEpicKey ? epics.find((e) => e.epicKey === viewingEpicKey) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Epic Analyzer</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Analyze an entire epic to build context that automatically enriches your individual story analyses.
        </p>
      </div>

      {/* ── Input card ──────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Load an epic from Jira</p>

        {/* Dynamic detection banner — shown ABOVE the input as soon as a valid key format is typed */}
        {(() => {
          const detectedKey = /^[A-Z]{2,10}-\d+$/i.test(epicInput.trim()) ? epicInput.trim().toUpperCase() : null;
          if (!detectedKey) return null;
          if (fetchedStories && fetchedEpicKey === detectedKey) return null; // already loaded — banner shown below

          const isNotEpic = autoCheck === "not-epic" || (fetchStatus === "error" && !!fetchError);
          const errorMsg = autoCheckError ?? fetchError;
          const isChecking = autoCheck === "checking";
          const isOk = autoCheck === "ok";
          const isFetchLoading = fetchStatus === ("loading" as string);
          const canLoad = (isOk || autoCheck === "idle") && !isFetchLoading && !isNotEpic;

          return (
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
              isNotEpic
                ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700"
                : "bg-violet-50 dark:bg-violet-500/10 border-violet-300 dark:border-violet-600"
            }`}>
              {isChecking ? (
                <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-violet-400" />
              ) : isNotEpic ? (
                <XCircle className="w-4 h-4 flex-shrink-0 text-red-500 dark:text-red-400" />
              ) : (
                <span className="text-xs font-semibold text-violet-500 dark:text-violet-400 flex-shrink-0 whitespace-nowrap">
                  {isOk ? "Epic detected" : "Epic key detected"}
                </span>
              )}
              <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 border ${
                isNotEpic
                  ? "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-800/50 border-red-300 dark:border-red-600"
                  : "text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-500/20 border-violet-300 dark:border-violet-600"
              }`}>
                {detectedKey}
              </span>
              {isNotEpic && errorMsg && (
                <span className="text-xs text-red-600 dark:text-red-400 flex-1 min-w-0 truncate">{errorMsg}</span>
              )}
              {isChecking && (
                <span className="text-xs text-violet-400 flex-1">Checking ticket type…</span>
              )}
              <div className="flex-1" />
              <button
                onClick={handleFetch}
                disabled={!canLoad}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors flex-shrink-0"
              >
                {isFetchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {isFetchLoading ? "Loading…" : "Load Epic"}
              </button>
            </div>
          );
        })()}

        {/* Plain input — full width, Enter triggers load */}
        <input
          className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-950 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
          placeholder="Epic key, e.g. PROJ-100"
          value={epicInput}
          onChange={(e) => {
            setEpicInput(e.target.value);
            setFetchError(null);
            setFetchedStories(null);
            setFetchedEpicKey(null);
            setFetchedBrowseUrl(null);
            setAutoCheck("idle");
            setAutoCheckError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && handleFetch()}
        />

        {/* Stories preview */}
        {fetchedStories && fetchedEpicKey && (
          <div className="space-y-3">
            {/* Epic detected banner — purple, mirroring the "Jira issue detected" style */}
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-300 dark:border-violet-700">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-xs font-semibold text-violet-500 dark:text-violet-400 flex-shrink-0">Epic detected</span>
                <a
                  href={`${typeof window !== "undefined" ? "" : ""}#`}
                  className="flex items-center gap-1 font-mono text-xs font-bold text-violet-600 dark:text-violet-300 bg-violet-100 dark:bg-violet-500/20 border border-violet-300 dark:border-violet-600 px-2 py-0.5 rounded-full"
                  onClick={(e) => e.preventDefault()}
                >
                  {fetchedEpicKey}
                </a>
                <span className="text-xs text-violet-600 dark:text-violet-300 truncate">{fetchedEpicSummary}</span>
                <JiraBoardBadge jiraKey={fetchedEpicKey} />
              </div>
              <span className="text-xs text-violet-500 dark:text-violet-400 flex-shrink-0">
                {fetchedStories.length} {fetchedStories.length === 1 ? "story" : "stories"}
              </span>
            </div>

            <div className="flex items-center justify-end">
              {/* Model selector */}
              <select
                value={modelId ?? ""}
                onChange={(e) => setModelId(e.target.value)}
                className="text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Story list */}
            {fetchedStories.length > 0 ? (
              <div className="max-h-48 overflow-y-auto space-y-1 pr-1 tab-scroll">
                {fetchedStories.map((s) => (
                  <div key={s.key} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400 py-1 border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                    <span className="font-mono font-semibold text-violet-500 dark:text-violet-400 flex-shrink-0">{s.key}</span>
                    <span className="flex-1">{s.summary}</span>
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      /done|complete|closed/i.test(s.status)
                        ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                        : /progress|active/i.test(s.status)
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400"
                    }`}>{s.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">No child stories found for this epic.</p>
            )}

            {fetchedStories.length > 0 && (
              <button
                onClick={() => handleAnalyze(fetchedEpicKey, fetchedEpicSummary, fetchedStories)}
                disabled={analyzeStatus === "loading"}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
              >
                {analyzeStatus === "loading" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing… (click to cancel)</>
                ) : (
                  <><BookOpen className="w-4 h-4" /> Analyze Epic Context</>
                )}
              </button>
            )}

            {analyzeStatus === "loading" && streamBuffer && (
              <div className="mt-2 text-xs text-slate-400 dark:text-slate-500 italic truncate">
                {streamBuffer.slice(-120)}
              </div>
            )}

            {analyzeError && (
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{analyzeError}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Epic Library ─────────────────────────────────────────────────────── */}
      {epics.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Saved Epics ({epics.length})</p>

          {epics.map((epic) => {
            const age = daysAgo(epic.analyzedAt);
            const isStale = age > 7;
            const isViewing = viewingEpicKey === epic.epicKey;

            return (
              <div key={epic.epicKey} className={`rounded-xl border p-4 space-y-2 transition-colors ${
                isViewing
                  ? "border-violet-400 dark:border-violet-600 bg-violet-50/50 dark:bg-violet-900/10"
                  : "border-slate-200 dark:border-slate-700"
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {epic.browseUrl ? (
                        <a
                          href={epic.browseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm font-bold text-violet-500 dark:text-violet-400 hover:underline"
                        >
                          {epic.epicKey} ↗
                        </a>
                      ) : (
                        <span className="font-mono text-sm font-bold text-violet-500 dark:text-violet-400">{epic.epicKey}</span>
                      )}
                      <JiraBoardBadge jiraKey={epic.epicKey} />
                      {isStale && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">
                          <Clock className="w-3 h-3" /> {age}d old
                        </span>
                      )}
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {epic.storyCount} {epic.storyCount === 1 ? "story" : "stories"} · analyzed {new Date(epic.analyzedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5 truncate">{epic.epicSummary}</p>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setViewingEpicKey(isViewing ? null : epic.epicKey)}
                      title={isViewing ? "Collapse" : "View overview"}
                      className="p-1.5 rounded-lg hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 dark:text-violet-400 transition-colors"
                    >
                      <BookOpen className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        const existing = epics.find((e) => e.epicKey === epic.epicKey);
                        if (existing) await handleReAnalyze(existing);
                      }}
                      title="Re-analyze"
                      className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        deleteEpic(epic.epicKey);
                        if (viewingEpicKey === epic.epicKey) setViewingEpicKey(null);
                      }}
                      title="Delete"
                      className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded view */}
                {isViewing && viewingCtx && viewingCtx.epicKey === epic.epicKey && (
                  <div className="mt-3 space-y-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                    {/* Context block — the full enriched context injected into child story analyses */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                        Context injected into story analyses
                      </p>
                      <pre className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 whitespace-pre-wrap overflow-x-auto max-h-64 tab-scroll border border-slate-200 dark:border-slate-700">
                        {viewingCtx.contextBlock}
                      </pre>
                    </div>

                    {/* Legacy overview document — hidden if empty (new analyses won't have it) */}
                    {viewingCtx.overviewDocument ? (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                          Overview document
                        </p>
                        <div className="text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50 rounded-lg p-3 max-h-72 overflow-y-auto tab-scroll border border-slate-200 dark:border-slate-700 prose prose-sm dark:prose-invert max-w-none">
                          {viewingCtx.overviewDocument.split("\n").map((line, i) => {
                            if (line.startsWith("## ")) return <h3 key={i} className="font-bold text-slate-800 dark:text-slate-200 mt-3 mb-1">{line.slice(3)}</h3>;
                            if (line.startsWith("### ")) return <h4 key={i} className="font-semibold text-slate-700 dark:text-slate-300 mt-2 mb-0.5 text-xs uppercase tracking-wide">{line.slice(4)}</h4>;
                            if (line.startsWith("- ")) return <li key={i} className="ml-4 list-disc text-xs">{line.slice(2)}</li>;
                            if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-semibold text-xs">{line.slice(2, -2)}</p>;
                            if (line.trim() === "") return <div key={i} className="h-1.5" />;
                            return <p key={i} className="text-xs leading-relaxed">{line}</p>;
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      This context is automatically used when you analyze a story from this epic.
                    </div>

                    <button
                      onClick={() => setViewingEpicKey(null)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" /> Collapse
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {epics.length === 0 && (
        <div className="text-center py-12 text-slate-400 dark:text-slate-500">
          <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No epics analyzed yet</p>
          <p className="text-xs mt-1">Load an epic above to build context that improves your story analyses.</p>
        </div>
      )}
    </div>
  );
}
