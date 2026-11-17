"use client";

import { BookOpen, FileText } from "lucide-react";

/** Shown while a story is analyzed with context from its parent epic: context "flows" from the epic into the story. */
export default function EpicContextFlow({ epicKey, epicSummary, storyKey }: { epicKey: string; epicSummary?: string; storyKey?: string }) {
  return (
    <div className="epic-flow-in relative overflow-hidden flex items-center gap-3 rounded-xl border border-violet-300/70 dark:border-violet-500/30 bg-gradient-to-r from-violet-50 via-white to-indigo-50 dark:from-violet-500/10 dark:via-slate-900 dark:to-indigo-500/10 px-4 py-2.5">
      <span className="epic-flow-shimmer pointer-events-none absolute inset-0" />

      <span className="relative flex items-center gap-1.5 flex-shrink-0 font-mono text-xs font-bold text-violet-700 dark:text-violet-200 bg-violet-100 dark:bg-violet-500/20 border border-violet-300 dark:border-violet-500/40 px-2 py-1 rounded-lg">
        <BookOpen className="w-3.5 h-3.5" /> {epicKey}
        <span className="epic-flow-ping absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500" />
      </span>

      <span className="relative flex-1 min-w-[60px] max-w-[160px] h-4 flex items-center" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-violet-400/60 to-indigo-400/60" />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="epic-flow-dot absolute top-1/2 w-1.5 h-1.5 -mt-[3px] rounded-full bg-violet-500 dark:bg-violet-300" style={{ animationDelay: `${i * 0.35}s` }} />
        ))}
      </span>

      <span className="relative flex items-center gap-1.5 flex-shrink-0 font-mono text-xs font-bold text-indigo-700 dark:text-indigo-200 bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-300 dark:border-indigo-500/40 px-2 py-1 rounded-lg epic-flow-receive">
        <FileText className="w-3.5 h-3.5" /> {storyKey ?? "Story"}
      </span>

      <span className="relative min-w-0 text-xs text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-violet-700 dark:text-violet-300">Using parent epic context</span>
        {epicSummary && <span className="hidden sm:inline text-slate-500 dark:text-slate-400"> · {epicSummary}</span>}
      </span>
    </div>
  );
}
