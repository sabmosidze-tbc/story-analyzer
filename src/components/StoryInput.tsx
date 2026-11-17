"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Sparkles, X, ExternalLink, Ticket, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { useCopilotModels } from "@/hooks/useCopilotModels";
import JiraBoardBadge from "@/components/JiraBoardBadge";

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

interface StoryInputProps {
  onAnalyze: (text: string, model?: string, jiraKey?: string, jiraUrl?: string, epicKey?: string) => Promise<void>;
  isLoading: boolean;
  initialValue?: string;
  initialJiraKey?: string;
  /** Kept for API compatibility: the Jira mode always fetches and analyzes in one click. */
  autoAnalyzeOnJiraLoad?: boolean;
  onCancel?: () => void;
  onTextChange?: (t: string) => void;
}

type Mode = "jira" | "paste";

export default function StoryInput({
  onAnalyze,
  isLoading,
  initialValue = "",
  initialJiraKey,
  onCancel,
  onTextChange,
}: StoryInputProps) {
  const initialIsKey = JIRA_KEY_RE.test(initialValue.trim().toUpperCase());
  const [mode, setMode] = useState<Mode>(initialValue.trim() && !initialIsKey ? "paste" : "jira");
  const [jiraKey, setJiraKey] = useState(initialJiraKey ?? (initialIsKey ? initialValue.trim().toUpperCase() : ""));
  const [text, setText] = useState(initialIsKey ? "" : initialValue);
  const [fetchingJira, setFetchingJira] = useState(false);
  const [jiraError, setJiraError] = useState<string | null>(null);
  const [jiraPreview, setJiraPreview] = useState<
    { key: string; status: "found"; summary: string; browseUrl: string } | { key: string; status: "missing"; message: string } | null
  >(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { models, model, setModel, error: modelsError } = useCopilotModels();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(180, el.scrollHeight)}px`;
  }, [text, mode]);

  const key = jiraKey.trim().toUpperCase();
  const isValidKey = JIRA_KEY_RE.test(key);
  const busy = isLoading || fetchingJira;

  // Live preview (summary + link) once a valid key is typed
  useEffect(() => {
    if (mode !== "jira" || !isValidKey) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch(`/api/jira/preview?key=${encodeURIComponent(key)}`)
        .then(async r => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) as { summary?: string; browseUrl?: string; error?: string; issueType?: string } }))
        .then(({ ok, status, data }) => {
          if (cancelled) return;
          if (ok && /epic/i.test(data.issueType ?? "")) setJiraPreview({ key, status: "missing", message: `${key} is an Epic. Use the Epic Analyzer tab for epics.` });
          else if (ok && /bug|defect/i.test(data.issueType ?? "")) setJiraPreview({ key, status: "missing", message: `${key} is a ${data.issueType} card. Only stories can be analyzed.` });
          else if (ok) setJiraPreview({ key, status: "found", summary: data.summary || "(no title)", browseUrl: data.browseUrl ?? "" });
          else setJiraPreview({
            key,
            status: "missing",
            message: status === 404 ? `${key} doesn't exist, or you don't have access to it.`
              : status === 503 ? "Jira isn't configured on this server."
              : data.error ?? "Couldn't reach Jira.",
          });
        })
        .catch(() => { if (!cancelled) setJiraPreview({ key, status: "missing", message: "Couldn't reach Jira." }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [mode, isValidKey, key]);

  const preview = jiraPreview?.key === key && isValidKey ? jiraPreview : null;

  const handleKeyChange = (val: string) => {
    setJiraKey(val);
    setJiraError(null);
    onTextChange?.(val);
  };

  const handleTextChange = (val: string) => {
    setText(val);
    onTextChange?.(val);
  };

  const analyzeJira = async () => {
    if (!isValidKey || busy) return;
    setFetchingJira(true);
    setJiraError(null);
    try {
      const res = await fetch(`/api/jira/fetch?key=${encodeURIComponent(key)}`);
      const data = await res.json() as Record<string, string>;
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      if (/epic/i.test(data.issueType ?? "")) throw new Error(`${key} is an Epic. Use the Epic Analyzer tab for epics.`);
      const fetched = data.storyText ?? "";
      if (!fetched.trim()) throw new Error("This ticket has no description to analyze.");
      setFetchingJira(false);
      await onAnalyze(fetched, model, key, data.browseUrl, data.epicKey);
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : "Failed to fetch Jira issue");
    } finally {
      setFetchingJira(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "jira") void analyzeJira();
    else if (text.trim()) void onAnalyze(text, model);
  };

  const canSubmit = mode === "jira" ? isValidKey && preview?.status !== "missing" : !!text.trim();

  const modelPicker = models.length > 0 ? (
    <select
      value={model ?? ""}
      onChange={(e) => setModel(e.target.value)}
      disabled={busy}
      title="GitHub Copilot model"
      className="h-11 text-xs rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 px-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
    >
      {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select>
  ) : modelsError ? (
    <span className="text-xs text-amber-600 dark:text-amber-400 max-w-xs truncate" title={modelsError}>{modelsError}</span>
  ) : null;

  const submitButton = (
    <button
      type="submit"
      disabled={!canSubmit || busy}
      className="h-11 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-medium px-5 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95 text-sm flex-shrink-0"
    >
      {fetchingJira ? <><Loader2 className="w-4 h-4 animate-spin" />Loading ticket…</>
        : isLoading ? <><Loader2 className="w-4 h-4 animate-spin" />Analyzing…</>
        : <><Sparkles className="w-4 h-4" />Analyze</>}
    </button>
  );

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900/60 text-xs">
          {([["jira", "Jira ticket", Ticket], ["paste", "Paste text", FileText]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
                mode === m
                  ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm font-medium"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
      </div>

      {mode === "jira" ? (
        <>
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <div className="relative flex-1 min-w-[200px]">
              <Ticket className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                autoFocus
                value={jiraKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="Ticket key, e.g. LSINST-123"
                spellCheck={false}
                disabled={busy}
                className="w-full h-11 pl-10 pr-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 font-mono text-sm uppercase placeholder:normal-case placeholder:font-sans text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>
            {modelPicker}
            {submitButton}
          </div>

          {jiraError ? (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-3.5">
              <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700 dark:text-red-300">{jiraError}</p>
            </div>
          ) : preview?.status === "found" ? (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10 p-3.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">Ticket found</span>
                  {preview.browseUrl ? (
                    <a href={preview.browseUrl} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 font-mono font-semibold text-violet-600 dark:text-violet-300 hover:underline">
                      {key}<ExternalLink className="w-3 h-3" />
                    </a>
                  ) : <span className="font-mono font-semibold text-violet-600 dark:text-violet-300">{key}</span>}
                  <JiraBoardBadge jiraKey={key} />
                </div>
                <p className="mt-0.5 text-sm font-medium leading-snug text-slate-700 dark:text-slate-200">{preview.summary}</p>
              </div>
            </div>
          ) : preview?.status === "missing" ? (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-3.5">
              <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-200">{preview.message}</p>
            </div>
          ) : isValidKey ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-3.5 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Looking up <span className="font-mono">{key}</span> in Jira…
            </div>
          ) : (
            <p className="mt-2.5 text-xs text-slate-400 dark:text-slate-500">
              {jiraKey.trim() ? "Use the format PROJECT-123" : "The story and acceptance criteria are loaded from Jira. If its epic was analyzed in Epic Analyzer, that context is added too."}
            </p>
          )}
        </>
      ) : (
        <>
          <textarea
            ref={textareaRef}
            autoFocus
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder={"Paste the story, acceptance criteria or requirement text.\n\nAs a user, I want to… / Given… When… Then… / AC: …"}
            className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all leading-relaxed min-h-[180px]"
            style={{ overflow: "hidden" }}
            disabled={busy}
          />
          <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{text.trim() ? `${text.trim().split(/\s+/).length.toLocaleString()} words` : "No text yet"}</span>
              {text.trim() && !onCancel && (
                <button type="button" onClick={() => handleTextChange("")} className="flex items-center gap-1 hover:text-slate-600 dark:hover:text-slate-300">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {modelPicker}
              {submitButton}
            </div>
          </div>
        </>
      )}
    </form>
  );
}
