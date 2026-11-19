"use client";

import { useState } from "react";
import { pdfSafe, renderMarkdownPdf } from "@/lib/pdf-text";
import ReactMarkdown from "react-markdown";
import { Copy, Check, FileText, Pencil, Loader2, RefreshCw, ExternalLink } from "lucide-react";
import MarkdownEditor from "./MarkdownEditor";
import ErrorNotice from "@/components/ErrorNotice";

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
  /** Split content by its headings and show one section at a time with a side nav. */
  sectioned?: boolean;
  /** Open straight in the editor; onEditorClose fires after save or cancel. */
  startEditing?: boolean;
  onEditorClose?: () => void;
}

/** Splits markdown at its top heading level (## or ###). Returns null when there are fewer than 3 sections. */
function splitSections(md: string): { title: string; body: string; start: number; end: number }[] | null {
  const level = /^##\s/m.test(md) ? "##" : /^###\s/m.test(md) ? "###" : null;
  if (!level) return null;
  const re = new RegExp(`^${level}\\s+(.+)$`, "gm");
  const heads = [...md.matchAll(re)];
  if (heads.length < 3) return null;
  const out: { title: string; body: string; start: number; end: number }[] = [];
  const intro = md.slice(0, heads[0].index).trim();
  if (intro) out.push({ title: "Overview", body: intro, start: 0, end: heads[0].index! });
  heads.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index! : md.length;
    out.push({ title: h[1].replace(/\*\*/g, "").trim(), body: md.slice(start, end).trim(), start, end });
  });
  return out;
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
  sectioned = false,
  startEditing = false,
  onEditorClose,
}: AnalysisCardProps) {
  const [sectionIdx, setSectionIdx]     = useState(0);
  const [copied, setCopied]             = useState(false);
  const [editing, setEditing]           = useState(startEditing);
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
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.roundedRect(margin, y, contentW, 36, 6, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(13.5);
    doc.setTextColor(255, 255, 255);
    doc.text(pdfSafe(title), margin + 14, y + 23);
    y += 50;
    y = renderMarkdownPdf(doc, content, y, { margin, contentW, pageW, pageH, lineH: PDF_LINE_H, bodySize: PDF_BODY_SZ, rgb });
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

  const sections = sectioned ? splitSections(content) : null;
  const current = sections ? Math.min(sectionIdx, sections.length - 1) : 0;
  const goSection = (i: number) => { setSectionIdx(i); setEditing(false); };

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
              onClick={() => setEditing(!editing)}
              title={editing ? "Close editor" : sections ? "Edit this section" : "Edit"}
              className={`p-1.5 rounded-lg transition-colors ${editing ? "bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300" : "text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-500/10"}`}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {postError && (
        <div className="px-6 py-2 border-b border-slate-200 dark:border-slate-700"><ErrorNotice message={postError} size="sm" /></div>
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

      {editing && !sections ? (
        <div className="px-6 py-5">
          <MarkdownEditor
            value={content}
            proseClass={PROSE}
            onCancel={() => { setEditing(false); onEditorClose?.(); }}
            onSave={(v) => { onContentChange?.(v); setEditing(false); onEditorClose?.(); }}
          />
        </div>
      ) : sections ? (
        <div className="flex flex-col md:flex-row">
          {/* Section nav: vertical on desktop, horizontal chips on mobile */}
          <nav className="md:w-56 flex-shrink-0 md:border-r border-b md:border-b-0 border-slate-100 dark:border-slate-700 p-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {sections.map((s, i) => (
              <button
                key={i}
                onClick={() => goSection(i)}
                className={`flex-shrink-0 md:w-full text-left text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  i === current
                    ? "bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <span className={`w-5 h-5 flex-shrink-0 rounded-md text-[10px] flex items-center justify-center font-semibold ${
                  i === current ? "bg-violet-600 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                }`}>{i + 1}</span>
                <span className="md:truncate">{s.title}</span>
              </button>
            ))}
          </nav>
          <div className="flex-1 min-w-0 px-6 py-5">
            <div className="group/sec flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">{sections[current].title}</h3>
              {onContentChange && !editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-slate-400 hover:text-violet-600 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-500/10 opacity-0 group-hover/sec:opacity-100 focus:opacity-100 transition-all"
                >
                  <Pencil className="w-3 h-3" /> Edit section
                </button>
              )}
            </div>
            {editing ? (
              <MarkdownEditor
                key={current}
                value={sections[current].body}
                label={sections[current].title}
                proseClass={PROSE}
                onCancel={() => setEditing(false)}
                onSave={(v) => {
                  const s = sections[current];
                  onContentChange?.(`${content.slice(0, s.start).trimEnd()}\n\n${v.trim()}\n\n${content.slice(s.end).trimStart()}`.trim());
                  setEditing(false);
                }}
              />
            ) : (
            <div key={current} className="nice-scroll max-h-[60vh] overflow-y-auto pr-3 -mr-3 animate-section-in">
              <div className={PROSE}>
                <ReactMarkdown>{sections[current].body}</ReactMarkdown>
              </div>
            </div>
            )}
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3 text-xs">
              <button
                onClick={() => goSection(current - 1)}
                disabled={current === 0}
                className="text-left text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 disabled:invisible transition-colors"
              >
                ← {current > 0 ? sections[current - 1].title : ""}
              </button>
              <span className="text-slate-400 flex-shrink-0">{current + 1} / {sections.length}</span>
              <button
                onClick={() => goSection(current + 1)}
                disabled={current === sections.length - 1}
                className="text-right text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 disabled:invisible transition-colors"
              >
                {current < sections.length - 1 ? sections[current + 1].title : ""} →
              </button>
            </div>
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
