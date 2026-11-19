"use client";
/* eslint-disable @next/next/no-img-element -- previews of local files (blob: URLs) */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiRequest, IssueReport } from "@/types";
import type { BugMeta } from "@/app/api/jira/bug-meta/route";
import { loadBug } from "@/lib/bug-import";
import { buildBugAdf, buildObservationAdf, findingsOf, withFindings, newFinding, MAIN_FINDING, expGroup, baseGroup, type Finding, type ReportDraft } from "@/lib/bug-report";
import { loadEnvs, saveEnvs } from "@/lib/environments";
import { ApiRequestEditor, RequestChip, RequestDetails } from "./ApiRequests";
import ErrorNotice from "@/components/ErrorNotice";
import {
  X, Bug, Search, Loader2, Plus, Trash2, Sparkles, Undo2, Upload, Film, FileText,
  ImageIcon, ExternalLink, RotateCw, Check, Code2, ChevronDown,   Link2, Paperclip, Pencil, Download,
} from "lucide-react";

const MAX_FILE = 250 * 1024 * 1024;
const PREFS_KEY = "story-analyzer:bug-defaults";

type Kind = "bug" | "observation";
type Upload = {
  id: string;
  file: File;
  name: string;
  preview?: string;
  status: "ready" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
  url?: string;
  attId?: string;
  mediaId?: string;
  group: string;
};
type Att = { name: string; url?: string; id?: string; group?: string; mediaId?: string; image?: boolean };
function imagesFrom(cd: DataTransfer | null): File[] {
  if (!cd) return [];
  const out: File[] = [];
  for (const it of Array.from(cd.items ?? [])) {
    if (it.kind === "file") { const f = it.getAsFile(); if (f) out.push(f); }
  }
  return out.length ? out : Array.from(cd.files ?? []);
}
type Prefs = { project?: string; startIn?: "backlog" | "todo"; byProject?: Record<string, { boardId?: number; priorityId?: string; componentIds?: string[]; labels?: string }> };

const loadPrefs = (): Prefs => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs; } catch { return {}; } };
const META_KEY = "story-analyzer:bug-meta:";
const readMetaCache = (project: string): BugMeta | null => {
  try {
    const c = JSON.parse(localStorage.getItem(META_KEY + project) ?? "null") as { at: number; meta: BugMeta } | null;
    return c && Date.now() - c.at < 24 * 3600 * 1000 ? c.meta : null;
  } catch { return null; }
};
const writeMetaCache = (project: string, meta: BugMeta) => { try { localStorage.setItem(META_KEY + project, JSON.stringify({ at: Date.now(), meta })); } catch { /* ignore */ } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } };

const fmtSize = (n: number) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const splitName = (n: string) => { const i = n.lastIndexOf("."); return i > 0 ? [n.slice(0, i), n.slice(i)] : [n, ""]; };
const kindOf = (f: File) => f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : "file";

/** Upload one file to a Jira issue, reporting progress; resolves only when Jira confirms the full size. */
function uploadToJira(key: string, u: Upload, onProgress: (p: number) => void): Promise<{ url?: string; filename?: string; id?: string; mediaId?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/jira/attachment");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(0.99, e.loaded / e.total)); };
    xhr.onload = () => {
      let data: { error?: string; url?: string; filename?: string; size?: number; id?: string; mediaId?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.size === u.file.size) resolve(data);
      else reject(new Error(data.error ?? (xhr.status === 200 ? "Size check failed" : `Upload failed (${xhr.status})`)));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    const fd = new FormData();
    fd.append("key", key);
    fd.append("size", String(u.file.size));
    fd.append("file", u.file, u.name);
    xhr.send(fd);
  });
}

// ── Small building blocks ────────────────────────────────────────────────────

const box = "w-full text-[13px] text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400";

function Section({ title, hint, children, right }: { title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {title}{hint && <span className="ml-2 normal-case tracking-normal font-normal text-slate-400">{hint}</span>}
        </h4>
        {right}
      </div>
      {children}
    </section>
  );
}

function AutoText({ value, onChange, placeholder, minRows = 2, className = "" }: { value: string; onChange: (v: string) => void; placeholder?: string; minRows?: number; className?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={Math.min(12, Math.max(minRows, value.split("\n").length))}
      className={`${box} resize-y ${className}`}
    />
  );
}

