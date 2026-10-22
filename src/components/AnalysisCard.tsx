"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check, FileText, Pencil, Loader2, RefreshCw, ExternalLink, X } from "lucide-react";

const PDF_MARGIN   = 48;
const PDF_LINE_H   = 14;
const PDF_BODY_SZ  = 9;

interface AnalysisCardProps {
  title: string;
  content: string;
  accentColor?: string;
  isLoading?: boolean;
  jiraKey?: string;
  postedFingerprint?: string;
  onPosted?: (fp: string) => void;
  onContentChange?: (c: string) => void;
  onTitleChange?: (t: string) => void;
  onRegenerate?: () => Promise<void>;
  isRegenerating?: boolean;
}

function fp(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

export default function AnalysisCard({
  title,
  content,
  accentColor = "violet",
  isLoading = false,
  jiraKey,
  postedFingerprint,
  onPosted,
  onContentChange,
  onTitleChange,
  onRegenerate,
  isRegenerating = false,
}: AnalysisCardProps) {
  const [copied, setCopied]             = useState(false);
  const [editing, setEditing]           = useState(false);
  const [editValue, setEditValue]       = useState(content);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue]     = useState(title);
  const [posting, setPosting]           = useState(false);
  const [postError, setPostError]       = useState<string | null>(null);

  const isAlreadyPosted = !!postedFingerprint && postedFingerprint === fp(title + content);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const rgbMap: Record<string, [number, number, number]> = {
      violet:  [124, 58, 237],
      blue:    [37, 99, 235],
      emerald: [5, 150, 105],
    };
    const rgb      = rgbMap[accentColor] ?? rgbMap.violet;
    const doc      = new jsPDF({ unit: "pt", format: "a4" });
    const pageW    = doc.internal.pageSize.getWidth();
    const pageH    = doc.internal.pageSize.getHeight();
    const margin   = PDF_MARGIN;
    const contentW = pageW - margin * 2;
    let y = 64;
    const checkPage = (needed: number) => {
      if (y + needed > pageH - 56) { doc.addPage(); y = 56; }
    };
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(margin, y, contentW, 36, 6, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(13.5);
    doc.setTextColor(255, 255, 255);
    doc.text(title, margin + 14, y + 23);
    y += 50;
    for (const rawLine of content.split("\n")) {
      const headingMatch  = rawLine.match(/^#{1,6}\s+(.+)/);
      const bulletMatch   = rawLine.match(/^[-*]\s+(.+)/);
      const numberedMatch = rawLine.match(/^(\d+)\.\s+(.+)/);
      if (!rawLine.trim()) { y += 5; continue; }
      if (headingMatch) {
        checkPage(32); y += 10;
        const headText = headingMatch[1].replace(/\*\*(.*?)\*\*/g, "$1");
        doc.setFillColor(rgb[0], rgb[1], rgb[2]);
        doc.rect(margin, y - 10, 3.5, 14, "F");
        doc.setFont("helvetica", "bold"); doc.setFontSize(10);
        doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        const wh = doc.splitTextToSize(headText.toUpperCase(), contentW - 20);
        doc.text(wh, margin + 10, y);
        y += wh.length * PDF_LINE_H + 4;
        doc.setDrawColor(rgb[0], rgb[1], rgb[2]); doc.setLineWidth(0.3);
        doc.line(margin + 10, y - 2, pageW - margin, y - 2);
        y += 8; doc.setTextColor(51, 65, 85); continue;
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(PDF_BODY_SZ); doc.setTextColor(51, 65, 85);
      if (bulletMatch) {
        const t  = bulletMatch[1].replace(/\*\*(.*?)\*\*/g, "$1");
        const wb = doc.splitTextToSize(t, contentW - 28);
        checkPage(wb.length * PDF_LINE_H + 4);
        doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.circle(margin + 10, y - 3.5, 2.5, "F");
        doc.text(wb, margin + 20, y); y += wb.length * PDF_LINE_H; continue;
      }
      if (numberedMatch) {
        const num = numberedMatch[1];
        const t   = numberedMatch[2].replace(/\*\*(.*?)\*\*/g, "$1");
        const wn  = doc.splitTextToSize(t, contentW - 28);
        checkPage(wn.length * PDF_LINE_H + 4);
        doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
        doc.setTextColor(rgb[0], rgb[1], rgb[2]); doc.text(`${num}.`, margin + 8, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(PDF_BODY_SZ); doc.setTextColor(51, 65, 85);
        doc.text(wn, margin + 24, y); y += wn.length * PDF_LINE_H; continue;
      }
      const t  = rawLine.replace(/\*\*(.*?)\*\*/g, "$1");
      const wp = doc.splitTextToSize(t, contentW - 12);
      checkPage(wp.length * PDF_LINE_H + 2);
      doc.text(wp, margin + 6, y); y += wp.length * PDF_LINE_H + 3;
    }
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(148, 163, 184);
      doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.5);
      doc.line(margin, pageH - 30, pageW - margin, pageH - 30);
      doc.text(`${i} / ${pageCount}`, pageW - margin, pageH - 17, { align: "right" });
      doc.text("Story Analyzer", margin, pageH - 17);
    }
    doc.save(`${title.toLowerCase().replace(/\s+/g, "-")}.pdf`);
  };

  const handlePostToJira = async () => {
    if (!jiraKey || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: jiraKey, title, content }),
      });
      const data = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) throw new Error((data.error as string) ?? "Failed to post to Jira");
      onPosted?.(fp(title + content));
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const accentBorderMap: Record<string, string> = {
    violet:  "border-violet-400",
    blue:    "border-blue-400",
    emerald: "border-emerald-400",
  };
  const accentBarMap: Record<string, string> = {
    violet:  "bg-violet-500",
    blue:    "bg-blue-500",
    emerald: "bg-emerald-500",
  };
  const borderClass = accentBorderMap[accentColor] ?? accentBorderMap.violet;
  const barClass    = accentBarMap[accentColor]    ?? accentBarMap.violet;

  const PROSE = "prose prose-sm max-w-none prose-headings:text-slate-800 dark:prose-headings:text-slate-100 prose-headings:font-semibold prose-h2:text-sm prose-h2:uppercase prose-h2:tracking-wide prose-h2:text-violet-700 dark:prose-h2:text-violet-400 prose-h2:border-b prose-h2:border-slate-100 dark:prose-h2:border-slate-600 prose-h2:pb-1 prose-h2:mt-5 prose-h2:mb-3 prose-h3:text-slate-700 dark:prose-h3:text-slate-200 prose-h4:text-slate-700 dark:prose-h4:text-slate-200 prose-p:text-slate-600 dark:prose-p:text-slate-300 prose-li:text-slate-600 dark:prose-li:text-slate-300 prose-strong:text-slate-800 dark:prose-strong:text-slate-100 prose-code:text-violet-700 dark:prose-code:text-violet-300 prose-code:bg-violet-50 dark:prose-code:bg-violet-900/30 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-blockquote:text-slate-500 dark:prose-blockquote:text-slate-400 prose-blockquote:border-slate-300 dark:prose-blockquote:border-slate-600";

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* Card header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b ${borderClass} border-opacity-30 bg-gradient-to-r from-white dark:from-slate-800 to-slate-50 dark:to-slate-700`}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`w-2 h-6 rounded-full flex-shrink-0 ${barClass}`} />
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={e => setTitleValue(e.target.value)}
              onBlur={() => {
                setEditingTitle(false);
                if (titleValue.trim()) onTitleChange?.(titleValue.trim()); else setTitleValue(title);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") { setEditingTitle(false); if (titleValue.trim()) onTitleChange?.(titleValue.trim()); else setTitleValue(title); }
                if (e.key === "Escape") { setEditingTitle(false); setTitleValue(title); }
              }}
              className="font-bold text-slate-800 dark:text-slate-100 text-base bg-transparent border-b-2 border-violet-400 focus:outline-none min-w-0 flex-1"
            />
          ) : onTitleChange ? (
            <h2
              className="font-bold text-slate-800 dark:text-slate-100 text-base cursor-pointer hover:text-violet-600 transition-colors border-b border-transparent hover:border-violet-400"
              onClick={() => { setEditingTitle(true); setTitleValue(title); }}
            >{title}</h2>
          ) : (
            <h2 className="font-bold text-slate-800 dark:text-slate-100 text-base">{title}</h2>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          {onRegenerate && (
            <button onClick={onRegenerate} disabled={isRegenerating || isLoading}
              className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 bg-slate-100 dark:bg-slate-700 hover:bg-violet-50 dark:hover:bg-violet-900/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
              {isRegenerating ? "Regenerating…" : "Regenerate"}
            </button>
          )}

          {jiraKey && onPosted && (
            <button onClick={handlePostToJira} disabled={posting || isAlreadyPosted}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors ${
                isAlreadyPosted ? "bg-slate-100 text-slate-400 cursor-default"
                  : posting ? "bg-slate-100 text-slate-400"
                  : "text-slate-500 dark:text-slate-400 hover:text-blue-600 bg-slate-100 dark:bg-slate-700 hover:bg-blue-50"
              }`}>
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
              {isAlreadyPosted ? "Posted" : posting ? "Posting…" : "Post to Jira"}
            </button>
          )}

          <button onClick={handleExportPDF}
            className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors">
            <FileText className="w-3.5 h-3.5" /> PDF
          </button>

          <button onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
              copied ? "bg-green-100 text-green-700" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600"
            }`}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>

          {onContentChange && (
            <button
              onClick={() => { if (editing) { setEditing(false); setEditValue(content); } else { setEditing(true); setEditValue(content); } }}
              className={`p-1.5 rounded-lg transition-colors ${editing ? "text-red-500 hover:bg-red-50" : "text-slate-400 hover:text-violet-600 hover:bg-violet-50"}`}>
              {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {postError && (
        <div className="px-6 py-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-xs text-red-600">{postError}</div>
      )}

      {isLoading && (
        <div className="px-6 pt-4 pb-1 flex items-center gap-2 text-xs text-slate-400">
          <span className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
          Generating…
        </div>
      )}

      {editing ? (
        <div className="px-6 py-5">
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="w-full text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-violet-400 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono min-h-[200px] leading-relaxed"
            rows={14}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={() => { onContentChange?.(editValue.trim() || content); setEditing(false); }}
              className="flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg transition-colors">
              <Check className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={() => { setEditing(false); setEditValue(content); }}
              className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={`px-6 py-5 ${PROSE}`}>
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
