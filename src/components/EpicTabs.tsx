"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Copy, Database, HelpCircle, Layers, ListChecks, Loader2, Play, RotateCcw, Search, ShieldAlert, Sparkles, Wrench } from "lucide-react";
import type { EpicContext, EpicStory, StoryEntry } from "@/types";
import { epicDrift, isActiveStatus, isDoneStatus, storyProgress, strategyMarkdown, type RiskLevel, type StoryProgress } from "@/lib/epic";

// ── Small shared bits ────────────────────────────────────────────────────────

const RISK: Record<RiskLevel, string> = {
  high:   "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  low:    "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};
export function RiskPill({ level, label }: { level: RiskLevel; label?: string }) {
  return <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${RISK[level]}`}>{label ?? level}</span>;
}

export function JiraStatusPill({ status }: { status: string }) {
  const cls = isDoneStatus(status)
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : isActiveStatus(status)
      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  return <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{status}</span>;
}

function StoryChips({ keys, stories, browseBase }: { keys: string[]; stories: EpicStory[]; browseBase?: string }) {
  if (!keys.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {keys.map((k) => {
        const s = stories.find((x) => x.key === k);
        const cls = "font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300";
        return browseBase
          ? <a key={k} href={`${browseBase}/${k}`} target="_blank" rel="noopener noreferrer" title={s?.summary} className={cls + " hover:bg-violet-200 dark:hover:bg-violet-500/25"}>{k}</a>
          : <span key={k} title={s?.summary} className={cls}>{k}</span>;
      })}
    </span>
  );
}

function Card({ icon, title, count, children, className = "" }: { icon: React.ReactNode; title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 ${className}`}>
      <h3 className="flex items-center gap-2 px-4 pt-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon} {title}{count !== undefined && <span className="ml-1 text-slate-400 font-normal normal-case tracking-normal">({count})</span>}
      </h3>
      <div className="px-4 pb-4">{children}</div>
    </section>
  );
}