function ProjectPicker({ value, name, onPick }: { value: string; name?: string; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<{ key: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/jira/projects?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        const d = (await r.json()) as { projects?: { key: string; name: string }[] };
        setList(d.projects ?? []);
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 250);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q, open]);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`${box} flex items-center gap-2 text-left`}>
        <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{value || "—"}</span>
        <span className="flex-1 truncate">{name ?? "Choose a project"}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 border-b border-slate-100 dark:border-slate-800">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" className="flex-1 py-2 text-[13px] bg-transparent focus:outline-none text-slate-800 dark:text-slate-100" />
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          <div className="max-h-56 overflow-y-auto nice-scroll py-1">
            {list.map((p) => (
              <button key={p.key} onClick={() => { onPick(p.key); setOpen(false); }} className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800 ${p.key === value ? "bg-indigo-50 dark:bg-indigo-500/10" : ""}`}>
                <span className="font-mono text-[11px] font-bold w-20 text-slate-500">{p.key}</span>
                <span className="truncate text-slate-700 dark:text-slate-200">{p.name}</span>
              </button>
            ))}
            {!loading && !list.length && <p className="px-3 py-3 text-xs text-slate-400">No projects found</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function StepsEditor({ steps, apis, onChange }: { steps: string[]; apis: ApiRequest[]; onChange: (steps: string[], apis: ApiRequest[]) => void }) {
  const [openApi, setOpenApi] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ step: number; index?: number } | null>(null);
  const refs = useRef<(HTMLTextAreaElement | null)[]>([]);

  const setStep = (i: number, v: string) => onChange(steps.map((s, j) => (j === i ? v : s)), apis);
  const addStep = (after = steps.length - 1) => {
    onChange([...steps.slice(0, after + 1), "", ...steps.slice(after + 1)], apis.map((a) => (a.step && a.step > after + 1 ? { ...a, step: a.step + 1 } : a)));
    setTimeout(() => refs.current[after + 1]?.focus(), 0);
  };
  const removeStep = (i: number) => {
    const next = steps.filter((_, j) => j !== i);
    onChange(next.length ? next : [""], apis.filter((a) => a.step !== i + 1).map((a) => (a.step && a.step > i + 1 ? { ...a, step: a.step - 1 } : a)));
  };

  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const mine = apis.map((a, idx) => ({ a, idx })).filter(({ a }) => a.step === i + 1);
        return (
          <li key={i} className="group/step">
            <div className="flex items-start gap-2">
              <span className={`mt-1.5 w-5 h-5 flex-shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${mine.length ? "bg-sky-600 text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"}`}>{i + 1}</span>
              <textarea
                ref={(el) => { refs.current[i] = el; }}
                value={s}
                rows={1}
                onChange={(e) => setStep(i, e.target.value.replace(/\n/g, " "))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStep(i); } if (e.key === "Backspace" && !s && steps.length > 1) { e.preventDefault(); removeStep(i); setTimeout(() => refs.current[Math.max(0, i - 1)]?.focus(), 0); } }}
                placeholder={i === 0 ? "What did you do first? (Enter = next step)" : "Next step…"}
                className={`${box} flex-1 resize-none [field-sizing:content]`}
              />
              <button onClick={() => setEditing({ step: i + 1 })} title="Attach an API request to this step" className="mt-1 h-7 px-2 rounded-lg flex items-center gap-1 text-[11px] text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-500/10 opacity-0 group-hover/step:opacity-100 focus:opacity-100">
                <Code2 className="w-3.5 h-3.5" /> API
              </button>
              <button onClick={() => removeStep(i)} title="Remove step" className="mt-1 w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 opacity-0 group-hover/step:opacity-100">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {(mine.length > 0 || editing?.step === i + 1) && (
              <div className="ml-7 mt-1.5 space-y-1.5">
                {mine.map(({ a, idx }) => editing?.index === idx ? (
                  <ApiRequestEditor key={idx} value={a} steps={steps} fixedStep onCancel={() => setEditing(null)}
                    onRemove={() => { onChange(steps, apis.filter((_, j) => j !== idx)); setEditing(null); }}
                    onSave={(v) => { onChange(steps, apis.map((x, j) => (j === idx ? { ...v, step: i + 1 } : x))); setEditing(null); }} />
                ) : (
                  <div key={idx}>
                    <RequestChip api={a} open={openApi === `${idx}`} onClick={() => setOpenApi(openApi === `${idx}` ? null : `${idx}`)} />
                    {openApi === `${idx}` && <RequestDetails api={a} onEdit={() => setEditing({ step: i + 1, index: idx })} onRemove={() => onChange(steps, apis.filter((_, j) => j !== idx))} />}
                  </div>
                ))}
                {editing?.step === i + 1 && editing.index === undefined && (
                  <ApiRequestEditor steps={steps} fixedStep onCancel={() => setEditing(null)}
                    onSave={(v) => { onChange(steps, [...apis, { ...v, step: i + 1 }]); setEditing(null); }} />
                )}
              </div>
            )}
          </li>
        );
      })}
      <li>
        <button onClick={() => addStep()} className="ml-7 flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600"><Plus className="w-3.5 h-3.5" /> Add step</button>
      </li>
    </ol>
  );
}

function LabelPicker({ project, value, onChange }: { project: string; value: string; onChange: (v: string) => void }) {
  const [sugg, setSugg] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const cur = value.split(/[,\s]+/).filter(Boolean);
  // Nothing is fetched until the box is clicked
  const openList = () => {
    setOpen(true);
    if (sugg || loading) return;
    setLoading(true);
    fetch(`/api/jira/labels?project=${project}`).then((r) => (r.ok ? r.json() : { labels: [] })).then((j) => setSugg(j.labels ?? [])).catch(() => setSugg([])).finally(() => setLoading(false));
  };
  const add = (raw: string) => {
    const l = raw.trim().replace(/[\s,]+/g, "-");
    if (l && !cur.includes(l)) onChange([...cur, l].join(" "));
    setQ("");
  };
  const options = (sugg ?? []).filter((l) => !cur.includes(l) && l.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40);
  return (
    <div className="space-y-1 relative">
      <span className="text-[11px] text-slate-500">Labels</span>
      <div className={`${box} flex flex-wrap items-center gap-1 !py-1`}>
        {cur.map((l) => (
          <span key={l} className="flex items-center gap-1 text-xs pl-2 pr-1 py-0.5 rounded-md bg-indigo-500/10 text-indigo-700 dark:text-indigo-300">
            {l}<button type="button" onClick={() => onChange(cur.filter((x) => x !== l).join(" "))} aria-label={`Remove ${l}`}><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input value={q} onFocus={openList} onClick={openList} onBlur={() => { setTimeout(() => setOpen(false), 120); if (q.trim()) add(q); }}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "," || e.key === " ") { if (q.trim()) { e.preventDefault(); add(q); } } else if (e.key === "Backspace" && !q && cur.length) onChange(cur.slice(0, -1).join(" ")); }}
          placeholder={cur.length ? "" : "Click to pick or type"} className="flex-1 min-w-[5rem] bg-transparent text-[13px] focus:outline-none placeholder:text-slate-400" />
      </div>
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto nice-scroll rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-lg py-1">
          {loading ? <p className="px-3 py-2 text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading labels from Jira…</p>
            : options.length ? options.map((l) => (
              <button key={l} type="button" onMouseDown={(e) => { e.preventDefault(); add(l); }} className="block w-full text-left text-xs px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-500/10">{l}</button>
            )) : <p className="px-3 py-2 text-xs text-slate-400">{q.trim() ? "Press Enter to add “" + q.trim() + "”" : "No labels used in this project yet — type one."}</p>}
        </div>
      )}
    </div>
  );
}

function ComponentPicker({ options, value, onChange }: { options: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.filter((o) => value.includes(o.id));
  const shown = options.filter((o) => !value.includes(o.id) && o.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-500">Components <span className="text-slate-400">optional — which part of the system is affected</span></span>
      <div className="flex flex-wrap items-center gap-1.5 relative">
        {selected.map((c) => (
          <button key={c.id} onClick={() => onChange(value.filter((x) => x !== c.id))} title="Remove"
            className="flex items-center gap-1 text-xs pl-2.5 pr-1.5 py-1 rounded-lg bg-indigo-500/15 text-indigo-700 dark:text-indigo-200 ring-1 ring-indigo-400/30">
            {c.name} <X className="w-3 h-3 opacity-60" />
          </button>
        ))}
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-500 hover:border-indigo-400">
          <Plus className="w-3 h-3" /> Add component
        </button>
        {open && (
          <div className="absolute left-0 top-full mt-1 z-20 w-64 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full text-xs bg-transparent px-3 py-2 border-b border-slate-100 dark:border-slate-700 outline-none" />
            <div className="max-h-48 overflow-y-auto nice-scroll py-1">
              {shown.length === 0 && <p className="text-xs text-slate-400 px-3 py-2">No matches</p>}
              {shown.map((c) => (
                <button key={c.id} onClick={() => { onChange([...value, c.id]); setQ(""); setOpen(false); }} className="w-full text-left text-xs px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-700">{c.name}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── The window ───────────────────────────────────────────────────────────────

export interface ReportIssueModalProps {
  kind: Kind;
  initial: ReportDraft;
  storyKey?: string;
  /** Suggested project when nothing is remembered yet */
  defaultProject?: string;
  itemId?: string;
  observationNumber: number;
  /** A bug created earlier (with its saved snapshot) to edit instead of creating a new one */
  editing?: IssueReport;
  /** When given, the new-bug window offers to load an existing Jira bug by its key */
  onOpenExisting?: (r: IssueReport, foreign: boolean) => void;
  startNotice?: string;
  onSaved: (r: IssueReport) => void;
  onClose: () => void;
}

export default function ReportIssueModal({ kind: initialKind, initial, storyKey, defaultProject, itemId, observationNumber, editing, onOpenExisting, startNotice, onSaved, onClose }: ReportIssueModalProps) {
  const [openKey, setOpenKey] = useState("");
  const [openBusy, setOpenBusy] = useState(false);
  const [openErr, setOpenErr] = useState("");
  const openExisting = async () => {
    if (!onOpenExisting || !openKey.trim()) return;
    setOpenBusy(true); setOpenErr("");
    try { const { report, foreign } = await loadBug(openKey); onOpenExisting(report, foreign); }
    catch (e) { setOpenErr(e instanceof Error ? e.message : "Couldn't load that ticket"); setOpenBusy(false); }
  };
  const snap = editing?.snapshot;
  const isEdit = !!snap;
  const [kind, setKind] = useState<Kind>(storyKey && !isEdit ? initialKind : "bug");
  const [d, setD] = useState<ReportDraft>(snap?.draft ?? initial);
  const [reportId] = useState(() => editing?.id ?? `rep-${Date.now()}`);
  const [existing, setExisting] = useState(snap?.files ?? []);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<ReportDraft | null>(null);
  const [polishing, setPolishing] = useState(false);
  const [files, setFiles] = useState<Upload[]>([]);
  // Opening an existing card with several problems starts folded, so you open only the one you need
  const [collapsed, setCollapsed] = useState<string[]>(() => (snap?.draft && findingsOf(snap.draft).length > 1 ? findingsOf(snap.draft).map((f) => f.id) : []));
  const toggleOpen = (id: string) => setCollapsed((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const [dragging, setDragging] = useState<string | null>(null);
  const pasteGroup = useRef<string>(MAIN_FINDING);
  const [zoom, setZoom] = useState<Upload | null>(null);
  const [zoomUrl, setZoomUrl] = useState<{ src: string; name: string } | null>(null);
  const [envs, setEnvs] = useState<string[]>(() => loadEnvs());
  const [envDraft, setEnvDraft] = useState("");
  const addEnv = () => {
    const v = envDraft.trim();
    if (!v) return;
    if (!envs.some((e) => e.toLowerCase() === v.toLowerCase())) { const next = [...envs, v]; setEnvs(next); saveEnvs(next); }
    set("environment", envs.find((e) => e.toLowerCase() === v.toLowerCase()) ?? v);
    setEnvDraft("");
  };
  const removeEnv = (e: string) => { const next = envs.filter((x) => x !== e); setEnvs(next); saveEnvs(next); };

  const [prefs] = useState(loadPrefs);
  const [project, setProject] = useState(snap?.projectKey ?? storyKey?.split("-")[0] ?? prefs.project ?? defaultProject ?? "");
  const [loadedMeta, setMeta] = useState<BugMeta | null>(null);
  const [loadedError, setMetaError] = useState<{ project: string; msg: string } | null>(null);
  // Only trust results for the project currently picked
  const meta = loadedMeta?.project.key === project ? loadedMeta : null;
  const metaError = loadedError?.project === project ? loadedError.msg : "";
  const [priorityId, setPriorityId] = useState("");
  const [componentIds, setComponentIds] = useState<string[]>([]);
  const [labels, setLabels] = useState("");
  const [envOptionId, setEnvOptionId] = useState("");
  const [boardId, setBoardId] = useState<number | null>(null);
  const [startIn, setStartIn] = useState<"backlog" | "todo">(prefs.startIn ?? "backlog");
  const [link, setLink] = useState(!!storyKey && !isEdit);

  const [phase, setPhase] = useState<"edit" | "sending" | "done">("edit");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(startNotice ?? "");
  const [created, setCreated] = useState<{ key: string; url: string; status: string; warnings: string[]; commentUrl?: string } | null>(null);

  const patchFinding = (id: string, patch: Partial<Finding>) => setD((p) => withFindings(p, findingsOf(p).map((f) => (f.id === id ? { ...f, ...patch } : f))));
  const addFinding = () => setD((p) => withFindings(p, [...findingsOf(p), newFinding()]));
  const removeFinding = (id: string) => {
    const list = findingsOf(d);
    if (list.length < 2) return;
    // The first problem lives in the main slot: removing it promotes the next one, so its files move too
    const next = list[0].id === id ? list[1].id : null;
    const gone = existing.filter((x) => baseGroup(x.group) === id && x.id).map((x) => x.id!);
    setD((p) => withFindings(p, findingsOf(p).filter((f) => f.id !== id)));
    files.filter((f) => baseGroup(f.group) === id && f.preview).forEach((f) => URL.revokeObjectURL(f.preview!));
    const move = (g?: string) => (g ?? MAIN_FINDING).replace(next ?? "", MAIN_FINDING);
    setFiles((prev) => prev.filter((f) => baseGroup(f.group) !== id).map((f) => (next && baseGroup(f.group) === next ? { ...f, group: move(f.group) } : f)));
    setExisting((prev) => prev.filter((x) => baseGroup(x.group) !== id).map((x) => (next && baseGroup(x.group) === next ? { ...x, group: move(x.group) } : x)));
    if (gone.length) setRemovedIds((r) => [...r, ...gone]);
  };
  const set = <K extends keyof ReportDraft>(k: K, v: ReportDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => () => filesRef.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []);

  // Bug fields for the chosen project (cached copy shows instantly, then refreshes)
  useEffect(() => {
    if (kind !== "bug" || !project) return;
    let alive = true;
    let applied = false;
    const apply = (m: BugMeta) => {
      setMeta(m);
      if (applied) return;
      applied = true;
      const saved = loadPrefs().byProject?.[m.project.key];
      setPriorityId(saved?.priorityId && m.priorities.some((p) => p.id === saved.priorityId) ? saved.priorityId : m.defaultPriorityId ?? "");
      setComponentIds((saved?.componentIds ?? []).filter((id) => m.components.some((c) => c.id === id)));
      setLabels(saved?.labels ?? "");
      setBoardId(saved?.boardId && m.boards.some((b) => b.id === saved.boardId) ? saved.boardId : m.boards[0]?.id ?? null);
      setEnvOptionId("");
      if (snap) {
        setPriorityId(snap.priorityId ?? "");
        setComponentIds(snap.componentIds ?? []);
        setLabels(snap.labels ?? "");
        setEnvOptionId(snap.envOptionId ?? "");
      }
    };
    const cached = readMetaCache(project);
    if (cached) apply(cached);
    fetch(`/api/jira/bug-meta?project=${project}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Failed to load"); return j as BugMeta; })
      .then((m) => { writeMetaCache(project, m); if (alive) apply(m); })
      .catch((e: Error) => { if (alive && !cached) setMetaError({ project, msg: e.message }); });
    return () => { alive = false; };
  }, [kind, project, snap]);

  // Save stays off until something differs from what was loaded
  const sig = JSON.stringify([d, labels, priorityId, componentIds, envOptionId, files.map((f) => f.name + f.file.size), existing.map((f) => f.id ?? f.name), removedIds]);
  const [baseSig, setBaseSig] = useState<string | null>(null);
  useEffect(() => { if (isEdit && baseSig === null && meta) setBaseSig(sig); }, [isEdit, baseSig, meta, sig]);
  const unchanged = isEdit && baseSig !== null && sig === baseSig;

  // Close on Escape (not while sending)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && phase !== "sending") { if (zoomUrl) setZoomUrl(null); else if (zoom) setZoom(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, zoom, zoomUrl, onClose]);

  const addFiles = useCallback((list: FileList | File[], group: string = MAIN_FINDING) => {
    const add: Upload[] = [];
    for (const f of Array.from(list)) {
      if (f.size === 0) continue;
      let name = f.name;
      if (!name || /^image\.\w+$/i.test(name)) {
        const ts = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
        name = `screenshot-${ts}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
      }
      add.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f, name,
        preview: kindOf(f) === "file" ? undefined : URL.createObjectURL(f),
        status: f.size > MAX_FILE ? "error" : "ready",
        progress: 0, group,
        error: f.size > MAX_FILE ? "Larger than 250 MB — compress or trim it" : undefined,
      });
    }
    setFiles((prev) => [...prev, ...add]);
  }, []);

  const removeFile = (id: string) => setFiles((prev) => {
    const f = prev.find((x) => x.id === id);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    return prev.filter((x) => x.id !== id);
  });
  const patchFile = (id: string, p: Partial<Upload>) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...p } : f)));

  // Paste screenshots straight into the window
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const got = imagesFrom(e.clipboardData);
      if (got.length) { e.preventDefault(); addFiles(got, pasteGroup.current); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  /** Upload every file that isn't attached yet, one by one; ok = every file confirmed by Jira. */
  const uploadAll = async (key: string): Promise<{ ok: boolean; attached: Att[] }> => {
    let ok = true;
    const attached: Att[] = [];
    for (const u of filesRef.current) {
      if (u.status === "done") { attached.push({ name: u.name, url: u.url, id: u.attId, group: u.group, mediaId: u.mediaId, image: u.file.type.startsWith("image/") }); continue; }
      if (u.file.size > MAX_FILE) { ok = false; continue; }
      patchFile(u.id, { status: "uploading", progress: 0, error: undefined });
      try {
        const r = await uploadToJira(key, u, (p) => patchFile(u.id, { progress: p }));
        const name = r.filename ?? u.name;
        patchFile(u.id, { status: "done", progress: 1, url: r.url, name, attId: r.id, mediaId: r.mediaId });
        attached.push({ name, url: r.url, id: r.id, group: u.group, mediaId: r.mediaId, image: u.file.type.startsWith("image/") });
      } catch (e) {
        ok = false;
        patchFile(u.id, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
      }
    }
    return { ok, attached };
  };

  const pasteFromClipboard = async (group: string) => {
    try {
      const items = await navigator.clipboard.read();
      const got: File[] = [];
      for (const it of items) {
        const type = it.types.find((x) => x.startsWith("image/"));
        if (type) { const blob = await it.getType(type); got.push(new File([blob], "", { type })); }
      }
      if (got.length) addFiles(got, group);
      else setNotice("No image on the clipboard. Copy a screenshot first.");
    } catch { setNotice("Your browser blocked the paste button. Click the box and press Ctrl+V instead."); }
  };

  const renderEvidence = (group: string) => {
    const gfiles = files.filter((f) => f.group === group);
    const gexisting = existing.filter((f) => (f.group ?? MAIN_FINDING) === group);
    return (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(group); }}
                onDragLeave={() => setDragging(null)}
                onDrop={(e) => { e.preventDefault(); setDragging(null); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, group); }}
                className={`rounded-xl transition-colors ${dragging === group ? "border-2 border-dashed border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 p-3" : ""}`}
              >
                {gexisting.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {gexisting.map((f) => (
                      <span key={f.id ?? f.name} className="flex items-center gap-1.5 text-xs pl-2.5 pr-1.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-400/30">
                        {f.id && /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)
                      ? <button type="button" onClick={() => setZoomUrl({ src: `/api/jira/attachment?view=${f.id}`, name: f.name })} title="View"><img src={`/api/jira/attachment?thumb=${f.id}`} alt={f.name} className="h-14 w-20 object-cover rounded-md" /></button>
                      : <Paperclip className="w-3 h-3" />}
                        {f.id && /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? <button type="button" onClick={() => setZoomUrl({ src: `/api/jira/attachment?view=${f.id}`, name: f.name })} className="hover:underline max-w-[220px] truncate">{f.name}</button> : f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline max-w-[220px] truncate">{f.name}</a> : <span className="max-w-[220px] truncate">{f.name}</span>}
                        {!busy && <button onClick={() => { setExisting((p) => p.filter((x) => x !== f)); if (f.id) setRemovedIds((p) => [...p, f.id!]); }} title="Remove from the card" className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>}
                      </span>
                    ))}
                  </div>
                )}
                {gfiles.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
                    {gfiles.map((f) => {
                      const k = kindOf(f.file);
                      const [base, ext] = splitName(f.name);
                      return (
                        <div key={f.id} className={`group/file relative rounded-lg border overflow-hidden bg-white dark:bg-slate-900 ${f.status === "error" ? "border-rose-300 dark:border-rose-500/50" : f.status === "done" ? "border-emerald-300 dark:border-emerald-500/40" : "border-slate-200 dark:border-slate-700"}`}>
                          <button onClick={() => k !== "file" && setZoom(f)} className="block w-full h-28 bg-slate-100 dark:bg-slate-800">
                            {k === "image" && f.preview && <img src={f.preview} alt={f.name} className="w-full h-full object-cover" />}
                            {k === "video" && f.preview && <video src={f.preview} muted className="w-full h-full object-cover" />}
                            {k === "file" && <FileText className="w-8 h-8 mx-auto text-slate-400" />}
                            {k === "video" && <span className="absolute top-1.5 left-1.5 flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/60 text-white"><Film className="w-3 h-3" /> Video</span>}
                          </button>
                          {f.status !== "done" && !busy && (
                            <button onClick={() => removeFile(f.id)} title="Remove" className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center bg-black/60 text-white opacity-0 group-hover/file:opacity-100"><X className="w-3.5 h-3.5" /></button>
                          )}
                          {f.status === "done" && <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center bg-emerald-600 text-white"><Check className="w-3.5 h-3.5" /></span>}
                          <div className="px-2 py-1.5 space-y-1">
                            <div className="flex items-center gap-0.5">
                              <input value={base} disabled={f.status !== "ready" && f.status !== "error"} onChange={(e) => patchFile(f.id, { name: `${e.target.value.replace(/[\\/:*?"<>|]/g, "")}${ext}` })}
                                title="Rename" className="flex-1 min-w-0 text-[11px] bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800 rounded px-0.5" />
                              <span className="text-[11px] text-slate-400">{ext}</span>
                            </div>
                            {f.status === "uploading" ? (
                              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(f.progress * 100)}%` }} /></div>
                            ) : f.status === "error" ? (
                              <p className="text-[10px] text-rose-600 leading-tight">{f.error}</p>
                            ) : (
                              <p className="text-[10px] text-slate-400">{fmtSize(f.file.size)}{f.status === "done" ? " · attached ✓" : ""}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => pasteFromClipboard(group)} title="Or hover here and press Ctrl+V" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 hover:border-indigo-300">
                    <ImageIcon className="w-3.5 h-3.5" /> Paste image
                  </button>
                  <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-indigo-600 hover:border-indigo-300">
                    <Upload className="w-3.5 h-3.5" /> {gfiles.length || gexisting.length ? "Add more" : "Add screenshots or videos"}
                    <input type="file" multiple accept="image/*,video/*,.txt,.log,.json,.har,.pdf,.xlsx,.csv" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files, group); e.target.value = ""; }} />
                  </label>
                  <span className="text-[11px] text-slate-400">or drop files here · up to 250 MB each</span>
                </div>
              </div>
    );
  };

  const renderFinding = (f: Finding, i: number, multi: boolean) => {
    const body = (
      <>
        <Section title="Steps to reproduce" hint="hover a step to attach an API request">
          <StepsEditor steps={f.steps} apis={f.apis} onChange={(st, a) => patchFinding(f.id, { steps: st, apis: a })} />
        </Section>
        <Section title="Expected result" hint="screenshots optional">
          <AutoText value={f.expected} onChange={(v) => patchFinding(f.id, { expected: v })} minRows={3} placeholder="What should have happened" />
          <div className="mt-2" onMouseEnter={() => { pasteGroup.current = expGroup(f.id); }}>{renderEvidence(expGroup(f.id))}</div>
        </Section>
        <Section title="Actual result" hint="required · screenshots optional">
          <AutoText value={f.actual} onChange={(v) => patchFinding(f.id, { actual: v })} minRows={3} placeholder="What actually happened — error text, wrong value, status code…"
            className={!f.actual.trim() ? "border-amber-300 dark:border-amber-500/40 bg-amber-50/40 dark:bg-amber-500/5" : ""} />
          <div className="mt-2" onMouseEnter={() => { pasteGroup.current = f.id; }}>{renderEvidence(f.id)}</div>
        </Section>
        <div className="grid md:grid-cols-2 gap-4">
          <Section title="Test data / IDs" hint="one per line">
            <AutoText value={f.testData} onChange={(v) => patchFinding(f.id, { testData: v })} placeholder={"Loan ID: 123456\nUser: tester01"} />
          </Section>
          <Section title="Notes" hint="optional">
            <AutoText value={f.notes} onChange={(v) => patchFinding(f.id, { notes: v })} placeholder="Frequency, workaround, logs, anything else" />
          </Section>
        </div>
      </>
    );
    if (!multi) return <div key={f.id} className="space-y-5" >{body}</div>;
    const closed = collapsed.includes(f.id);
    const fileCount = files.filter((x) => baseGroup(x.group) === f.id).length + existing.filter((x) => baseGroup(x.group) === f.id).length;
    return (
      <div key={f.id}
        className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 p-4 space-y-5">
        <div className="flex items-center gap-2">
          <button onClick={() => toggleOpen(f.id)} title={closed ? "Open" : "Close"} className="p-1 -ml-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
            <ChevronDown className={`w-4 h-4 transition-transform ${closed ? "-rotate-90" : ""}`} />
          </button>
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">{i + 1}</span>
          <input value={f.title} onChange={(e) => patchFinding(f.id, { title: e.target.value })} placeholder={`Problem ${i + 1} — short title`}
            className="flex-1 min-w-0 text-sm font-medium bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-indigo-400 focus:outline-none py-1 text-slate-800 dark:text-slate-100" />
          {closed && <span className="text-[11px] text-slate-400 flex-shrink-0">{!f.actual.trim() ? "needs actual result" : fileCount ? `${fileCount} file${fileCount > 1 ? "s" : ""}` : ""}</span>}
          {!busy && <button onClick={() => removeFinding(f.id)} title="Remove this problem" className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>}
        </div>
        {!closed && body}
      </div>
    );
  };

  const steps = d.steps.map((s) => s.trim()).filter(Boolean);
  const missing = [
    !d.title.trim() && "a title",
    ...findingsOf(d).map((f, i, all) => !f.actual.trim() && (all.length > 1 ? `what actually happened in problem ${i + 1}` : "what actually happened")),
    kind === "bug" && !meta && "project details",
    files.some((f) => f.file.size > MAX_FILE) && "remove files over 250 MB",
  ].filter(Boolean) as string[];

  const makeReport = (key: string, url: string, attached: Att[], prior = existing): IssueReport => ({
    id: reportId, kind: "bug", title: d.title.trim(), itemId: editing?.itemId ?? itemId, testCaseId: d.testCaseId,
    key, url, environment: d.environment || undefined, createdAt: editing?.createdAt ?? new Date().toISOString(),
    snapshot: {
      draft: { ...d, steps }, projectKey: meta?.project.key ?? project, priorityId: priorityId || undefined, componentIds,
      labels, envOptionId: envOptionId || undefined, storyKey: snap?.storyKey ?? (link ? storyKey : undefined),
      files: [...prior, ...attached.filter((a) => !prior.some((e) => e.id && e.id === a.id))],
    },
  });

  // Older attachments don't have Jira's image id saved yet: look it up so they can show inline
  const withMedia = async (list: typeof existing) => {
    const IMG = /\.(png|jpe?g|gif|webp|bmp)$/i;
    const need = list.filter((f) => f.id && !f.mediaId && IMG.test(f.name));
    if (!need.length) return list.map((f) => ({ ...f, image: f.image ?? IMG.test(f.name) }));
    let media: Record<string, string> = {};
    try { media = ((await (await fetch(`/api/jira/attachment?ids=${need.map((f) => f.id).join(",")}`)).json()) as { media?: Record<string, string> }).media ?? {}; } catch { /* links are fine */ }
    return list.map((f) => ({ ...f, mediaId: f.mediaId ?? (f.id ? media[f.id] : undefined), image: f.image ?? IMG.test(f.name) }));
  };

  const submitEdit = async () => {
    if (!meta || !editing?.key) return;
    setPhase("sending"); setError("");
    try {
      const { ok, attached } = await uploadAll(editing.key);
      const prior = await withMedia(existing);
      if (!ok) { setPhase("edit"); setError("Some files didn't upload. Retry, or remove them to save without."); return; }
      const res = await fetch("/api/jira/issue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: editing.key,
          summary: d.title,
          description: buildBugAdf({ ...d, steps }, { storyKey: snap?.storyKey, attachments: [...prior, ...attached] }),
          priorityId: priorityId || undefined,
          componentIds,
          labels: labels.split(/[,\s]+/).filter(Boolean),
          envField: meta.envField && (envOptionId || "") !== (snap?.envOptionId ?? "") ? { id: meta.envField.id, optionId: envOptionId || null } : undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to save changes");
      const warnings: string[] = [];
      for (const id of removedIds) {
        const r = await fetch(`/api/jira/attachment?id=${id}`, { method: "DELETE" });
        if (!r.ok) warnings.push("One removed file couldn't be deleted from Jira.");
      }
      setRemovedIds([]);
      setCreated({ key: editing.key, url: editing.url ?? "", status: "", warnings });
      setExisting(prior);
      onSaved(makeReport(editing.key, editing.url ?? "", attached, prior));
      setPhase("done");
    } catch (e) {
      setPhase("edit");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const submitBug = async () => {
    if (!meta) return;
    setPhase("sending"); setError("");
    try {
      let bug = created;
      if (!bug) {
        const res = await fetch("/api/jira/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: meta.project.key,
            issueTypeId: meta.issueTypeId,
            summary: d.title,
            description: buildBugAdf({ ...d, steps }, { storyKey, attachments: files.filter((f) => f.file.size <= MAX_FILE).map((f) => ({ name: f.name, group: f.group })) }),
            priorityId: priorityId || undefined,
            componentIds,
            labels: labels.split(/[,\s]+/).filter(Boolean),
            envField: meta.envField && envOptionId ? { id: meta.envField.id, optionId: envOptionId } : undefined,
            linkTo: link && storyKey ? storyKey : undefined,
            startIn,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Failed to create the bug");
        bug = j as NonNullable<typeof created>;
        setCreated(bug);
        savePrefs({ ...loadPrefs(), project: meta.project.key, startIn, byProject: { ...loadPrefs().byProject, [meta.project.key]: { boardId: boardId ?? undefined, priorityId, componentIds, labels } } });
        onSaved(makeReport(bug.key, bug.url, []));
      }
      const { ok, attached } = await uploadAll(bug.key);
      if (attached.length) {
        const r = await fetch("/api/jira/issue", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: bug.key, summary: d.title,
            description: buildBugAdf({ ...d, steps }, { storyKey, attachments: attached }),
            priorityId: priorityId || undefined, componentIds,
            labels: labels.split(/[,\s]+/).filter(Boolean),
            envField: meta.envField ? { id: meta.envField.id, optionId: envOptionId || null } : undefined,
          }),
        });
        if (!r.ok) setNotice("The bug was created and files attached, but showing them inside the description failed.");
      }
      onSaved(makeReport(bug.key, bug.url, attached));
      setPhase(ok ? "done" : "edit");
      if (!ok) setError(`Bug ${bug.key} was created, but some files didn't attach. Retry them below.`);
    } catch (e) {
      setPhase("edit");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const submitObservation = async () => {
    if (!storyKey) return;
    setPhase("sending"); setError("");
    try {
      const { ok, attached: attachments } = await uploadAll(storyKey);
      if (!ok) { setPhase("edit"); setError("Some files didn't upload. Retry, or remove them to post without."); return; }
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: storyKey, adf: buildObservationAdf({ ...d, steps }, { number: observationNumber, attachments }) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to post the observation");
      const url = (j.url as string | undefined) ?? undefined;
      setCreated({ key: storyKey, url: url ?? "", status: "", warnings: j.alreadyPosted ? ["This exact observation was already on the story, so it wasn't posted twice."] : [], commentUrl: url });
      const now = new Date().toISOString();
      onSaved({
        id: `rep-${Date.now()}`, kind: "observation", title: d.title.trim(), itemId, testCaseId: d.testCaseId,
        key: storyKey, url, number: observationNumber, state: "open", environment: d.environment || undefined,
        createdAt: now, history: [{ at: now, state: "open", environment: d.environment || undefined }],
      });
      setPhase("done");
    } catch (e) {
      setPhase("edit");
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const canPolish = !!(d.title.trim() || d.actual.trim() || d.expected.trim() || d.steps.some((x) => x.trim()));

  const polish = async () => {
    setPolishing(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/report/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: d.title, preconditions: d.preconditions, steps, expected: d.expected, actual: d.actual }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "AI is unavailable");
      setUndo(d);
      setD((p) => ({
        ...p,
        title: j.title || p.title,
        actual: j.actual || p.actual,
        expected: j.expected || p.expected,
        // Only take reworded steps when the count matches, so API requests stay on the right step
        steps: Array.isArray(j.steps) && j.steps.length === steps.length && steps.length === p.steps.length ? j.steps : p.steps,
      }));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "AI is unavailable");
    } finally {
      setPolishing(false);
    }
  };

  const isBug = kind === "bug";
  const uploading = files.some((f) => f.status === "uploading");
  const busy = phase === "sending";

  // ── Done screen ──
  if (phase === "done" && created) {
    return (
      <Overlay onClose={onClose}>
        <div className="p-8 text-center space-y-4">
          <div className={`w-14 h-14 mx-auto rounded-full flex items-center justify-center ${isBug ? "bg-indigo-100 dark:bg-indigo-500/15" : "bg-sky-100 dark:bg-sky-500/15"}`}>
            <Check className={`w-7 h-7 ${isBug ? "text-indigo-600" : "text-sky-600"}`} />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 dark:text-slate-100">
              {isBug ? <>Bug <span className="font-mono">{created.key}</span> {isEdit ? "updated" : "created"}</> : <>Observation #{observationNumber} posted on <span className="font-mono">{created.key}</span></>}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {isBug
                ? <>{created.status ? <>It&apos;s in <b>{created.status}</b>. </> : null}{link && storyKey ? <>Linked to {storyKey}. </> : null}{files.length ? `${files.length} file${files.length > 1 ? "s" : ""} attached.` : ""}</>
                : <>It&apos;s tracked below the checklist. When the dev fixes it, mark it fixed and retest.</>}
            </p>
          </div>
          {created.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 rounded-lg px-3 py-2">{w}</p>)}
          <div className="flex justify-center gap-2 pt-2">
            {(created.commentUrl || created.url) && (
              <a href={created.commentUrl || created.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white">
                Open in Jira <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button onClick={onClose} className="text-sm px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">Close</button>
          </div>
        </div>
      </Overlay>
    );
  }

  return (
    <Overlay onClose={busy ? undefined : onClose}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700">
        {isEdit ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-400/40">
            <Bug className="w-3.5 h-3.5" /> Edit <span className="font-mono">{editing?.key}</span>
          </span>
        ) : (
        <div className="flex p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800">
          <button disabled={!!created || busy} onClick={() => setKind("bug")}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${isBug ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 ring-1 ring-indigo-400/40" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"}`}>
            <Bug className="w-3.5 h-3.5" /> New bug card
          </button>
          {storyKey && (
            <button disabled={!!created || busy} onClick={() => setKind("observation")}
              title={`Post as a comment on ${storyKey}`}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg ${!isBug ? "bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-1 ring-sky-400/40" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"}`}>
              <Search className="w-3.5 h-3.5" /> Observation on {storyKey}
            </button>
          )}
        </div>
        )}
        <p className="flex-1 text-xs text-slate-500 dark:text-slate-400 hidden md:block">
          {isBug ? (isEdit ? "Saves your changes to the existing Jira card." : "Creates a separate Bug card in Jira.") : `Adds “Observation #${observationNumber}” as a comment on the story.`}
        </p>
        <button onClick={onClose} disabled={busy} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"><X className="w-4 h-4" /></button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto nice-scroll px-5 py-4 space-y-5">
        {onOpenExisting && isBug && !isEdit && !created && (
          <div className="rounded-2xl p-[1px] bg-gradient-to-r from-indigo-500/50 via-violet-500/30 to-sky-500/50">
            <div className="rounded-2xl bg-white dark:bg-slate-900 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/20"><Pencil className="w-4 h-4 text-white" /></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 leading-tight">Edit an existing bug</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Type its ticket number and load it here. Nothing is fetched until you press Load.</p>
                </div>
                <input value={openKey} onChange={(e) => { setOpenKey(e.target.value.toUpperCase()); setOpenErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") openExisting(); }}
                  placeholder="LSINST-123" className="w-36 text-sm font-mono tracking-wide text-center rounded-xl px-3 py-2 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 border border-transparent focus:border-indigo-400 focus:outline-none" />
                <button onClick={openExisting} disabled={openBusy || !openKey.trim()} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:brightness-110 disabled:opacity-40 shadow-md shadow-indigo-500/20">
                  {openBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Load
                </button>
              </div>
              {openErr && <p className="text-xs text-amber-600 dark:text-amber-300 mt-2 ml-12">{openErr}</p>}
            </div>
          </div>
        )}
        {/* Title */}
        <Section title="Title" right={
          <div className="flex items-center gap-1">
            {undo && <button onClick={() => { setD(undo); setUndo(null); }} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Undo2 className="w-3 h-3" /> Undo AI</button>}
            <button onClick={polish} disabled={polishing || busy || !canPolish} title="Rewrites title, steps, expected and actual more clearly. Never adds facts." className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md text-violet-600 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 disabled:opacity-50">
              {polishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Polish wording with AI
            </button>
          </div>
        }>
          <div className="flex items-center gap-2">
            {d.testCaseId && <span className="font-mono text-[10px] font-bold px-1.5 py-1 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">{d.testCaseId}</span>}
            <input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={255} placeholder="Where + what goes wrong, e.g. “Loan schedule — rate change ignores the new end date”" className={`${box} text-sm font-medium`} />
          </div>
        </Section>

        {/* Where (bug only) */}
        {isBug && (
          <Section title="Where it goes">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-[11px] text-slate-500">Project</span>
                {isEdit
                  ? <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200 py-1.5">{meta?.project.name ?? project} <span className="text-slate-400">· {project}</span></p>
                  : <ProjectPicker value={project} name={meta?.project.name} onPick={setProject} />}
                {meta?.boards.length ? (
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                    Board:
                    {meta.boards.length === 1 ? (
                      <a href={meta.boards[0].url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{meta.boards[0].name}</a>
                    ) : (
                      <select value={boardId ?? ""} onChange={(e) => setBoardId(Number(e.target.value))} className="text-[11px] bg-transparent border border-slate-200 dark:border-slate-600 rounded px-1 py-0.5 max-w-[200px]">
                        {meta.boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </p>
                ) : null}
              </div>
              {!isEdit && <div className="space-y-1">
                <span className="text-[11px] text-slate-500">Starts in column</span>
                <div className="flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
                  {(["backlog", "todo"] as const).map((c) => (
                    <button key={c} onClick={() => setStartIn(c)} className={`text-xs font-medium px-3 py-1.5 rounded-md ${startIn === c ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm" : "text-slate-500"}`}>
                      {c === "backlog" ? "Backlog" : "To Do"}
                    </button>
                  ))}
                </div>
                {storyKey && (
                  <label className="flex items-center gap-2 pt-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} className="accent-indigo-600" />
                    <Link2 className="w-3.5 h-3.5 text-slate-400" /> Link to {storyKey} <span className="text-slate-400">(“relates to”)</span>
                  </label>
                )}
              </div>}
            </div>
            {metaError && <ErrorNotice message={metaError} size="sm" />}
            {!meta && !metaError && project && <p className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading {project} fields…</p>}
            {meta?.unsupported.length ? <p className="text-xs text-amber-700 dark:text-amber-300">This project requires fields the app can&apos;t fill yet: {meta.unsupported.join(", ")}. Jira may reject the bug.</p> : null}
            {meta && (
              <div className="grid sm:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-500">Priority</span>
                  <select value={priorityId} onChange={(e) => setPriorityId(e.target.value)} className={box}>
                    <option value="">Default</option>
                    {meta.priorities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
                {meta.envField && (
                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-500">Jira “{meta.envField.name}” field</span>
                    <select value={envOptionId} onChange={(e) => setEnvOptionId(e.target.value)} className={box}>
                      <option value="">Leave empty</option>
                      {meta.envField.options.map((o) => <option key={o.id} value={o.id}>{o.value}</option>)}
                    </select>
                  </label>
                )}
                {meta.labels && (
                  <LabelPicker key={project} project={project} value={labels} onChange={setLabels} />
                )}
                {meta.components.length > 0 && (
                  <div className="sm:col-span-3">
                    <ComponentPicker options={meta.components} value={componentIds} onChange={setComponentIds} />
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* Environment */}
        <Section title="Environment" hint="where you saw it">
          <div className="flex flex-wrap items-center gap-1.5">
            {envs.map((e) => (
              <span key={e} className={`group/env flex items-center rounded-lg border text-xs font-semibold ${d.environment === e ? "bg-teal-600 border-teal-600 text-white" : "border-slate-200 dark:border-slate-600 text-teal-700 dark:text-teal-300 hover:border-teal-400"}`}>
                <button type="button" onClick={() => set("environment", d.environment === e ? "" : e)} className="pl-2.5 pr-1.5 py-1">{e}</button>
                <button type="button" onClick={() => { removeEnv(e); if (d.environment === e) set("environment", ""); }} title="Remove from my list" aria-label={`Remove ${e}`} className="pr-1.5 py-1 opacity-40 hover:opacity-100"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <input value={envDraft} onChange={(e) => setEnvDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEnv(); } }}
              placeholder={envs.length ? "Add environment… (Enter)" : "Add your first environment, e.g. DEV (Enter)"} className={`${box} !w-64`} />
            {envDraft.trim() && <button type="button" onClick={addEnv} className="text-xs px-2.5 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-500">Add</button>}
          </div>
          {d.environment && !envs.includes(d.environment) && <p className="mt-1 text-[11px] text-slate-400">Current: {d.environment}</p>}
        </Section>

        {d.preconditions || isBug ? (
          <Section title="Preconditions" hint="optional">
            <AutoText value={d.preconditions} onChange={(v) => set("preconditions", v)} minRows={1} placeholder="State before you start, e.g. active loan with 12 months left" />
          </Section>
        ) : null}

        {(() => {
          const list = findingsOf(d);
          return (
            <>
              {list.map((f, i) => renderFinding(f, i, list.length > 1))}
              {!busy && (
                <button onClick={addFinding} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:text-indigo-600 hover:border-indigo-400">
                  <Plus className="w-4 h-4" /> Add another problem
                </button>
              )}
            </>
          );
        })()}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40">
        <div className="flex-1 min-w-0 text-xs truncate">
          {error ? <ErrorNotice message={error} size="sm" />
            : notice ? <span className="text-amber-600 dark:text-amber-300">{notice}</span>
            : missing.length ? <span className="text-slate-400">Still needed: {missing.join(", ")}</span>
            : unchanged ? <span className="text-slate-400">No changes yet</span>
            : files.length ? <span className="text-slate-500 flex items-center gap-1"><Paperclip className="w-3.5 h-3.5" /> {files.length} file{files.length > 1 ? "s" : ""} will be attached</span> : null}
        </div>
        <button onClick={onClose} disabled={busy} className="text-sm px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">Cancel</button>
        <button
          onClick={isEdit ? submitEdit : isBug ? submitBug : submitObservation}
          disabled={busy || uploading || missing.length > 0 || unchanged}
          className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-40 ${isBug ? "bg-indigo-600 hover:bg-indigo-700" : "bg-sky-600 hover:bg-sky-700"}`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : created ? <RotateCw className="w-4 h-4" /> : isBug ? <Bug className="w-4 h-4" /> : <Search className="w-4 h-4" />}
          {busy ? (uploading ? "Uploading files…" : isBug ? "Creating…" : "Posting…")
            : created && isBug ? "Retry failed files"
            : isEdit ? "Save changes" : isBug ? `Create bug in ${meta?.project.key ?? project}` : `Post observation #${observationNumber}`}
        </button>
      </div>

      {zoomUrl && (
        <div className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-6" onClick={() => setZoomUrl(null)}>
          <img src={zoomUrl.src} alt={zoomUrl.name} className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
      {zoom && (
        <div className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-6" onClick={() => setZoom(null)}>
          {kindOf(zoom.file) === "video"
            ? <video src={zoom.preview} controls autoPlay className="max-w-full max-h-full rounded-lg" onClick={(e) => e.stopPropagation()} />
            : <img src={zoom.preview} alt={zoom.name} className="max-w-full max-h-full rounded-lg" />}
          <button className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center"><X className="w-5 h-5" /></button>
        </div>
      )}
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-section-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
