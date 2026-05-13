"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check, FileText } from "lucide-react";

interface AnalysisCardProps {
  title: string;
  content: string;
  accentColor?: string;
}

export default function AnalysisCard({ title, content, accentColor = "violet" }: AnalysisCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([`# ${title}\n\n${content}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accentBorderMap: Record<string, string> = {
    violet: "border-violet-400",
    blue: "border-blue-400",
    emerald: "border-emerald-400",
  };
  const accentBarMap: Record<string, string> = {
    violet: "bg-violet-500",
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
  };
  const borderClass = accentBorderMap[accentColor] ?? accentBorderMap.violet;
  const barClass = accentBarMap[accentColor] ?? accentBarMap.violet;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Card header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b ${borderClass} border-opacity-30 bg-gradient-to-r from-white to-slate-50`}>
        <div className="flex items-center gap-2.5">
          <div className={`w-2 h-6 rounded-full ${barClass}`} />
          <h2 className="font-bold text-slate-800 text-base">{title}</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
            title="Export as Markdown"
          >
            <FileText className="w-3.5 h-3.5" />
            Export
          </button>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all ${
              copied
                ? "bg-green-100 text-green-700"
                : "text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200"
            }`}
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Markdown content */}
      <div className="px-6 py-5 prose prose-sm max-w-none prose-headings:text-slate-800 prose-headings:font-semibold prose-h2:text-sm prose-h2:uppercase prose-h2:tracking-wide prose-h2:text-violet-700 prose-h2:border-b prose-h2:border-slate-100 prose-h2:pb-1 prose-h2:mt-5 prose-h2:mb-3 prose-p:text-slate-600 prose-li:text-slate-600 prose-strong:text-slate-800 prose-code:text-violet-700 prose-code:bg-violet-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
