import { BookOpen } from "lucide-react";

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-violet-100 flex items-center justify-center mb-6 shadow-inner">
        <BookOpen className="w-10 h-10 text-violet-500" />
      </div>
      <h2 className="text-2xl font-bold text-slate-800 mb-3">Analyze your story</h2>
      <p className="text-slate-500 max-w-md leading-relaxed text-sm">
        Paste a Jira story, user story, or requirement above. StoryAnalyzer will generate a
        QA breakdown with a story explanation, desk-check scenarios, and test suggestions.
      </p>
      <div className="mt-8 grid grid-cols-3 gap-4 w-full max-w-sm">
        {[
          { icon: "📖", label: "Story Explanation" },
          { icon: "🔍", label: "Desk Check Scenarios" },
          { icon: "🧪", label: "Test Suggestions" },
        ].map(({ icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <span className="text-2xl">{icon}</span>
            <span className="text-xs text-slate-500 text-center leading-tight">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
