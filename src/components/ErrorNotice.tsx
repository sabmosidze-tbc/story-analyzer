"use client";

import { AlertCircle, Link2 } from "lucide-react";

/** Errors that just mean "the user hasn't connected Jira yet". */
export const isJiraNotConnected = (msg?: string | null) => !!msg && /connect jira/i.test(msg);

const connectJira = () => {
  const back = window.location.pathname + window.location.search;
  window.location.href = `/api/atlassian/connect?returnTo=${encodeURIComponent(back)}`;
};

const clean = (msg: string) => msg.replace(/^error:\s*/i, "").trim();

/**
 * Calm error message. "Connect Jira first" errors become a small prompt with a Connect button.
 * `size="sm"` is a one-line inline variant for footers and under fields.
 */
export default function ErrorNotice({ message, size = "md", className = "" }: { message?: string | null; size?: "sm" | "md"; className?: string }) {
  if (!message) return null;
  const jira = isJiraNotConnected(message);

  if (size === "sm") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-500/10 ring-1 ring-rose-200 dark:ring-rose-500/25 text-rose-700 dark:text-rose-300 ${className}`}>
        {jira ? <Link2 className="w-3.5 h-3.5 flex-shrink-0 text-rose-500 dark:text-rose-400" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-rose-500 dark:text-rose-400" />}
        {jira ? (
          <span>Jira isn&apos;t connected. <button type="button" onClick={connectJira} className="font-semibold underline underline-offset-2 decoration-rose-400/60 hover:text-rose-900 dark:hover:text-rose-100">Connect Jira</button></span>
        ) : <span className="min-w-0">{clean(message)}</span>}
      </span>
    );
  }

  if (jira) {
    return (
      <div role="alert" className={`flex items-center gap-3 rounded-xl border border-rose-200 dark:border-rose-500/25 bg-rose-50/80 dark:bg-rose-500/[0.08] px-4 py-3 shadow-sm ${className}`}>
        <span className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center flex-shrink-0">
          <Link2 className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-rose-800 dark:text-rose-200">Jira isn&apos;t connected</p>
          <p className="text-xs text-rose-700/80 dark:text-rose-300/70">Connect your Jira account to load stories and file bugs.</p>
        </div>
        <button type="button" onClick={connectJira} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors">
          Connect Jira
        </button>
      </div>
    );
  }

  return (
    <div role="alert" className={`flex items-start gap-3 rounded-xl border border-rose-200 dark:border-rose-500/25 bg-rose-50/80 dark:bg-rose-500/[0.08] px-4 py-3 shadow-sm ${className}`}>
      <span className="w-8 h-8 rounded-full bg-rose-100 dark:bg-rose-500/15 flex items-center justify-center flex-shrink-0">
        <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
      </span>
      <p className="flex-1 min-w-0 self-center text-sm text-rose-800 dark:text-rose-200 break-words">{clean(message)}</p>
    </div>
  );
}
