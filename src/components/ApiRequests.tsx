"use client";

import { useState } from "react";
import type { ApiRequest } from "@/types";
import { formatPayload } from "@/lib/jira-results";
import { Pencil, Copy, CheckCheck, Trash2, ChevronRight, Code2 } from "lucide-react";

// ── API requests a tester sent (optional, per test case, each tied to a step) ─

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const METHOD_COLOR: Record<string, string> = {
  GET: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  POST: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  PUT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  PATCH: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  DELETE: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
};

export function ApiRequestEditor({ value, steps, defaultStep, fixedStep, onSave, onRemove, onCancel }: {
  value?: ApiRequest; steps: string[]; defaultStep?: number;
  fixedStep?: boolean;  // opened from a step, so the step is already known
  onSave: (v: ApiRequest) => void; onRemove?: () => void; onCancel: () => void;
}) {
  const [step, setStep] = useState<number>(value ? (value.step ?? 0) : (defaultStep ?? 0));
  const [method, setMethod] = useState(value?.method ?? "POST");
  const [url, setUrl] = useState(value?.url ?? "");
  const [body, setBody] = useState(value?.body ?? "");
  const parsed = formatPayload(body);
  const badJson = /^\s*[{[]/.test(body) && !parsed.json;
  const empty = !url.trim() && !body.trim();

  return (
    <div className="rounded-xl border border-sky-200 dark:border-sky-500/30 bg-white dark:bg-slate-900 p-3 space-y-2">
      {!fixedStep && steps.length > 0 && <label className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-16 flex-shrink-0">Sent in</span>
        <select
          value={step}
          onChange={e => setStep(Number(e.target.value))}
          className="flex-1 min-w-0 h-8 px-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        >
          {steps.map((s, i) => <option key={i} value={i + 1}>Step {i + 1} · {s.length > 90 ? `${s.slice(0, 90)}…` : s}</option>)}
          <option value={0}>Not a specific step</option>
        </select>
      </label>}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-16 flex-shrink-0">Request</span>
        <select value={method} onChange={e => setMethod(e.target.value)} className="h-8 px-2 text-xs font-mono font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none">
          {METHODS.map(m => <option key={m}>{m}</option>)}
        </select>
        <input
          autoFocus
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Endpoint, e.g. /api/loans/12345/interest-rate"
          className="flex-1 min-w-0 h-8 px-2.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        />
      </div>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder={"Payload (optional) — paste JSON, it gets formatted automatically\n{ \"rate\": 10 }"}
        rows={Math.min(14, Math.max(4, body.split("\n").length + 1))}
        spellCheck={false}
        className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${badJson ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
          {badJson ? "Not valid JSON, so it will be saved as plain text." : parsed.json ? "Valid JSON ✓" : "Shown as code in Excel and Jira."}
        </span>
        <div className="flex items-center gap-1.5">
          {parsed.json && <button onClick={() => setBody(parsed.text)} className="text-xs px-2.5 py-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Format</button>}
          {onRemove && <button onClick={onRemove} className="text-xs px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">Remove</button>}
          <button onClick={onCancel} className="text-xs px-2.5 py-1 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          <button
            disabled={empty}
            onClick={() => onSave({ method, url: url.trim(), body: parsed.text || undefined, step: step || undefined })}
            className="text-xs px-3 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function ApiRequestList({ value, steps, onChange }: { value: ApiRequest[]; steps: string[]; onChange: (v: ApiRequest[]) => void }) {
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const ordered = value.map((a, i) => ({ a, i })).sort((x, y) => (x.a.step ?? 999) - (y.a.step ?? 999));
  // Suggest the first step that has no request yet
  const nextStep = steps.findIndex((_, i) => !value.some(a => a.step === i + 1)) + 1 || undefined;

  return (
    <div className="mt-3 space-y-2">
      {ordered.map(({ a, i }) => editing === i ? (
        <ApiRequestEditor
          key={i}
          value={a}
          steps={steps}
          onCancel={() => setEditing(null)}
          onRemove={() => { onChange(value.filter((_, j) => j !== i)); setEditing(null); }}
          onSave={v => { onChange(value.map((x, j) => j === i ? v : x)); setEditing(null); }}
        />
      ) : (
        <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
            <span
              title={a.step ? steps[a.step - 1] : "Not tied to a specific step"}
              className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${a.step ? "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-slate-200 dark:bg-slate-700 text-slate-500"}`}
            >
              {a.step ? `Step ${a.step}` : "Any step"}
            </span>
            <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLOR[a.method.toUpperCase()] ?? "bg-slate-100 text-slate-700"}`}>{a.method.toUpperCase()}</span>
            <span className="flex-1 min-w-0 truncate font-mono text-xs text-slate-700 dark:text-slate-200" title={a.url}>{a.url || "—"}</span>
            <button onClick={() => setEditing(i)} title="Edit request" className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-sky-600 hover:bg-white dark:hover:bg-slate-700"><Pencil className="w-3 h-3" /></button>
          </div>
          {a.step && steps[a.step - 1] && (
            <p className="px-3 py-1 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 truncate">↳ {steps[a.step - 1]}</p>
          )}
          {a.body && (
            <pre className="max-h-64 overflow-auto px-3 py-2 text-[11px] leading-relaxed font-mono bg-slate-950 text-slate-100">{formatPayload(a.body).text}</pre>
          )}
        </div>
      ))}

      {editing === "new" ? (
        <ApiRequestEditor
          steps={steps}
          defaultStep={nextStep}
          onCancel={() => setEditing(null)}
          onSave={v => { onChange([...value, v]); setEditing(null); }}
        />
      ) : (
        <button onClick={() => setEditing("new")} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-sky-600 hover:border-sky-400 transition-colors">
          <Code2 className="w-3.5 h-3.5" /> {value.length ? "Add another request" : "Add API request"} <span className="text-slate-400">(endpoint + payload, linked to a step)</span>
        </button>
      )}
    </div>
  );
}

/** Small "POST /v1/eod" chip next to a step; click to open the payload. */
export function RequestChip({ api, open, onClick }: { api: ApiRequest; open: boolean; onClick: () => void }) {
  const m = api.method.toUpperCase();
  return (
    <button
      onClick={onClick}
      title={open ? "Hide request" : "Show request details"}
      className={`inline-flex items-center gap-1.5 h-6 pl-1 pr-1.5 rounded-md border text-[11px] font-mono transition-colors ${open
        ? "border-sky-400 dark:border-sky-500/60 bg-sky-50 dark:bg-sky-500/10"
        : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:border-sky-300 dark:hover:border-sky-500/40"}`}
    >
      <span className={`text-[9px] font-bold px-1 py-px rounded ${METHOD_COLOR[m] ?? "bg-slate-100 text-slate-700"}`}>{m}</span>
      <span className="max-w-[260px] truncate text-slate-700 dark:text-slate-200">{api.url || "—"}</span>
      <ChevronRight className={`w-3 h-3 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
    </button>
  );
}

/** Opened request: full endpoint + formatted payload, with copy / edit / remove. */
export function RequestDetails({ api, onEdit, onRemove }: { api: ApiRequest; onEdit?: () => void; onRemove?: () => void }) {
  const [copied, setCopied] = useState(false);
  const m = api.method.toUpperCase();
  const body = formatPayload(api.body ?? "").text;
  const copy = async () => {
    await navigator.clipboard.writeText(body ? `${m} ${api.url}\n\n${body}` : `${m} ${api.url}`);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="mt-1.5 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden animate-section-in">
      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-100/80 dark:bg-slate-800">
        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${METHOD_COLOR[m] ?? "bg-slate-100 text-slate-700"}`}>{m}</span>
        <span className="flex-1 min-w-0 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{api.url || "—"}</span>
        <button onClick={copy} title="Copy request" className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 hover:bg-white dark:hover:bg-slate-700">
          {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? "Copied" : "Copy"}
        </button>
        {onEdit && <button onClick={onEdit} title="Edit request" className="h-6 px-1.5 rounded-md flex items-center gap-1 text-[11px] text-slate-500 hover:text-sky-600 hover:bg-white dark:hover:bg-slate-700"><Pencil className="w-3 h-3" />Edit</button>}
        {onRemove && <button onClick={onRemove} title="Remove request" className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-white dark:hover:bg-slate-700"><Trash2 className="w-3 h-3" /></button>}
      </div>
      {body
        ? <pre className="max-h-72 overflow-auto px-3 py-2 text-[11px] leading-relaxed font-mono bg-slate-950 text-slate-100">{body}</pre>
        : <p className="px-3 py-2 text-[11px] italic text-slate-400 bg-white dark:bg-slate-900">No payload</p>}
    </div>
  );
}

