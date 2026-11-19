"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Loader2, Unplug } from "lucide-react";

type Status = { connected: boolean; site?: string; name?: string; error?: string };

const g = globalThis as typeof globalThis & { __jiraFetchHooked?: boolean };

/** Sidebar control: connect this user's Jira through Atlassian's sign-in, or show which site is connected. */
export default function JiraConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/atlassian/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<Status>)
      .then(setStatus, () => setStatus({ connected: false }));
  }, []);

  useEffect(() => {
    refresh();

    // Coming back from Atlassian's sign-in page
    const url = new URL(window.location.href);
    const result = url.searchParams.get("atlassian");
    if (result) {
      const reason = url.searchParams.get("reason");
      const text = result === "connected" ? { ok: true, text: "Jira connected" } : { ok: false, text: `Jira sign-in failed${reason ? `: ${reason}` : ""}` };
      queueMicrotask(() => setNote(text));
      url.searchParams.delete("atlassian");
      url.searchParams.delete("reason");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }

    // Any Jira call that says "connect first" flips this control back to "Connect Jira"
    const onNeeded = () => setStatus({ connected: false });
    window.addEventListener("atlassian:needed", onNeeded);
    if (!g.__jiraFetchHooked) {
      g.__jiraFetchHooked = true;
      const orig = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const res = await orig(...args);
        if (res.status === 401) {
          const u = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
          if (u.includes("/api/jira/")) {
            res.clone().json().then((j: { needsAtlassian?: boolean }) => {
              if (j?.needsAtlassian) window.dispatchEvent(new Event("atlassian:needed"));
            }).catch(() => {});
          }
        }
        return res;
      };
    }
    return () => window.removeEventListener("atlassian:needed", onNeeded);
  }, [refresh]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);

  const connect = () => {
    const back = window.location.pathname + window.location.search;
    window.location.href = `/api/atlassian/connect?returnTo=${encodeURIComponent(back)}`;
  };
  const disconnect = async () => {
    if (!confirm("Disconnect Jira? You can connect again at any time.")) return;
    await fetch("/api/atlassian/status", { method: "DELETE" }).catch(() => {});
    setStatus({ connected: false });
  };

  const host = status?.site?.replace(/^https?:\/\//, "");

  return (
    <div className="mb-2">
      {note && (
        <div className={`mb-2 px-2.5 py-1.5 rounded-lg text-[11px] ${note.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}>{note.text}</div>
      )}
      {status === null ? (
        <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking Jira…</div>
      ) : status.connected ? (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.03]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[11px] font-medium text-slate-200">Jira connected</div>
            <div className="text-[10px] text-slate-500 truncate" title={status.site}>{host}</div>
          </div>
          <button onClick={disconnect} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/10 transition-colors" title="Disconnect Jira">
            <Unplug className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={connect}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          title="Sign in with your Atlassian account so the app can read stories and file bugs"
        >
          <Link2 className="w-3.5 h-3.5" /> Connect Jira
        </button>
      )}
    </div>
  );
}
