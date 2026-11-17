"use client";

import { useEffect, useState } from "react";
import type { IssueReport, ObservationState } from "@/types";
import { buildObservationUpdateAdf, OBS_STATE } from "@/lib/bug-report";
import { Bug, Pencil, Search, ExternalLink, Trash2, RefreshCw, Loader2, Check, X, Wrench, ChevronRight } from "lucide-react";

type Live = Record<string, { status: string; category: string; summary: string }>;

const CATEGORY_STYLE: Record<string, string> = {
  new: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  indeterminate: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const STATE_STYLE: Record<ObservationState, string> = {
  "open": "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "fixed": "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "retest-passed": "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "retest-failed": "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300",
};
/** What the tester can do next for each observation state. */
const NEXT: Record<ObservationState, { state: ObservationState; label: string; icon: typeof Check; cls: string }[]> = {
  "open": [{ state: "fixed", label: "Dev fixed it", icon: Wrench, cls: "text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10" }],
  "fixed": [
    { state: "retest-passed", label: "Retest passed", icon: Check, cls: "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10" },
    { state: "retest-failed", label: "Still failing", icon: X, cls: "text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10" },
  ],
  "retest-failed": [{ state: "fixed", label: "Dev fixed it again", icon: Wrench, cls: "text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10" }],
  "retest-passed": [],
};

export default function ReportsPanel({ reports, environment, onChange, onEdit, onRefresh }: {
  reports: IssueReport[];
  environment?: string;
  onChange: (r: IssueReport[]) => void;
  onEdit?: (r: IssueReport) => void;
  onRefresh?: (r: IssueReport) => Promise<string>;
}) {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const refresh = async (r: IssueReport) => {
    if (!onRefresh) return;
    setSyncing(r.id);
    try { const text = await onRefresh(r); setSyncMsg((m) => ({ ...m, [r.id]: { ok: true, text } })); }
    catch (e) { setSyncMsg((m) => ({ ...m, [r.id]: { ok: false, text: `Couldn't load ${r.key} from Jira${e instanceof Error ? `: ${e.message}` : ""}` } })); }
    finally { setSyncing(null); }
  };
  const [live, setLive] = useState<Live>({});
  const [action, setAction] = useState<{ id: string; state: ObservationState } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState(false);

  const bugKeys = reports.filter((r) => r.kind === "bug" && r.key).map((r) => r.key!).join(",");
  useEffect(() => {
    if (!bugKeys) return;
    let alive = true;
    fetch(`/api/jira/issue?keys=${bugKeys}`)
      .then((r) => (r.ok ? r.json() : { issues: [] }))
      .then((d: { issues: { key: string; summary: string; status: string; category: string }[] }) => {
        if (alive) { setLive(Object.fromEntries(d.issues.map((i) => [i.key, { status: i.status, category: i.category, summary: i.summary }]))); setChecked(true); }
      })
      .catch(() => { /* status is optional */ });
    return () => { alive = false; };
  }, [bugKeys]);

  const post = async (r: IssueReport, state: ObservationState) => {
    if (!r.key) return;
    setBusy(r.id);
    setError((e) => ({ ...e, [r.id]: "" }));
    try {
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: r.key, adf: buildObservationUpdateAdf(r, state, { environment, note }) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to post");
      const at = new Date().toISOString();
      onChange(reports.map((x) => x.id === r.id ? { ...x, state, history: [...(x.history ?? []), { at, state, environment, note: note.trim() || undefined }] } : x));
      setAction(null); setNote("");
    } catch (e) {
      setError((x) => ({ ...x, [r.id]: e instanceof Error ? e.message : "Failed to post" }));
    } finally {
      setBusy(null);
    }
  };

  if (!reports.length) return null;
  const needle = q.trim().toLowerCase();
  const shown = needle ? reports.filter((r) => [r.key, r.title, r.testCaseId, r.key ? live[r.key]?.status : ""].some((v) => v?.toLowerCase().includes(needle))) : reports;
  const bugs = reports.filter((r) => r.kind === "bug").length;
  const openObs = reports.filter((r) => r.kind === "observation" && r.state !== "retest-passed").length;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button onClick={() => setCollapsed((c) => !c)} className="w-full flex items-center gap-2 px-5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
        <ChevronRight className={`w-4 h-4 text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`} />
        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">Bugs & observations</span>
        <span className="text-xs text-slate-500">
          {bugs > 0 && <>{bugs} bug{bugs > 1 ? "s" : ""}</>}{bugs > 0 && reports.length > bugs ? " · " : ""}
          {reports.length > bugs && <>{openObs} open observation{openObs === 1 ? "" : "s"}</>}
        </span>
      </button>
      {!collapsed && reports.length > 5 && (
        <div className="px-5 py-2 border-t border-slate-100 dark:border-slate-700/60 relative">
          <Search className="w-3.5 h-3.5 absolute left-7 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ticket, title or status" className="w-full text-xs pl-7 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>
      )}
      {!collapsed && (
        <ul className="max-h-[55vh] overflow-y-auto nice-scroll divide-y divide-slate-100 dark:divide-slate-700/60 border-t border-slate-100 dark:border-slate-700/60">
          {shown.map((r) => {
            const isBug = r.kind === "bug";
            const l = r.key ? live[r.key] : undefined;
            return (
              <li key={r.id} className="group px-5 py-2">
                <div className="flex items-center gap-2.5">
                  {isBug ? <Bug className="w-4 h-4 flex-shrink-0 text-indigo-500" /> : <Search className="w-4 h-4 flex-shrink-0 text-sky-500" />}
                  {isBug
                    ? <a href={r.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-bold text-blue-600 hover:underline flex-shrink-0">{r.key}</a>
                    : <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-sky-700 dark:text-sky-300 hover:underline flex-shrink-0">#{r.number}</a>}
                  {r.testCaseId && <span className="flex-shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">{r.testCaseId}</span>}
                  <span className="flex-1 min-w-0 truncate text-sm text-slate-700 dark:text-slate-200" title={r.title}>{l?.summary || r.title}</span>
                  {isBug
                    ? l ? <span className={`flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${CATEGORY_STYLE[l.category] ?? CATEGORY_STYLE.new}`}>{l.status}</span> : checked && r.key && <span title="Jira no longer returns this ticket (deleted, moved or no access)" className="flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300">Not in Jira</span>
                    : r.state && <span className={`flex-shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${STATE_STYLE[r.state]}`}>{OBS_STATE[r.state].label}</span>}
                  {!isBug && r.state && NEXT[r.state].map((n) => (
                    <button key={n.state} onClick={() => { setAction(action?.id === r.id && action.state === n.state ? null : { id: r.id, state: n.state }); setNote(""); }}
                      className={`flex-shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md ${n.cls}`}>
                      <n.icon className="w-3 h-3" /> {n.label}
                    </button>
                  ))}
                  {isBug && r.snapshot && onEdit && (
                    <button onClick={() => onEdit(r)} title="Edit this bug card" className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-indigo-600"><Pencil className="w-3.5 h-3.5" /></button>
                  )}
                  {isBug && onRefresh && r.key && (
                    <button onClick={() => refresh(r)} disabled={syncing === r.id} title="Update from Jira (pull the latest title and text)" className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-emerald-600 disabled:opacity-50">
                      {syncing === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    </button>
                  )}
                  <a href={r.url} target="_blank" rel="noreferrer" title="Open in Jira" className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-blue-600"><ExternalLink className="w-3.5 h-3.5" /></a>
                  <button onClick={() => onChange(reports.filter((x) => x.id !== r.id))} title="Remove from this list (nothing changes in Jira)"
                    className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-slate-300 opacity-0 group-hover:opacity-100 hover:text-rose-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {action?.id === r.id && (
                  <div className="mt-2 ml-6 flex items-center gap-2 animate-section-in">
                    <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") post(r, action.state); }}
                      placeholder={action.state === "retest-failed" ? "What still fails? (optional)" : action.state === "fixed" ? "Fix version / build (optional)" : "Note (optional)"}
                      className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">posts a comment on {r.key}{environment ? ` · ${environment}` : ""}</span>
                    <button disabled={busy === r.id} onClick={() => post(r, action.state)} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                      {busy === r.id && <Loader2 className="w-3 h-3 animate-spin" />} Post
                    </button>
                    <button onClick={() => setAction(null)} className="text-xs px-2 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
                  </div>
                )}
                {syncMsg[r.id] && <p className={`mt-1 ml-6 text-xs ${syncMsg[r.id].ok ? "text-emerald-600" : "text-rose-600"}`}>{syncMsg[r.id].text}</p>}
                {error[r.id] && <p className="mt-1 ml-6 text-xs text-rose-600">{error[r.id]}</p>}
              </li>
            );
          })}
        {shown.length === 0 && <li className="px-5 py-4 text-xs text-slate-400">Nothing matches “{q}”.</li>}
        </ul>
      )}
    </div>
  );
}
