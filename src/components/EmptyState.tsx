import { BookOpen, FlaskConical, ListChecks, CircleHelp } from "lucide-react";

const ITEMS = [
  { icon: BookOpen, label: "Explanation", hint: "what the story means, in plain words" },
  { icon: FlaskConical, label: "Scenarios", hint: "test cases designed with EP, BVA and decision tables" },
  { icon: CircleHelp, label: "Open questions", hint: "gaps and ambiguities to ask about" },
  { icon: ListChecks, label: "Checklist", hint: "track what you've tested" },
];

export default function EmptyState() {
  return (
    <div className="px-1 pt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-3">What you&apos;ll get</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {ITEMS.map(({ icon: Icon, label, hint }) => (
          <div key={label} className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700/70 bg-white/50 dark:bg-slate-800/40">
            <Icon className="w-4 h-4 text-violet-500 dark:text-violet-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-snug">{hint}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
