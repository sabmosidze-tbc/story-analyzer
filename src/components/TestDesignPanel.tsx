"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Check, ChevronRight, CircleHelp, FlaskConical, Loader2, RefreshCw, Sparkles, X,
} from "lucide-react";
import {
  TECHNIQUE_LABEL, OUTCOME_LABEL, OUTCOME_HINT, modelItems, checkDecisionTable, demoteFakeTransitions,
  type Gap, type Scenario, type TestDesign, type Technique, type Outcome,
} from "@/lib/test-design";

const TECH_ORDER: Technique[] = ["EP", "BVA", "DT", "ST"];
const TECH_TEXT: Record<Technique, string> = {
  EP: "text-sky-600 dark:text-sky-400",
  BVA: "text-violet-600 dark:text-violet-400",
  DT: "text-amber-600 dark:text-amber-400",
  ST: "text-teal-600 dark:text-teal-400",
};

const card = "bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700";

function OutcomeIcon({ outcome, className = "w-3 h-3" }: { outcome: Outcome; className?: string }) {
  return outcome === "accepted"
    ? <Check className={`${className} text-emerald-500`} />
    : <X className={`${className} text-rose-500`} />;
}

function OutcomePill({ outcome }: { outcome: Outcome }) {
  return (
    <span
      title={OUTCOME_HINT[outcome]}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border cursor-help ${
      outcome === "accepted"
        ? "text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
        : "text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10"
    }`}>
      <OutcomeIcon outcome={outcome} />
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function CondPill({ v }: { v: string }) {
  const s = v.trim().toUpperCase();
  if (s === "Y" || s === "YES" || s === "T" || s === "TRUE")
    return <span className="inline-block min-w-[38px] px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">Yes</span>;
  if (s === "N" || s === "NO" || s === "F" || s === "FALSE")
    return <span className="inline-block min-w-[38px] px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">No</span>;
  if (s === "-" || s === "" || s === "ANY" || s === "*")
    return <span className="text-xs text-slate-500 dark:text-slate-400" title="Not checked for this case">—</span>;
  return <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100">{v}</span>;
}

function TableQuality({ t }: { t: TestDesign["decisionTables"][number] }) {
  const q = useMemo(() => checkDecisionTable(t), [t]);
  const complete = !q.tooLarge && q.covered === q.combinations;
  const clean = q.conflicts.length === 0 && q.overlaps.length === 0;
  const label = (combo: string[]) => combo.map((v, i) => `${t.conditions[i]} ${v === "Y" ? "yes" : v === "N" ? "no" : v}`).join(", ");
  const good = complete && clean;
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs ${good
      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
      : "bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
      {good ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      <div className="space-y-0.5">
        {good && <p>Every possible combination is handled, and no two cases contradict each other.</p>}
        {!q.tooLarge && !complete && <p>Not handled: {q.missing.map(label).join("; ")}{q.combinations - q.covered > q.missing.length ? " …" : ""}.</p>}
        {q.conflicts.length > 0 && <p>Contradiction: {q.conflicts.map((c) => `${c.a} and ${c.b}`).join(", ")} can match the same request but expect different results.</p>}
        {q.overlaps.length > 0 && <p>Duplicate: {q.overlaps.map((c) => `${c.a} and ${c.b}`).join(", ")} describe the same case.</p>}
        {q.tooLarge && <p>Too many conditions to check every combination.</p>}
      </div>
    </div>
  );
}

function DecisionTablesView({ d, isCovered, sel, onSel }: ViewProps) {
  return (
    <div className="space-y-8">
      {d.decisionTables.map((t) => {
        const selRule = t.rules.find((r) => r.id === sel);
        const example = selRule && d.scenarios.find((s) => s.covers.includes(selRule.id) && Object.keys(s.data).length > 0);
        const col = (id: string) => (sel === id ? "bg-violet-50 dark:bg-violet-500/10" : "");
        const sectionRow = (label: string) => (
          <tr className="border-t border-slate-200 dark:border-slate-700">
            <td colSpan={t.rules.length + 1} className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400">{label}</td>
          </tr>
        );
        return (
          <div key={t.id} className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t.title}</h4>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/60">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 min-w-[200px]">Case</th>
                    {t.rules.map((r) => {
                      const ok = r.outcome === "accepted";
                      return (
                        <th key={r.id} className={`p-1 ${col(r.id)}`}>
                          <button
                            type="button"
                            onClick={() => onSel(r.id)}
                            title="Click for details and scenarios"
                            className={`w-full min-w-[60px] flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border transition-colors ${
                              sel === r.id ? "border-violet-500 ring-1 ring-violet-500"
                                : isCovered(r.id) ? "border-transparent hover:border-slate-300 dark:hover:border-slate-500"
                                : "border-dashed border-rose-400"
                            } ${ok ? "bg-emerald-100 dark:bg-emerald-500/15" : "bg-rose-100 dark:bg-rose-500/15"}`}
                          >
                            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{r.id.replace(`${t.id}-`, "")}</span>
                            <OutcomeIcon outcome={r.outcome} className="w-3.5 h-3.5" />
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sectionRow("If")}
                  {t.conditions.map((c, ci) => (
                    <tr key={`c${ci}`}>
                      <td className="px-3 py-1.5 text-slate-800 dark:text-slate-100">{c}</td>
                      {t.rules.map((r) => (
                        <td key={r.id} className={`text-center px-1 py-1.5 ${col(r.id)}`}><CondPill v={r.when[ci] ?? "-"} /></td>
                      ))}
                    </tr>
                  ))}
                  {sectionRow("Then")}
                  {t.actions.map((a, ai) => (
                    <tr key={`a${ai}`}>
                      <td className="px-3 py-1.5 text-slate-800 dark:text-slate-100">{a}</td>
                      {t.rules.map((r) => (
                        <td key={r.id} className={`text-center px-1 py-1.5 ${col(r.id)}`}>
                          {r.then[ai]?.trim()
                            ? <Check className={`w-4 h-4 inline ${r.outcome === "accepted" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} />
                            : <span className="text-slate-400 dark:text-slate-500">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr><td colSpan={t.rules.length + 1} className="h-1.5" /></tr>
                </tbody>
              </table>
            </div>
            {selRule ? (
              <div className="text-sm rounded-xl bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/30 px-3.5 py-3 space-y-2 text-slate-800 dark:text-slate-100">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-violet-700 dark:text-violet-300">{selRule.id}</span>
                  <OutcomePill outcome={selRule.outcome} />
                </div>
                {selRule.why && <p>{selRule.why}</p>}
                {example && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Example input:</span>
                    {Object.entries(example.data).map(([k, v]) => (
                      <span key={k} className="font-mono text-xs px-1.5 py-0.5 rounded bg-white dark:bg-slate-900/70 text-slate-800 dark:text-slate-100">
                        <span className="text-slate-500 dark:text-slate-400">{k}:</span> {v}
                      </span>
                    ))}
                  </div>
                )}
                {!isCovered(selRule.id) && <p className="text-xs text-rose-600 dark:text-rose-400">No scenario tests this case yet.</p>}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Each column is one case. Click a column to see why it exists, an example input, and its scenarios.</p>
            )}
            <TableQuality t={t} />
            {t.source && (
              <details className="text-xs text-slate-600 dark:text-slate-300">
                <summary className="cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">Based on this part of the story</summary>
                <blockquote className="mt-2 pl-3 border-l-2 border-slate-300 dark:border-slate-600 whitespace-pre-line">{t.source}</blockquote>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransitionsView({ d, isCovered, sel, onSel }: ViewProps) {
  const state = "px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium";
  return (
    <div className="grid gap-1.5">
      {d.transitions.map((t) => {
        const covered = isCovered(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSel(t.id)}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border text-left transition-colors ${
              sel === t.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40"
                : covered ? "border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500"
                : "border-dashed border-rose-300 dark:border-rose-800"
            }`}
          >
            <span className="font-mono text-[10px] text-slate-400 w-8">{t.id}</span>
            <span className={state}>{t.from}</span>
            <span className="flex items-center gap-1 text-slate-400">
              <span className="italic">{t.event}</span>
              <ArrowRight className="w-3 h-3" />
            </span>
            <span className={t.outcome === "rejected" ? `${state} line-through opacity-60` : state}>{t.to}</span>
            <span className="ml-auto flex items-center gap-2">
              {!covered && <span className="text-[10px] text-rose-500 font-medium">no scenario</span>}
              <OutcomeIcon outcome={t.outcome} className="w-3.5 h-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface ViewProps {
  d: TestDesign;
  isCovered: (id: string) => boolean;
  sel: string | null;
  onSel: (id: string) => void;
}

// ── Scenario card ─────────────────────────────────────────────────────────────

function ScenarioCard({
  s, open, onToggle,
}: { s: Scenario; open: boolean; onToggle: () => void }) {
  return (
    <div className={`${card} ${open ? "" : "hover:border-slate-300 dark:hover:border-slate-600"} transition-colors`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-2.5 text-left">
        <ChevronRight className={`w-4 h-4 text-slate-500 dark:text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400 w-9 flex-shrink-0">{s.id}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{s.title}</div>
          {!open && <div className="text-xs text-slate-600 dark:text-slate-300 truncate">Expect: {s.expected}</div>}
        </div>
        <span className={`hidden sm:inline text-xs font-medium ${TECH_TEXT[s.technique]}`}>{s.technique}</span>
        {s.priority === "high" && <span className="hidden sm:inline text-[11px] font-semibold uppercase text-amber-600 dark:text-amber-400">High</span>}
        <OutcomePill outcome={s.outcome} />
      </button>
      {open && (
        <div className="mx-4 mb-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 animate-section-in">
          <div className="flex items-center gap-2 px-4 py-2 text-xs border-b border-slate-200 dark:border-slate-700">
            <span className={`font-medium ${TECH_TEXT[s.technique]}`}>{TECHNIQUE_LABEL[s.technique]}</span>
            <span className="text-slate-400 dark:text-slate-500">•</span>
            <span className="text-slate-600 dark:text-slate-300 capitalize">{s.priority} priority</span>
          </div>
          <div className="text-sm divide-y divide-slate-200 dark:divide-slate-700">
            {s.preconditions && (
              <Row label="Precondition"><span className="text-slate-700 dark:text-slate-200">{s.preconditions}</span></Row>
            )}
            {s.steps.length > 0 && (
              <Row label="Steps">
                <ol className="space-y-0.5 text-slate-700 dark:text-slate-200">
                  {s.steps.map((st, i) => (
                    <li key={i} className="flex gap-1.5"><span className="text-slate-500 dark:text-slate-400 tabular-nums">{i + 1}.</span>{st}</li>
                  ))}
                </ol>
              </Row>
            )}
            {Object.keys(s.data).length > 0 && (
              <Row label="Test data">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(s.data).map(([k, v]) => (
                    <span key={k} className="font-mono text-xs px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-900/70 text-slate-800 dark:text-slate-100">
                      <span className="text-slate-500 dark:text-slate-400">{k}: </span>{v}
                    </span>
                  ))}
                </div>
              </Row>
            )}
            <Row label="Expected result"><span className="font-medium text-slate-800 dark:text-slate-100">{s.expected}</span></Row>
          </div>

        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 px-4 py-2.5">
      <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 dark:text-slate-400 pt-0.5">{label}</span>
      <div>{children}</div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function Accordion({
  title, count, hint, icon, tone, children,
}: { title: React.ReactNode; count?: number; hint?: string; icon?: React.ReactNode; tone?: "amber"; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const shell = tone === "amber"
    ? "rounded-2xl border border-amber-200 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/[0.06]"
    : card;
  return (
    <div className={shell}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-5 py-3.5 text-sm text-left"
      >
        <ChevronRight className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {icon}
        <span className="font-medium text-slate-800 dark:text-slate-100">{title}</span>
        {count != null && (
          <span className="text-[10px] font-semibold px-1.5 py-px rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300">{count}</span>
        )}
        {hint && <span className="text-xs text-slate-400 dark:text-slate-500 truncate hidden sm:inline">— {hint}</span>}
      </button>
      {open && <div className="px-5 pb-5 pt-1 animate-section-in">{children}</div>}
    </div>
  );
}

interface Props {
  design?: TestDesign;
  loading: boolean;
  error?: string | null;
  onGenerate: () => void;
}

function GapCard({ g: raw, n }: { g: Gap | string; n: number }) {
  const g: Gap = typeof raw === "string" ? { topic: "", detail: raw } : raw;
  return (
    <div className="rounded-xl bg-white dark:bg-slate-800/80 border border-amber-200/70 dark:border-amber-500/20 p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[11px] font-semibold flex items-center justify-center flex-shrink-0">{n}</span>
        <div className="flex-1 min-w-0 space-y-2 text-[13px]">
          <div>
            {g.topic && <h4 className="font-semibold text-slate-800 dark:text-slate-100">{g.topic}</h4>}
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{g.detail}</p>
          </div>
          {g.impact && (
            <p className="text-xs text-slate-600 dark:text-slate-300"><span className="font-semibold text-slate-500 dark:text-slate-400">Why it matters: </span>{g.impact}</p>
          )}
          {g.question && (
            <div className="flex items-start gap-2 text-xs rounded-lg bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2 text-amber-900 dark:text-amber-100">
              <CircleHelp className="w-3.5 h-3.5 mt-px flex-shrink-0 text-amber-500" />
              <span><span className="font-semibold">Ask: </span>{g.question}</span>
            </div>
          )}
          {g.assumption && (
            <p className="text-xs text-slate-500 dark:text-slate-400"><span className="font-semibold">Assumed for now: </span>{g.assumption}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TestDesignPanel({ design, loading, error, onGenerate }: Props) {
  const [techFilter, setTechFilter] = useState<Technique | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  if (loading) return <LoadingState />;

  if (!design) {
    return (
      <div className={`${card} p-8 text-center`}>
        <div className="mx-auto w-12 h-12 rounded-2xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center mb-4">
          <FlaskConical className="w-6 h-6 text-violet-500" />
        </div>
        <h3 className="font-semibold text-slate-800 dark:text-slate-100">Design test scenarios</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          Builds a test model with equivalence partitions, boundary values, decision tables and state transitions,
          then writes scenarios and checks that every case is covered.
        </p>
        {error && <p className="text-sm text-rose-500 mt-3">{error}</p>}
        <button
          onClick={onGenerate}
          className="mt-5 inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Generate scenarios
        </button>
      </div>
    );
  }

  const demoted = demoteFakeTransitions(design, design.scenarios);
  const d: TestDesign = { ...demoted.design, scenarios: demoted.scenarios };
  const { coverage } = d;
  const uncovered = new Set(coverage.uncovered);
  const isCovered = (id: string) => !uncovered.has(id);
  const items = modelItems(d);
  const counts: Record<Technique, number> = {
    EP: d.partitions.length,
    BVA: d.boundaries.length,
    DT: d.decisionTables.reduce((a, t) => a + t.rules.length, 0),
    ST: d.transitions.length,
  };
  const usedTechs = TECH_ORDER.filter((t) => counts[t] > 0);
  const reasonOf = (t: Technique) => d.techniques.find((x) => x.technique === t)?.reason;
  const full = coverage.covered === coverage.total && coverage.total > 0;

  const toggleSel = (id: string) => {
    setSelected((prev) => (prev === id ? null : id));
  };

  const visible = d.scenarios.filter(
    (s) => (techFilter === "all" || s.technique === techFilter) && (!selected || s.covers.includes(selected)),
  );
  const groups: { outcome: Outcome; list: Scenario[] }[] = (["accepted", "rejected"] as Outcome[])
    .map((o) => ({ outcome: o, list: visible.filter((s) => s.outcome === o) }))
    .filter((g) => g.list.length > 0);
  const selectedItem = selected ? items.find((i) => i.id === selected) : null;
  const viewProps: ViewProps = { d, isCovered, sel: selected, onSel: toggleSel };
  const missing = coverage.total - coverage.covered;
  const allOpen = visible.length > 0 && visible.every((s) => openIds.has(s.id));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className={`${card} px-5 py-4 flex items-center gap-4 flex-wrap`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${full ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-amber-50 dark:bg-amber-500/10"}`}>
          {full ? <Check className="w-5 h-5 text-emerald-500" /> : <AlertTriangle className="w-5 h-5 text-amber-500" />}
        </div>
        <div className="flex-1 min-w-[220px]">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">
            {d.scenarios.length} test scenarios
            <span className="font-normal text-slate-500 dark:text-slate-400">
              {" · "}{full ? "every case in the story is tested" : `${missing} case${missing === 1 ? "" : "s"} still untested`}
            </span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Designed with {usedTechs.map((t) => TECHNIQUE_LABEL[t]).join(", ").replace(/, ([^,]*)$/, " and $1")}
          </p>
          {(d.notUsed ?? []).filter((x) => !usedTechs.includes(x.technique)).map((x) => (
            <p key={x.technique} className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              <span className="font-medium">No {TECHNIQUE_LABEL[x.technique]}:</span> {x.reason}
            </p>
          ))}
        </div>
        <button
          onClick={onGenerate}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-slate-500 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white bg-slate-100 dark:bg-slate-700/60 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate
        </button>
      </div>

      {/* Gaps */}
      {d.gaps.length > 0 && (
        <Accordion
          tone="amber"
          icon={<CircleHelp className="w-4 h-4 text-amber-500" />}
          title="The story doesn't say"
          count={d.gaps.length}
          hint="ask the analyst before testing these"
        >
          <div className="grid gap-3">
            {d.gaps.map((g, i) => <GapCard key={i} g={g} n={i + 1} />)}
          </div>
        </Accordion>
      )}

      {d.decisionTables.length > 0 && (
        <Accordion
          title={<span className={TECH_TEXT.DT}>Decision Table</span>}
          count={counts.DT}
          hint="each column is one case: what's checked and what should happen"
        >
          <DecisionTablesView {...viewProps} />
        </Accordion>
      )}

      {d.transitions.length > 0 && (
        <Accordion
          title={<span className={TECH_TEXT.ST}>State Transition</span>}
          count={counts.ST}
          hint="how the status can, and can't, change"
        >
          <p className="text-xs text-slate-400 mb-4">Click a row to see the scenarios that test it.</p>
          <TransitionsView {...viewProps} />
        </Accordion>
      )}

      {/* Technique filter */}
      {(usedTechs.length > 1 || selectedItem || visible.length > 0) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {usedTechs.length > 1 && (["all", ...usedTechs] as const).map((t) => {
            const n = t === "all" ? d.scenarios.length : d.scenarios.filter((s) => s.technique === t).length;
            if (t !== "all" && n === 0) return null;
            return (
              <button
                key={t}
                onClick={() => setTechFilter(t)}
                title={t === "all" ? undefined : reasonOf(t)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                  techFilter === t
                    ? "bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900"
                    : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                {t === "all" ? "All" : TECHNIQUE_LABEL[t]} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
          {selectedItem && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
              Covering <span className="font-mono">{selectedItem.id}</span>
              <span className="max-w-[220px] truncate opacity-80">{selectedItem.label}</span>
              <button onClick={() => setSelected(null)} className="hover:text-violet-900 dark:hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          )}
          {visible.length > 0 && (
            <button
              onClick={() => setOpenIds(allOpen ? new Set() : new Set(visible.map((s) => s.id)))}
              className="ml-auto text-xs px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          )}
        </div>
      )}

      {/* Scenarios grouped by expected outcome */}
      {groups.map((g) => (
        <section key={g.outcome} className="space-y-2.5">
          <div className="flex items-center gap-2 px-1">
            <OutcomeIcon outcome={g.outcome} className="w-4 h-4" />
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{OUTCOME_LABEL[g.outcome]}</h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">{g.list.length}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:inline">
              — {g.outcome === "accepted" ? "the system should allow it" : "the system should refuse it and change nothing"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5">
            {g.list.map((s) => (
              <ScenarioCard
                key={s.id}
                s={s}
                open={openIds.has(s.id)}
                onToggle={() => setOpenIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                  return next;
                })}
              />
            ))}
          </div>
        </section>
      ))}
      {visible.length === 0 && (
        <div className={`${card} p-6 text-center text-sm text-slate-500`}>
          {selectedItem ? <>No valid scenario covers <span className="font-mono">{selectedItem.id}</span>.</> : "No scenarios for this filter."}
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  const steps = ["Building test model", "Writing scenarios", "Checking coverage"];
  return (
    <div className={`${card} p-8`}>
      <div className="flex items-center gap-3 mb-5">
        <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
        <div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">Designing test scenarios</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">Usually takes 30–60 seconds</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-streaming-dot" style={{ animationDelay: `${i * 160}ms` }} />
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
