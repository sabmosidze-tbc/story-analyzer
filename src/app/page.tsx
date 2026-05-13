"use client";

import { useState, useCallback } from "react";
import { useHistory } from "@/hooks/useHistory";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import StoryInput from "@/components/StoryInput";
import AnalysisCard from "@/components/AnalysisCard";
import EmptyState from "@/components/EmptyState";
import { Analysis } from "@/types";
import { Copy, Check, Download } from "lucide-react";

export default function Home() {
  const { entries, addEntry, removeEntry, renameEntry, getEntry } = useHistory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<Analysis | null>(null);
  const [currentStory, setCurrentStory] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [allCopied, setAllCopied] = useState(false);

  const handleSelect = useCallback(
    (id: string) => {
      const entry = getEntry(id);
      if (entry) {
        setSelectedId(id);
        setCurrentAnalysis(entry.analysis);
        setCurrentStory(entry.storyText);
        setError(null);
        setSidebarOpen(false);
      }
    },
    [getEntry]
  );

  const handleNew = useCallback(() => {
    setSelectedId(null);
    setCurrentAnalysis(null);
    setCurrentStory("");
    setError(null);
    setSidebarOpen(false);
  }, []);

  const handleAnalyze = useCallback(
    async (text: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ story: text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Analysis failed");
        }
        const analysis: Analysis = await res.json();
        const entry = addEntry(text, analysis);
        setCurrentAnalysis(analysis);
        setCurrentStory(text);
        setSelectedId(entry.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setIsLoading(false);
      }
    },
    [addEntry]
  );

  const handleCopyAll = async () => {
    if (!currentAnalysis) return;
    const all = [
      `# ${currentAnalysis.explanation.title}\n\n${currentAnalysis.explanation.content}`,
      `# ${currentAnalysis.deskCheck.title}\n\n${currentAnalysis.deskCheck.content}`,
      `# ${currentAnalysis.testSuggestions.title}\n\n${currentAnalysis.testSuggestions.content}`,
    ].join("\n\n---\n\n");
    await navigator.clipboard.writeText(all);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const handleExportAll = () => {
    if (!currentAnalysis) return;
    const content = [
      `# ${currentAnalysis.explanation.title}\n\n${currentAnalysis.explanation.content}`,
      `# ${currentAnalysis.deskCheck.title}\n\n${currentAnalysis.deskCheck.content}`,
      `# ${currentAnalysis.testSuggestions.title}\n\n${currentAnalysis.testSuggestions.content}`,
    ].join("\n\n---\n\n");
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "story-analysis.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar
        entries={entries}
        selectedId={selectedId}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={renameEntry}
        onDelete={(id) => {
          removeEntry(id);
          if (selectedId === id) handleNew();
        }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuOpen={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
          {/* Input area */}
          <StoryInput
            onAnalyze={handleAnalyze}
            isLoading={isLoading}
            initialValue={currentStory}
          />

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* Analysis results */}
          {currentAnalysis ? (
            <>
              {/* Action bar */}
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-bold text-slate-800">Analysis Results</h1>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyAll}
                    className={`flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg transition-all ${
                      allCopied
                        ? "bg-green-100 text-green-700 border border-green-200"
                        : "bg-white text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {allCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {allCopied ? "Copied!" : "Copy All"}
                  </button>
                  <button
                    onClick={handleExportAll}
                    className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg bg-white text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export .md
                  </button>
                </div>
              </div>

              <AnalysisCard
                title={currentAnalysis.explanation.title}
                content={currentAnalysis.explanation.content}
                accentColor="violet"
              />
              <AnalysisCard
                title={currentAnalysis.deskCheck.title}
                content={currentAnalysis.deskCheck.content}
                accentColor="blue"
              />
              <AnalysisCard
                title={currentAnalysis.testSuggestions.title}
                content={currentAnalysis.testSuggestions.content}
                accentColor="emerald"
              />
            </>
          ) : (
            !isLoading && <EmptyState />
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center">
                <svg className="animate-spin w-6 h-6 text-violet-600" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              </div>
              <p className="text-slate-500 text-sm">Analyzing your story…</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