function Bullets({ items, empty = "Nothing noted." }: { items: React.ReactNode[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-slate-400 italic">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          <span className="mt-2 w-1 h-1 rounded-full bg-violet-400 flex-shrink-0" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function NeedsAnalysis({ onAnalyze, busy }: { onAnalyze: () => void; busy: boolean }) {
  return (
    <div className="text-center py-12 px-6">
      <Sparkles className="w-9 h-9 mx-auto text-violet-400 mb-3" />
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Not analyzed yet</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">Analyze the epic to get its overview, story dependencies and a cross-story test strategy.</p>
      <button onClick={onAnalyze} disabled={busy} className="mt-4 inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50">
        <Sparkles className="w-4 h-4" /> Analyze epic
      </button>
    </div>
  );
}

const browseBase = (epic: EpicContext) => epic.browseUrl?.replace(/\/[^/]+$/, "");

// ── Overview ─────────────────────────────────────────────────────────────────

export function OverviewTab({ epic }: { epic: EpicContext }) {
  const a = epic.analysis!;
  const stories = epic.stories ?? [];
  const base = browseBase(epic);
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50/40 dark:from-violet-500/10 dark:to-indigo-500/5 border border-violet-200/70 dark:border-violet-500/20 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300 mb-1">Epic goal</p>
        <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">{a.goal}</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card icon={<Layers className="w-3.5 h-3.5" />} title="In scope" count={a.scope.length}><Bullets items={a.scope} /></Card>
        <Card icon={<Layers className="w-3.5 h-3.5 opacity-50" />} title="Out of scope" count={a.outOfScope.length}><Bullets items={a.outOfScope} empty="Not stated." /></Card>
      </div>
      <Card icon={<ShieldAlert className="w-3.5 h-3.5" />} title="Business rules" count={a.businessRules.length}>
        <Bullets items={a.businessRules.map((r) => <>{r.rule} <StoryChips keys={r.stories} stories={stories} browseBase={base} /></>)} />
      </Card>
      <Card icon={<Database className="w-3.5 h-3.5" />} title="Data & entities" count={a.dataEntities.length}>
        {a.dataEntities.length ? (
          <div className="grid sm:grid-cols-2 gap-2">
            {a.dataEntities.map((d) => (
              <div key={d.name} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <p className="font-mono text-xs font-semibold text-slate-800 dark:text-slate-100">{d.name}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{d.notes}</p>
                <div className="mt-1.5"><StoryChips keys={d.stories} stories={stories} browseBase={base} /></div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-400 italic">Nothing noted.</p>}
      </Card>
    </div>
  );
}

// ── Stories ──────────────────────────────────────────────────────────────────

type Filter = "all" | "not-analyzed" | "testing" | "failed" | "passed" | "changed";

function ProgressCell({ p }: { p: StoryProgress }) {
  if (!p.analyzed) return <span className="text-[11px] text-slate-400">Not analyzed</span>;
  if (!p.total) return <span className="text-[11px] text-slate-500">Analyzed</span>;
  const pct = (n = 0) => `${(n / p.total) * 100}%`;
  const done = p.total - (p.counts.pending ?? 0);
  return (
    <div className="w-28">
      <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
        <span className="bg-emerald-500" style={{ width: pct(p.counts.passed) }} />
        <span className="bg-red-500" style={{ width: pct(p.counts.failed) }} />
        <span className="bg-purple-500" style={{ width: pct(p.counts.blocked) }} />
        <span className="bg-amber-400" style={{ width: pct(p.counts.clarification) }} />
        <span className="bg-slate-400" style={{ width: pct(p.counts.na) }} />
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
        {done}/{p.total} checked{p.counts.failed ? <span className="text-red-600 dark:text-red-400 font-semibold"> · {p.counts.failed} failed</span> : null}
      </p>
    </div>
  );
}

export function StoriesTab({ epic, entries, analyzingKeys, onOpenStory, onAnalyzeStory }: {
  epic: EpicContext;
  entries: StoryEntry[];
  analyzingKeys: string[];
  onOpenStory: (entryId: string) => void;
  onAnalyzeStory: (key: string) => Promise<string | null>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string | null>(null);
  const stories = epic.stories ?? [];
  const notes = new Map((epic.analysis?.storyNotes ?? []).map((n) => [n.key, n]));
  const drift = epicDrift(epic);
  const base = browseBase(epic);

  const rows = useMemo(() => stories.map((s) => ({ s, p: storyProgress(s.key, entries), n: notes.get(s.key) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stories, entries, epic.analysis]);

  const count = (f: Filter) => rows.filter((r) => matches(r.s.key, r.p, f)).length;
  function matches(key: string, p: StoryProgress, f: Filter) {
    switch (f) {
      case "all": return true;
      case "not-analyzed": return !p.analyzed;
      case "testing": return p.state === "testing" || p.state === "analyzed";
      case "failed": return p.state === "failed";
      case "passed": return p.state === "passed";
      case "changed": return drift.added.includes(key) || drift.changed.includes(key);
    }
  }
  const shown = rows.filter((r) => matches(r.s.key, r.p, filter) && (!q || `${r.s.key} ${r.s.summary} ${r.s.assignee ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  const FILTERS: { id: Filter; label: string; tone: string }[] = [
    { id: "all", label: "All", tone: "" },
    { id: "not-analyzed", label: "Not analyzed", tone: "" },
    { id: "testing", label: "In testing", tone: "" },
    { id: "failed", label: "Failed", tone: "text-red-600 dark:text-red-400" },
    { id: "passed", label: "Passed", tone: "text-emerald-600 dark:text-emerald-400" },
    ...(drift.added.length || drift.changed.length ? [{ id: "changed" as Filter, label: "New / changed", tone: "text-amber-600 dark:text-amber-400" }] : []),
  ];

  const analyze = async (key: string) => {
    setStarting(key);
    setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
    const err = await onAnalyzeStory(key);
    if (err) setErrors((e) => ({ ...e, [key]: err }));
    setStarting(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${filter === f.id
                ? "bg-violet-600 border-violet-600 text-white"
                : `border-slate-200 dark:border-slate-600 hover:border-violet-300 ${f.tone || "text-slate-600 dark:text-slate-300"}`}`}>
              {f.label} <span className="opacity-70">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stories" className="w-40 text-xs bg-transparent focus:outline-none text-slate-700 dark:text-slate-200" />
        </div>
      </div>

      <div className="nice-scroll max-h-[60vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700/60">
        {shown.length === 0 && <p className="px-4 py-6 text-sm text-center text-slate-400">No stories match.</p>}
        {shown.map(({ s, p, n }) => {
          const isNew = drift.added.includes(s.key), isChanged = drift.changed.includes(s.key);
          const busy = analyzingKeys.includes(s.key) || starting === s.key;
          return (
            <div key={s.key} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-700/20">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {base
                    ? <a href={`${base}/${s.key}`} target="_blank" rel="noopener noreferrer" className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-300 hover:underline">{s.key}</a>
                    : <span className="font-mono text-xs font-semibold text-violet-600 dark:text-violet-300">{s.key}</span>}
                  {s.type && s.type !== "Story" && <span className="text-[10px] text-slate-500 dark:text-slate-400">{s.type}</span>}
                  <JiraStatusPill status={s.status} />
                  {n && <RiskPill level={n.risk} label={`${n.risk} risk`} />}
                  {isNew && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">NEW</span>}
                  {isChanged && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300">CHANGED</span>}
                </div>
                <p className="text-sm text-slate-800 dark:text-slate-100 mt-0.5">{s.summary}</p>
                {n?.role && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{n.role}{n.riskReason ? <span className="text-slate-400"> · {n.riskReason}</span> : null}</p>}
                {(n?.dependsOn.length || s.assignee) ? (
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-slate-400">
                    {!!n?.dependsOn.length && <span className="flex items-center gap-1">Depends on <StoryChips keys={n.dependsOn} stories={stories} browseBase={base} /></span>}
                    {s.assignee && <span>· {s.assignee}</span>}
                  </div>
                ) : null}
                {errors[s.key] && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errors[s.key]}</p>}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 pt-0.5">
                <ProgressCell p={p} />
                {busy ? (
                  <span className="w-24 flex items-center justify-center gap-1.5 text-xs text-violet-600 dark:text-violet-300"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing</span>
                ) : p.entryId ? (
                  <button onClick={() => onOpenStory(p.entryId!)} className="w-24 flex items-center justify-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-violet-400 hover:text-violet-700 dark:hover:text-violet-300">
                    Open <ArrowRight className="w-3 h-3" />
                  </button>
                ) : (
                  <button onClick={() => analyze(s.key)} className="w-24 flex items-center justify-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white">
                    <Play className="w-3 h-3" /> Analyze
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Test strategy ────────────────────────────────────────────────────────────

export function StrategyTab({ epic }: { epic: EpicContext }) {
  const a = epic.analysis!;
  const stories = epic.stories ?? [];
  const base = browseBase(epic);
  const [open, setOpen] = useState<Set<string>>(() => new Set(a.e2eScenarios.slice(0, 1).map((s) => s.id)));
  const [copied, setCopied] = useState(false);
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-500 dark:text-slate-400">Flows and risks that cross stories — the things single-story testing misses.</p>
        <button
          onClick={async () => { await navigator.clipboard.writeText(strategyMarkdown(epic)); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-violet-400 flex-shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "Copied" : "Copy as Markdown"}
        </button>
      </div>

      <Card icon={<ListChecks className="w-3.5 h-3.5" />} title="End-to-end scenarios" count={a.e2eScenarios.length}>
        <div className="space-y-2">
          {a.e2eScenarios.length === 0 && <p className="text-sm text-slate-400 italic">None suggested.</p>}
          {a.e2eScenarios.map((s) => {
            const isOpen = open.has(s.id);
            return (
              <div key={s.id} className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                <button onClick={() => toggle(s.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 flex-shrink-0">{s.id}</span>
                  <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100">{s.title}</span>
                  <span className="hidden sm:inline"><StoryChips keys={s.stories} stories={stories} /></span>
                  <RiskPill level={s.priority} />
                  <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 grid md:grid-cols-[1fr_minmax(0,0.8fr)] gap-4 animate-section-in">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Steps</p>
                      <ol className="space-y-1.5">
                        {s.steps.map((st, i) => (
                          <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-200">
                            <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                            <span>{st}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">Expected</p>
                      <Bullets items={s.expected} />
                      <div className="mt-3 sm:hidden"><StoryChips keys={s.stories} stories={stories} browseBase={base} /></div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card icon={<AlertTriangle className="w-3.5 h-3.5" />} title="Integration risks" count={a.integrationRisks.length}>
          <div className="space-y-2.5">
            {a.integrationRisks.length === 0 && <p className="text-sm text-slate-400 italic">None found.</p>}
            {a.integrationRisks.map((r, i) => (
              <div key={i}>
                <div className="flex items-center gap-2 flex-wrap"><RiskPill level={r.severity} /><span className="text-sm font-medium text-slate-800 dark:text-slate-100">{r.title}</span></div>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{r.why}</p>
                <div className="mt-1"><StoryChips keys={r.stories} stories={stories} browseBase={base} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card icon={<HelpCircle className="w-3.5 h-3.5" />} title="Questions for BA" count={a.questions.length}>
          <Bullets items={a.questions.map((x) => <>{x.question} <StoryChips keys={x.stories} stories={stories} browseBase={base} /></>)} empty="No open questions." />
        </Card>
        <Card icon={<RotateCcw className="w-3.5 h-3.5" />} title="Regression" count={a.regression.length}><Bullets items={a.regression} /></Card>
        <Card icon={<Wrench className="w-3.5 h-3.5" />} title="Before testing" count={a.prerequisites.length}><Bullets items={a.prerequisites} /></Card>
      </div>
    </div>
  );
}

// ── AI context ───────────────────────────────────────────────────────────────

export function ContextTab({ epic }: { epic: EpicContext }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Added automatically when you analyze any story whose Jira parent is <span className="font-mono">{epic.epicKey}</span>, so the AI knows the rest of the epic.
      </p>
      <pre className="nice-scroll text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50 rounded-xl p-4 whitespace-pre-wrap max-h-[60vh] overflow-y-auto border border-slate-200 dark:border-slate-700">
        {epic.contextBlock}
      </pre>
    </div>
  );
}
