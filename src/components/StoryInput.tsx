"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Sparkles, X, Hash } from "lucide-react";

interface StoryInputProps {
  onAnalyze: (text: string) => Promise<void>;
  isLoading: boolean;
  initialValue?: string;
}

export default function StoryInput({ onAnalyze, isLoading, initialValue = "" }: StoryInputProps) {
  const [text, setText] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(initialValue);
  }, [initialValue]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(200, el.scrollHeight)}px`;
  }, [text]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim() && !isLoading) onAnalyze(text);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <label htmlFor="story-textarea" className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Paste your story / requirement
        </label>
        {text.length > 0 && (
          <button
            type="button"
            onClick={() => setText("")}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </button>
        )}
      </div>

      <textarea
        id="story-textarea"
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="As a user, I want to… / Given… When… Then… / AC: …&#10;&#10;Paste your full Jira story, acceptance criteria, or requirement text here."
        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all leading-relaxed min-h-[200px]"
        style={{ overflow: "hidden" }}
        disabled={isLoading}
      />

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Hash className="w-3.5 h-3.5" />
          <span>{text.length.toLocaleString()} characters</span>
          {text.length > 0 && (
            <>
              <span className="mx-1">·</span>
              <span>{text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={!text.trim() || isLoading}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium py-2.5 px-6 rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95 text-sm"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Analyze Story
            </>
          )}
        </button>
      </div>
    </form>
  );
}
