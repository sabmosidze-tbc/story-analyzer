"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Sparkles, X, Hash, Download, ExternalLink } from "lucide-react";
import { useCopilotModels } from "@/hooks/useCopilotModels";
import JiraBoardBadge from "@/components/JiraBoardBadge";

const JIRA_KEY_RE = /^[A-Z]{2,10}-\d+$/;

interface StoryInputProps {
  onAnalyze: (text: string, model?: string, jiraKey?: string, jiraUrl?: string) => Promise<void>;
  isLoading: boolean;
  initialValue?: string;
  initialJiraKey?: string;
  autoAnalyzeOnJiraLoad?: boolean;
  onCancel?: () => void;
  onTextChange?: (t: string) => void;
}

export default function StoryInput({
  onAnalyze,
  isLoading,
  initialValue = "",
  initialJiraKey,
  autoAnalyzeOnJiraLoad = false,
  onCancel,
  onTextChange,
}: StoryInputProps) {
  const [text, setText]               = useState(initialValue);
  const [fetchingJira, setFetchingJira] = useState(false);
  const [jiraError, setJiraError]     = useState<string | null>(null);
  const [jiraPreview, setJiraPreview] = useState<{ summary: string; browseUrl: string } | null>(null);
  const textareaRef                   = useRef<HTMLTextAreaElement>(null);
  const autoFetched                   = useRef(false);
  const { models, model, setModel, error: modelsError } = useCopilotModels();

  useEffect(() => { setText(initialValue); }, [initialValue]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(200, el.scrollHeight)}px`;
  }, [text]);

  useEffect(() => {
    if (initialJiraKey && !autoFetched.current) {
      autoFetched.current = true;
      handleFetchJira(initialJiraKey);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJiraKey]);

  const trimmed   = text.trim();
  const isJiraKey = JIRA_KEY_RE.test(trimmed.toUpperCase());

  // Fetch preview (summary + link) whenever a valid Jira key is detected
  useEffect(() => {
    if (!isJiraKey) { setJiraPreview(null); return; }
    let cancelled = false;
    const key = trimmed.toUpperCase();
    fetch(`/api/jira/preview?key=${encodeURIComponent(key)}`)
      .then(r => r.json())
      .then((data: { summary?: string; browseUrl?: string }) => {
        if (!cancelled && data.summary) setJiraPreview({ summary: data.summary, browseUrl: data.browseUrl ?? "" });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJiraKey, trimmed]);

  const handleTextChange = (val: string) => {
    setText(val);
    onTextChange?.(val);
    setJiraError(null);
  };

  const handleFetchJira = async (key: string) => {
    const k = key.trim().toUpperCase();
    setFetchingJira(true);
    setJiraError(null);
    try {
      const res  = await fetch(`/api/jira/fetch?key=${encodeURIComponent(k)}`);
      const data = await res.json() as Record<string, string>;
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      const fetched = data.storyText ?? "";
      handleTextChange(fetched);
      if (autoAnalyzeOnJiraLoad && fetched) {
        await onAnalyze(fetched, model, k, data.browseUrl);
      }
    } catch (err) {
      setJiraError(err instanceof Error ? err.message : "Failed to fetch Jira issue");
    } finally {
      setFetchingJira(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (trimmed && !isLoading) {
      onAnalyze(text, model, isJiraKey ? trimmed.toUpperCase() : undefined);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
      <div className="flex items-center justify-between mb-3">
        <label htmlFor="story-textarea" className="text-sm font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
          Paste your story / requirement
        </label>
        <div className="flex items-center gap-2">
          {trimmed.length > 0 && !onCancel && (
            <button type="button" onClick={() => handleTextChange("")}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
          {onCancel && (
            <button type="button" onClick={onCancel}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Jira detection banner — shown ABOVE textarea */}
      {isJiraKey && (
        <div className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/60">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">Jira issue detected</span>
            {jiraPreview?.browseUrl ? (
              <a
                href={jiraPreview.browseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono font-semibold text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-600 px-2 py-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800/60 transition-colors flex-shrink-0"
              >
                {trimmed.toUpperCase()}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <span className="font-mono font-semibold text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-600 px-2 py-0.5 rounded-full flex-shrink-0">
                {trimmed.toUpperCase()}
              </span>
            )}
            {jiraPreview && <JiraBoardBadge jiraKey={trimmed.toUpperCase()} />}
            {jiraPreview?.summary && (
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{jiraPreview.summary}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => handleFetchJira(trimmed)}
            disabled={fetchingJira || isLoading}
            className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0 shadow-sm"
          >
            {fetchingJira ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {fetchingJira ? "Loading…" : "Load story"}
          </button>
        </div>
      )}

      <textarea
        id="story-textarea"
        ref={textareaRef}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={"As a user, I want to… / Given… When… Then… / AC: …\n\nPaste your full Jira story, acceptance criteria, or requirement text here.\nOr type a Jira key (e.g. ABC-123) and click Fetch."}
        className="w-full resize-none rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 p-4 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all leading-relaxed min-h-[200px]"
        style={{ overflow: "hidden" }}
        disabled={isLoading || fetchingJira}
      />

      {jiraError && (
        <p className="mt-2 text-xs text-red-500 dark:text-red-400">{jiraError}</p>
      )}

      <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Hash className="w-3.5 h-3.5" />
          <span>{text.length.toLocaleString()} chars</span>
          {trimmed.length > 0 && (
            <>
              <span className="mx-1">·</span>
              <span>{trimmed.split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {models.length > 0 ? (
            <select
              value={model ?? ""}
              onChange={(e) => setModel(e.target.value)}
              disabled={isLoading || fetchingJira}
              title="GitHub Copilot model"
              className="text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          ) : modelsError ? (
            <span className="text-xs text-amber-600 dark:text-amber-400 max-w-xs truncate" title={modelsError}>{modelsError}</span>
          ) : null}
          <button
            type="submit"
            disabled={!trimmed || isLoading || fetchingJira}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 dark:disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95 text-sm"
          >
            {isLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />Analyzing…</>
            ) : (
              <><Sparkles className="w-4 h-4" />Analyze Story</>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
