"use client";

import MarkdownEditor from "./MarkdownEditor";
import { pdfSafe, pdfInline } from "@/lib/pdf-text";
import { useState, useMemo, useRef } from "react";
import { Copy, Check, Download, Send, Loader2, AlertCircle, Pencil, Trash2, AlertTriangle, Lightbulb, MessageCircleQuestion } from "lucide-react";

export type InsightKind = "ambiguity" | "assumption" | "question";

/** Split one AI sentence-blob into a short headline + the explanation behind it. */
export function splitInsight(kind: InsightKind | undefined, raw: string): { role?: string; head: string; why?: string } {
  let text = raw.trim();
  let role: string | undefined;
  const tag = text.match(/^\[([^\]]{1,30})\]\s*/);
  if (tag) { role = tag[1].trim(); text = text.slice(tag[0].length); }
  if (kind === "assumption") {
    const m = text.match(/^(?:assumed|assuming|we assume[ds]?)\s+(?:that\s+)?(.+?)\s+(?:because|since|as)\s+(.+)$/i);
    if (m) return { role, head: m[1].replace(/[.,;]$/, ""), why: m[2] };
  }
  if (kind === "question") {
    const q = text.match(/^(.+?\?)\s+(.+)$/);
    if (q) return { role, head: q[1], why: q[2] };
    return { role, head: text };
  }
  const s = text.match(/^(.{20,}?[.!?])\s+([A-Z(].+)$/);
  return s ? { role, head: s[1], why: s[2] } : { role, head: text };
}

const KIND_UI: Record<InsightKind, { icon: React.ReactNode; intro: string; whyLabel: string }> = {
  ambiguity:  { icon: <AlertTriangle className="w-4 h-4" />,         intro: "Things the story doesn’t say clearly. Each one can lead to a wrong build or a missed test.", whyLabel: "" },
  assumption: { icon: <Lightbulb className="w-4 h-4" />,             intro: "Where the story was unclear, the analysis guessed. Check these guesses are right.",           whyLabel: "Because" },
  question:   { icon: <MessageCircleQuestion className="w-4 h-4" />, intro: "Questions to ask before or during testing, and who should answer them.",                       whyLabel: "Why ask" },
};

const roleTone = (role: string) =>
  /dev/i.test(role) ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
  : /ops/i.test(role) ? "bg-slate-200 text-slate-700 dark:bg-slate-600/50 dark:text-slate-200"
  : "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300";

function contentFp(s: string): string {
  const n = s.replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < n.length; i++) h = ((h << 5) + h) ^ n.charCodeAt(i);
  return (h >>> 0).toString(36);
}

interface StructuredListCardProps {
  title: string;
  items: string[];
  accentColor?: "amber" | "violet" | "sky";
  kind?: InsightKind;
  emptyMessage?: string;
  jiraKey?: string;
  postedFingerprint?: string;
  onPosted?: (fingerprint: string) => void;
  onItemsChange?: (newItems: string[]) => void;
  onTitleChange?: (newTitle: string) => void;
}

const colorMaps = {
  amber: {
    border: "border-amber-400",
    bar: "bg-amber-500",
    badge: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    number: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
    rgb: [217, 119, 6] as [number, number, number],
  },
  violet: {
    border: "border-violet-400",
    bar: "bg-violet-500",
    badge: "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300",
    number: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300",
    rgb: [124, 58, 237] as [number, number, number],
  },
  sky: {
    border: "border-sky-400",
    bar: "bg-sky-500",
    badge: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300",
    number: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300",
    rgb: [2, 132, 199] as [number, number, number],
  },
};

