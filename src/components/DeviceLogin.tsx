"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import ErrorNotice from "@/components/ErrorNotice";

type Start = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number };

const GitHubMark = () => (
  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/** "Sign in with GitHub" via a one-time code: no app secret needed. */
export default function DeviceLogin({ redirectTo }: { redirectTo: string }) {
  const [start, setStart] = useState<Start | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; }, []);

  const begin = async () => {
    setBusy(true); setError(""); setCopied(false); stop.current = false;
    try {
      const res = await fetch("/api/login/device", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Couldn't start sign-in");
      const s = j as Start;
      setStart(s);
      try { await navigator.clipboard.writeText(s.userCode); setCopied(true); } catch { /* user can copy by hand */ }
      window.open(s.verificationUri, "_blank", "noopener");
      void poll(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start sign-in");
      setBusy(false);
    }
  };

  const poll = async (s: Start) => {
    let wait = s.interval;
    const until = Date.now() + s.expiresIn * 1000;
    while (!stop.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      if (stop.current) return;
      const r = await signIn("github-device", { deviceCode: s.deviceCode, redirect: false }).catch(() => null);
      if (r?.ok && !r.error) { window.location.href = redirectTo; return; }
      const code = r?.code ?? "pending";
      if (code === "slow_down") wait += 5;
      else if (code !== "pending") {
        setError(code === "denied" ? "Sign-in was cancelled on GitHub." : code === "expired" ? "The code expired. Try again." : "Sign-in failed. Try again.");
        setStart(null); setBusy(false);
        return;
      }
    }
    if (!stop.current) { setError("The code expired. Try again."); setStart(null); setBusy(false); }
  };

  const copy = async () => {
    if (!start) return;
    try { await navigator.clipboard.writeText(start.userCode); setCopied(true); } catch { /* ignore */ }
  };

  if (!start) {
    return (
      <div className="mt-6 space-y-3">
        <button
          onClick={begin}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitHubMark />}
          Sign in with GitHub
        </button>
        {error && <ErrorNotice message={error} size="sm" />}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4 text-left">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        A GitHub tab opened. Paste this code there{copied ? " (already copied)" : ""} and click <b>Authorize</b>:
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-center text-2xl font-mono font-bold tracking-[0.2em] py-3 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-white select-all">
          {start.userCode}
        </code>
        <button onClick={copy} title="Copy code" className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-500 hover:text-slate-800 dark:hover:text-white">
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <a href={start.verificationUri} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 text-sm text-violet-600 dark:text-violet-400 hover:underline">
        Open GitHub again <ExternalLink className="w-3.5 h-3.5" />
      </a>
      <p className="flex items-center justify-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for GitHub…
      </p>
    </div>
  );
}
