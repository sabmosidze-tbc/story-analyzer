"use client";

import { useState, useMemo, useRef } from "react";
import { Copy, Check, Download, Send, Loader2, AlertCircle, Pencil, Trash2 } from "lucide-react";

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
  const [editValue, setEditValue] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(title);
  const colors = colorMaps[accentColor];

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
    doc.text(title, margin + 14, y + 21);
    y += 44;
    items.forEach((item, i) => {
      const txt = item.replace(/\*\*(.*?)\*\*/g, "$1");
      const wrapped = doc.splitTextToSize(txt, contentW - 30);
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
                  ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
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

      {/* Items list */}
      <div className="px-6 py-5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500 italic">{emptyMessage}</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="group flex gap-3 items-start">
                <span
                  className={`flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center mt-0.5 ${colors.number}`}
                >
                  {i + 1}
                </span>
                {editingIdx === i ? (
                  <div className="flex-1 flex flex-col gap-2">
                    <textarea
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      rows={Math.max(2, Math.ceil(editValue.length / 80))}
                      className="w-full text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-violet-500 leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const newItems = items.map((it, idx) => idx === i ? editValue.trim() || it : it);
                          onItemsChange?.(newItems);
                          setEditingIdx(null);
                        }}
                        className="text-xs px-3 py-1 bg-violet-500 hover:bg-violet-600 text-white rounded-lg transition-colors"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingIdx(null)}
                        className="text-xs px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-start justify-between gap-2">
                    <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">
                      {item}
                    </span>
                    {onItemsChange && (
                      <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => { setEditingIdx(i); setEditValue(item); }}
                          title="Edit this item"
                          className="p-1 rounded text-slate-400 hover:text-violet-500 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onItemsChange(items.filter((_, idx) => idx !== i))}
                          title="Delete this item"
                          className="p-1 rounded text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
