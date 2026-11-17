"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Bold, Check, Heading3, Italic, List, ListOrdered, X } from "lucide-react";

interface Props {
  value: string;
  label?: string;
  proseClass?: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}

/** Friendly markdown editor: toolbar, write/preview, auto-grow, Ctrl+Enter to save, Esc to cancel. */
export default function MarkdownEditor({ value, label, proseClass = "", onSave, onCancel }: Props) {
  const [text, setText] = useState(value);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = text.trim() !== value.trim();

  const grow = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 640)}px`;
  };

  useEffect(() => {
    if (tab !== "write") return;
    grow();
    const el = ref.current;
    if (el && document.activeElement !== el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [tab]);

  const apply = (next: string, selStart: number, selEnd: number) => {
    setText(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
      grow();
    });
  };

  const wrap = (mark: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = text.slice(s, e) || "text";
    apply(text.slice(0, s) + mark + sel + mark + text.slice(e), s + mark.length, s + mark.length + sel.length);
  };

  const prefixLines = (kind: "ul" | "ol" | "h") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const lineStart = text.lastIndexOf("\n", s - 1) + 1;
    const nl = text.indexOf("\n", e);
    const lineEnd = nl === -1 ? text.length : nl;
    const lines = text.slice(lineStart, lineEnd).split("\n");
    const out = lines.map((l, i) => {
      const bare = l.replace(/^(\s*)([-*•]\s+|\d+\.\s+|#{1,6}\s+)/, "$1");
      if (kind === "ul") return `- ${bare}`;
      if (kind === "ol") return `${i + 1}. ${bare}`;
      return `### ${bare}`;
    }).join("\n");
    apply(text.slice(0, lineStart) + out + text.slice(lineEnd), lineStart, lineStart + out.length);
  };

  const save = () => onSave(text.trim() || value);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); return; }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("**"); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("*"); return; }
    // Continue lists on Enter
    if (e.key === "Enter" && !e.shiftKey) {
      const el = e.currentTarget;
      const s = el.selectionStart;
      const lineStart = text.lastIndexOf("\n", s - 1) + 1;
      const line = text.slice(lineStart, s);
      const m = line.match(/^(\s*)([-*•]|\d+\.)\s+(.*)$/);
      if (m) {
        e.preventDefault();
        if (!m[3].trim()) {
          apply(text.slice(0, lineStart) + text.slice(s), lineStart, lineStart);
          return;
        }
        const marker = /\d+\./.test(m[2]) ? `${parseInt(m[2]) + 1}.` : m[2];
        const ins = `\n${m[1]}${marker} `;
        apply(text.slice(0, s) + ins + text.slice(el.selectionEnd), s + ins.length, s + ins.length);
      }
    }
  };

  const tool = "w-7 h-7 rounded-md flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-100 transition-colors disabled:opacity-40";

  return (
    <div className="rounded-xl border border-violet-300 dark:border-violet-500/40 bg-white dark:bg-slate-900/40 shadow-sm ring-4 ring-violet-500/5 overflow-hidden animate-section-in">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
        <div className="flex items-center gap-1">
          <div className="flex items-center p-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-900/60 mr-1.5">
            {(["write", "preview"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs px-2.5 py-1 rounded-md capitalize transition-colors ${
                  tab === t ? "bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm font-medium" : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <button className={tool} disabled={tab !== "write"} onClick={() => wrap("**")} title="Bold (Ctrl+B)"><Bold className="w-3.5 h-3.5" /></button>
          <button className={tool} disabled={tab !== "write"} onClick={() => wrap("*")} title="Italic (Ctrl+I)"><Italic className="w-3.5 h-3.5" /></button>
          <button className={tool} disabled={tab !== "write"} onClick={() => prefixLines("h")} title="Sub-heading"><Heading3 className="w-3.5 h-3.5" /></button>
          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
          <button className={tool} disabled={tab !== "write"} onClick={() => prefixLines("ul")} title="Bullet list"><List className="w-3.5 h-3.5" /></button>
          <button className={tool} disabled={tab !== "write"} onClick={() => prefixLines("ol")} title="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></button>
        </div>
        {label && <span className="text-[11px] font-medium text-violet-600 dark:text-violet-300 truncate pr-1">Editing: {label}</span>}
      </div>

      {/* Body */}
      {tab === "write" ? (
        <textarea
          ref={ref}
          value={text}
          onChange={e => { setText(e.target.value); grow(); }}
          onKeyDown={onKey}
          spellCheck
          className="block w-full min-h-[180px] resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          placeholder="Write here… use the toolbar for bold and lists."
        />
      ) : (
        <div className={`px-4 py-3 min-h-[180px] ${proseClass}`}>
          {text.trim() ? <ReactMarkdown>{text}</ReactMarkdown> : <p className="text-sm text-slate-400">Nothing to preview.</p>}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40">
        <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
          <kbd className="font-sans px-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Ctrl</kbd>+<kbd className="font-sans px-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Enter</kbd> save ·{" "}
          <kbd className="font-sans px-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Esc</kbd> cancel
        </span>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={onCancel} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="flex items-center gap-1 text-xs font-medium px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5" /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