export default function StructuredListCard({
  title,
  items,
  accentColor = "amber",
  kind,
  emptyMessage = "None identified.",
  jiraKey,
  postedFingerprint,
  onPosted,
  onItemsChange,
  onTitleChange,
}: StructuredListCardProps) {
  const [copied, setCopied] = useState(false);
  const [jiraStatus, setJiraStatus] = useState<"idle" | "posting" | "posted" | "error">("idle");
  const [jiraErrorMsg, setJiraErrorMsg] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const colors = colorMaps[accentColor];
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const parsed = useMemo(() => items.map(it => splitInsight(kind, it)), [items, kind]);
  const roles = useMemo(() => {
    const m = new Map<string, number>();
    parsed.forEach(p => p.role && m.set(p.role, (m.get(p.role) ?? 0) + 1));
    return [...m.entries()];
  }, [parsed]);
  const ui = kind ? KIND_UI[kind] : null;

  const prevTitleRef = useRef(title);
  if (prevTitleRef.current !== title) { prevTitleRef.current = title; setTitleValue(title); }

  const currentFp = useMemo(() => contentFp(items.join("\n")), [items]);
  const isAlreadyPosted = jiraStatus === "idle" && postedFingerprint === currentFp;

  const handleCopy = async () => {
    const text = `# ${title}\n\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n")}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePostJira = async () => {
    if (!jiraKey || jiraStatus === "posting" || isAlreadyPosted) return;
    setJiraStatus("posting");
    setJiraErrorMsg(null);
    const content = items.map((item, i) => `${i + 1}. ${item}`).join("\n");
    try {
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: jiraKey, title, content }),
      });
      const data = await res.json() as { error?: string; alreadyPosted?: boolean };
      if (!res.ok) throw new Error(data.error ?? "Failed to post comment");
      onPosted?.(currentFp);
      if (data.alreadyPosted) {
        setJiraStatus("idle");
      } else {
        setJiraStatus("posted");
        setTimeout(() => setJiraStatus("idle"), 2000);
      }
    } catch (err) {
      setJiraStatus("error");
      setJiraErrorMsg(err instanceof Error ? err.message : "Failed to post to Jira");
      setTimeout(() => { setJiraStatus("idle"); setJiraErrorMsg(null); }, 5000);
    }
  };

  const handleExportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const [r, g, b] = colors.rgb;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const contentW = pageW - margin * 2;
    let y = 60;
    const checkPage = (needed: number) => {
      if (y + needed > pageH - 48) { doc.addPage(); y = 52; }
    };
    doc.setFillColor(r, g, b);
    doc.roundedRect(margin, y, contentW, 32, 5, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfSafe(title), margin + 14, y + 21);
    y += 44;
    items.forEach((item, i) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(pdfInline(item), contentW - 30);
      checkPage(wrapped.length * 13 + 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(r, g, b);
      doc.text(`${i + 1}.`, margin + 8, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(51, 65, 85);
      doc.text(wrapped, margin + 24, y);
      y += wrapped.length * 13 + 4;
    });
    doc.save(`${title.toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-6 py-4 border-b ${colors.border} border-opacity-30 bg-gradient-to-r from-white dark:from-slate-800 to-slate-50 dark:to-slate-700`}
      >
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-6 rounded-full ${colors.bar}`} />
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={() => { setEditingTitle(false); if (titleValue.trim()) onTitleChange?.(titleValue.trim()); else setTitleValue(title); }}
              onKeyDown={e => { if (e.key === "Enter") { setEditingTitle(false); if (titleValue.trim()) onTitleChange?.(titleValue.trim()); else setTitleValue(title); } if (e.key === "Escape") { setEditingTitle(false); setTitleValue(title); } }}
              className={`font-bold text-slate-800 dark:text-slate-100 text-base bg-transparent border-b-2 ${colors.border} focus:outline-none min-w-0 flex-1`}
            />
          ) : (
            <div className="flex items-center gap-1.5">
              {onTitleChange ? (
                <h2
                  onClick={() => { setEditingTitle(true); }}
                  title="Click to rename"
                  className="font-bold text-slate-800 dark:text-slate-100 text-base cursor-pointer hover:text-violet-500 dark:hover:text-violet-400 transition-colors border-b border-transparent hover:border-violet-400">
                  {titleValue}
                </h2>
              ) : (
                <h2 className="font-bold text-slate-800 dark:text-slate-100 text-base">{titleValue}</h2>
              )}
            </div>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
            {items.length}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors"
            title="Export section as PDF"
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </button>
          {jiraKey && (
            <button
              onClick={handlePostJira}
              disabled={jiraStatus === "posting" || isAlreadyPosted}
              title={
                isAlreadyPosted ? `Already posted to ${jiraKey}. Re-analyze to post updated content.`
                : jiraStatus === "error" ? (jiraErrorMsg ?? "Failed")
                : `Post this section as a comment on ${jiraKey}`
              }
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all disabled:opacity-60 ${
                isAlreadyPosted
                  ? "bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-default"
                  : jiraStatus === "posted"
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                  : jiraStatus === "error"
                  ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 bg-slate-100 dark:bg-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              }`}
            >
              {isAlreadyPosted          ? <Check className="w-3.5 h-3.5" />
               : jiraStatus === "posting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
               : jiraStatus === "posted" ? <Check className="w-3.5 h-3.5" />
               : jiraStatus === "error"  ? <AlertCircle className="w-3.5 h-3.5" />
               : <Send className="w-3.5 h-3.5" />}
              {isAlreadyPosted          ? "Already posted"
               : jiraStatus === "posting" ? "Posting…"
               : jiraStatus === "posted" ? "Posted!"
               : jiraStatus === "error"  ? "Failed"
               : "Post to Jira"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
              copied
                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {ui && (
        <div className="px-6 pt-4 flex items-start gap-3 flex-wrap">
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 flex-1 min-w-[16rem]">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.number}`}>{ui.icon}</span>
            {ui.intro}
          </p>
          {roles.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={() => setRoleFilter(null)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${roleFilter === null ? "bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400"}`}>All {items.length}</button>
              {roles.map(([r, n]) => (
                <button key={r} onClick={() => setRoleFilter(roleFilter === r ? null : r)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${roleFilter === r ? "bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white" : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-slate-400"}`}>Ask {r} {n}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Items list */}
      <div className={`px-6 py-5 ${ui ? "max-h-[60vh] overflow-y-auto overscroll-contain [scrollbar-width:thin]" : ""}`}>
        {items.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic">{emptyMessage}</p>
        ) : (
          <ol className={ui ? "space-y-2.5" : "space-y-3"}>
            {items.map((item, i) => {
              const p = parsed[i];
              if (roleFilter && p.role !== roleFilter) return null;
              const actions = onItemsChange && (
                <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button type="button" onClick={() => { setEditingIdx(i); }} title="Edit this item"
                    className="p-1 rounded text-slate-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => onItemsChange(items.filter((_, idx) => idx !== i))} title="Delete this item"
                    className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
              const editor = (
                <MarkdownEditor
                  value={item}
                  onCancel={() => setEditingIdx(null)}
                  onSave={(v) => { onItemsChange?.(items.map((it, idx) => idx === i ? v : it)); setEditingIdx(null); }}
                />
              );
              if (ui) return (
                <li key={i} className="group flex gap-3 items-start rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 px-4 py-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                  <span className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${colors.number}`}>{i + 1}</span>
                  {editingIdx === i ? <div className="flex-1 min-w-0">{editor}</div> : (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                          {p.role && <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded mr-2 align-[1px] ${roleTone(p.role)}`}>Ask {p.role}</span>}
                          {kind === "assumption" && <span className="text-slate-500 dark:text-slate-400 font-normal">We assumed </span>}
                          {p.head}
                        </p>
                        {actions}
                      </div>
                      {p.why && (
                        <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {ui.whyLabel && <span className="font-semibold text-slate-600 dark:text-slate-300">{ui.whyLabel}: </span>}{p.why}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
              return (
                <li key={i} className="group flex gap-3 items-start">
                  <span className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${colors.number}`}>{i + 1}</span>
                  {editingIdx === i ? <div className="flex-1 min-w-0">{editor}</div> : (
                    <div className="flex-1 flex items-start justify-between gap-2">
                      <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{item}</span>
                      {actions}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
