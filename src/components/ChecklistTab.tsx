"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Analysis, ApiRequest, ChecklistItem, ChecklistStatus, IssueReport } from "@/types";
import { checklistFromTestDesign, isScenarioText, parseScenarioText, formatScenarioText, OUTCOME_LABEL, TECHNIQUE_LABEL, SCENARIO_CATEGORY, type ScenarioText } from "@/lib/test-design";
import MarkdownEditor from "./MarkdownEditor";
import { buildResultsAdf, buildResultsText, itemApis } from "@/lib/jira-results";
import { buildResultsXlsx } from "@/lib/results-xlsx";
import { ApiRequestEditor, ApiRequestList, RequestChip, RequestDetails } from "./ApiRequests";
import { loadEnvs, saveEnvs } from "@/lib/environments";
import { draftFromItem, emptyDraft, type ReportDraft } from "@/lib/bug-report";
import ReportIssueModal from "./ReportIssueModal";
import ReportsPanel from "./ReportsPanel";
import { Check, X, AlertCircle, Send, Loader2, RefreshCw, Pencil, Copy, CheckCheck, Trash2, ChevronRight, Plus, Download, Server, Code2, Bug, Search } from "lucide-react";

// ── Inline bold renderer ─────────────────────────────────────────────────────

function InlineText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        i % 2 === 1 ? <strong key={i} className="font-semibold text-slate-800 dark:text-slate-100">{p}</strong> : p
      )}
    </span>
  );
}

// ── Structured description renderer ──────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 pt-[3px]">{label}</span>
      <div className="min-w-0 text-[13px] text-slate-700 dark:text-slate-200">{children}</div>
    </div>
  );
}

function OutcomeTag({ outcome }: { outcome: "accepted" | "rejected" }) {
  const blocked = outcome === "rejected";
  return (
    <span
      title={blocked ? "Negative test: the system should refuse this and change nothing." : "Positive test: the system should allow this."}
      className={`inline-flex items-center gap-1 cursor-help text-[11px] font-semibold px-2 py-0.5 rounded-md ${blocked
        ? "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}
    >
      {blocked ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

type ApiProps = { apis?: ApiRequest[]; onApisChange?: (apis: ApiRequest[]) => void };

function ScenarioCard({ text, hideHead, apis = [], onApisChange }: { text: string; hideHead?: boolean } & ApiProps) {
  const s = parseScenarioText(text);
  const steps = s.steps.map(st => st.replace(/\*\*/g, ""));
  const [openApi, setOpenApi] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ idx: number } | { step: number } | null>(null);
  const editable = !!onApisChange;
  const loose = apis.map((a, i) => ({ a, i })).filter(({ a }) => !a.step || a.step > steps.length);

  const saveApi = (v: ApiRequest) => {
    if (!onApisChange || !editing) return;
    if ("idx" in editing) { onApisChange(apis.map((x, j) => j === editing.idx ? v : x)); setOpenApi(editing.idx); }
    else { onApisChange([...apis, v]); setOpenApi(apis.length); }
    setEditing(null);
  };
  const removeApi = (idx: number) => { onApisChange?.(apis.filter((_, j) => j !== idx)); setOpenApi(null); setEditing(null); };

  const renderApi = (a: ApiRequest, i: number) => (
    editing && "idx" in editing && editing.idx === i ? (
      <div key={i} className="mt-1.5"><ApiRequestEditor value={a} steps={steps} fixedStep={!!a.step && a.step <= steps.length} onSave={saveApi} onRemove={() => removeApi(i)} onCancel={() => setEditing(null)} /></div>
    ) : openApi === i ? (
      <RequestDetails key={i} api={a} onEdit={editable ? () => setEditing({ idx: i }) : undefined} onRemove={editable ? () => removeApi(i) : undefined} />
    ) : null
  );
  return (
    <div>
      {!hideHead && <div className="flex items-start gap-2 mb-3">
        <span className="flex-shrink-0 mt-0.5 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">{s.id}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100 leading-snug flex-1">{s.title}</span>
        {s.outcome && <OutcomeTag outcome={s.outcome} />}
      </div>}

      <div className="rounded-lg border border-slate-200 dark:border-slate-700/70 bg-slate-50/60 dark:bg-slate-900/30 px-3.5 py-2.5 divide-y divide-slate-200/70 dark:divide-slate-700/50">
        {s.given && <Field label="Precondition">{s.given}</Field>}
        {s.steps.length > 0 && (
          <Field label="Steps">
            <ol className="space-y-1">
              {s.steps.map((st, i) => {
                const mine = apis.map((a, idx) => ({ a, idx })).filter(({ a }) => a.step === i + 1);
                const adding = editing && "step" in editing && editing.step === i + 1;
                return (
                  <li key={i} className="group/step">
                    <div className="flex gap-2 items-start">
                      <span className={`flex-shrink-0 w-4 h-4 mt-px rounded-full text-[10px] font-semibold flex items-center justify-center ${mine.length ? "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300" : "bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300"}`}>{i + 1}</span>
                      <span className="flex-1 min-w-0">{st}</span>
                      {editable && !adding && (
                        <button
                          onClick={() => setEditing({ step: i + 1 })}
                          title="Add the API request sent in this step"
                          className="flex-shrink-0 -my-0.5 flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-dashed border-sky-300 dark:border-sky-500/40 text-xs font-medium text-sky-600 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:border-solid opacity-0 group-hover/step:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <Code2 className="w-3.5 h-3.5" /> Add API request
                        </button>
                      )}
                    </div>
                    {mine.length > 0 && (
                      <div className="ml-6 mt-1 flex flex-wrap gap-1.5">
                        {mine.map(({ a, idx }) => <RequestChip key={idx} api={a} open={openApi === idx || (!!editing && "idx" in editing && editing.idx === idx)} onClick={() => { setEditing(null); setOpenApi(openApi === idx ? null : idx); }} />)}
                      </div>
                    )}
                    {mine.length > 0 && <div className="ml-6">{mine.map(({ a, idx }) => renderApi(a, idx))}</div>}
                    {adding && (
                      <div className="ml-6 mt-1.5">
                        <ApiRequestEditor steps={steps} defaultStep={i + 1} fixedStep onSave={saveApi} onCancel={() => setEditing(null)} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Field>
        )}
        {loose.length > 0 && (
          <Field label="Other requests">
            <div className="flex flex-wrap gap-1.5">
              {loose.map(({ a, i }) => <RequestChip key={i} api={a} open={openApi === i} onClick={() => { setEditing(null); setOpenApi(openApi === i ? null : i); }} />)}
            </div>
            {loose.map(({ a, i }) => renderApi(a, i))}
          </Field>
        )}
        {s.data.length > 0 && (
          <Field label="Test data">
            <table className="text-[12px]">
              <tbody>
                {s.data.map(([k, v], i) => (
                  <tr key={i}>
                    <td className="pr-4 py-0.5 text-slate-500 dark:text-slate-400 align-top">{k}</td>
                    <td className="py-0.5 font-mono font-medium text-slate-800 dark:text-slate-100">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Field>
        )}
        <Field label="Expected result">
          <ul className="space-y-1">
            {s.expected.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400 dark:text-slate-500" />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </div>
  );
}

const inputCls = "w-full text-[13px] text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500/60 focus:border-violet-500";

function ScenarioEditor({ text, newId, onSave, onCancel }: { text?: string; newId?: string; onSave: (t: string) => void; onCancel: () => void }) {
  const init: ScenarioText = text
    ? parseScenarioText(text)
    : { id: newId ?? "TC", title: "", given: "", steps: [], data: [], outcome: "accepted", expected: [] };
  const isNew = !text;
  const [title, setTitle] = useState(init.title);
  const [given, setGiven] = useState(init.given);
  const [steps, setSteps] = useState(init.steps.join("\n"));
  const [data, setData] = useState<[string, string][]>(init.data.length ? init.data : [["", ""]]);
  const [outcome, setOutcome] = useState(init.outcome ?? "accepted");
  const [expected, setExpected] = useState(init.expected.join("\n"));

  const lines = (v: string) => v.split("\n").map(l => l.trim()).filter(Boolean);
  const canSave = !!title.trim() && (!isNew || lines(expected).length > 0);
  const save = () => { if (canSave) onSave(formatScenarioText({
    id: init.id, title: title.trim() || init.title, given, steps: lines(steps), data, outcome, expected: lines(expected),
  })); };

  return (
    <div className="rounded-xl border border-violet-300 dark:border-violet-500/40 bg-violet-50/40 dark:bg-violet-500/[0.04] p-4 space-y-3">
      {isNew && <div className="text-xs font-semibold text-violet-700 dark:text-violet-300">New test case</div>}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">{init.id}</span>
        <input value={title} onChange={e => setTitle(e.target.value)} className={`${inputCls} font-semibold`} placeholder="What does this test check? e.g. Rate above maximum is rejected" autoFocus />
      </div>

      <EditRow label="Precondition">
        <textarea value={given} onChange={e => setGiven(e.target.value)} rows={2} className={`${inputCls} resize-y`} placeholder="e.g. Loan in Late status" />
      </EditRow>

      <EditRow label="Steps" hint="one per line">
        <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={Math.max(2, lines(steps).length + 1)} className={`${inputCls} resize-y`} placeholder={"Open the loan\nEnter the new rate and submit"} />
      </EditRow>

      <EditRow label="Test data">
        <div className="space-y-1.5">
          {data.map(([k, v], i) => (
            <div key={i} className="flex gap-1.5">
              <input value={k} onChange={e => setData(d => d.map((p, j) => j === i ? [e.target.value, p[1]] : p))} className={`${inputCls} w-2/5`} placeholder="field" />
              <input value={v} onChange={e => setData(d => d.map((p, j) => j === i ? [p[0], e.target.value] : p))} className={`${inputCls} font-mono`} placeholder="value" />
              <button onClick={() => setData(d => d.filter((_, j) => j !== i))} className="px-2 text-slate-400 hover:text-red-500" title="Remove"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => setData(d => [...d, ["", ""]])} className="text-xs text-violet-600 dark:text-violet-400 hover:underline">+ Add value</button>
        </div>
      </EditRow>

      <EditRow label="Outcome">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden text-xs">
          {(["accepted", "rejected"] as const).map(o => (
            <button key={o} onClick={() => setOutcome(o)}
              className={`px-3 py-1.5 flex items-center gap-1 transition-colors ${outcome === o
                ? o === "accepted" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
              {o === "accepted" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              {OUTCOME_LABEL[o]}
            </button>
          ))}
        </div>
      </EditRow>

      <EditRow label="Expected result" hint="one per line">
        <textarea value={expected} onChange={e => setExpected(e.target.value)} rows={Math.max(2, lines(expected).length + 1)} className={`${inputCls} resize-y`} placeholder={"Request rejected with 422 INVALID_INTEREST_RATE\nLoan rate unchanged"} />
      </EditRow>

      <div className="flex items-center gap-1.5 pt-1">
        <button onClick={save} disabled={!canSave} className="flex items-center gap-1 text-xs bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-lg transition-colors">
          <Check className="w-3 h-3" /> {isNew ? "Add test case" : "Save"}
        </button>
        <button onClick={onCancel} className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 px-3 py-1.5 rounded-lg transition-colors">
          <X className="w-3 h-3" /> Cancel
        </button>
        {!canSave && <span className="text-xs text-slate-500 dark:text-slate-400 ml-1">{isNew ? "Fill in a title and the expected result" : "Title is required"}</span>}
      </div>
    </div>
  );
}

function EditRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[104px_1fr] gap-1 sm:gap-3">
      <div className="pt-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        {hint && <div className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function DescriptionLines({ text, className, hideHead, apis, onApisChange }: { text: string; className?: string; hideHead?: boolean } & ApiProps) {
  if (isScenarioText(text)) {
    return <div className={className}><ScenarioCard text={text} hideHead={hideHead} apis={apis} onApisChange={onApisChange} /></div>;
  }
  if (!text.includes("\n")) {
    return <InlineText text={text} className={className} />;
  }
  return (
    <div className={className}>
      {text.split("\n").map((line, i) => {
        const lm = line.match(/^([A-Za-z][A-Za-z ]{0,18}):\s*(.*)/);
        return lm ? (
          <div key={i} className={i > 0 ? "mt-1.5" : ""}>
            <span className="inline-block font-semibold text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mr-1.5">{lm[1]}:</span>
            <InlineText text={lm[2]} />
          </div>
        ) : (
          <div key={i} className={i > 0 ? "mt-1" : ""}>
            <InlineText text={line} />
          </div>
        );
      })}
    </div>
  );
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_OPTS: {
  value: ChecklistStatus;
  symbol: string;
  label: string;
  active: string;
  inactive: string;
}[] = [
  { value: "pending",       symbol: "–",  label: "Not tested",           active: "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200",                              inactive: "text-slate-300 dark:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700" },
  { value: "passed",        symbol: "✓",  label: "Passed",               active: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-400 dark:ring-emerald-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400" },
  { value: "failed",        symbol: "✗",  label: "Failed",               active: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 ring-1 ring-red-400 dark:ring-red-600",       inactive: "text-slate-300 dark:text-slate-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400" },
  { value: "clarification", symbol: "?",  label: "Clarification Needed", active: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 ring-1 ring-amber-400 dark:ring-amber-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400" },
  { value: "blocked",       symbol: "!",  label: "Blocked",              active: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 ring-1 ring-violet-400 dark:ring-violet-600", inactive: "text-slate-300 dark:text-slate-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-600 dark:hover:text-violet-400" },
];

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseTestsFromAnalysis(analysis: Analysis): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  let idCounter = 0;

  const parseSection = (content: string, defaultCategory: string) => {
    const lines = content.split("\n");
    let category = defaultCategory;
    let currentDesc: string | null = null;

    const flush = () => {
      if (currentDesc && currentDesc.replace(/\n/g, "").trim().length > 4) {
        items.push({ id: `cl-${++idCounter}`, category, description: currentDesc.trim(), status: "pending" });
      }
      currentDesc = null;
    };

    for (const line of lines) {
      const h = line.match(/^#{1,6}\s+(.+)/);
      // Bold-only line (e.g. **Happy Path Scenarios**) — treat as a category heading
      const boldHeading = !line.startsWith("-") && !line.startsWith("*") && line.match(/^\*\*([^*\n]+)\*\*\s*$/);
      const b = line.match(/^[-*\u2022]\s+(.+)/);
      const n = line.match(/^\d+\.\s+(.+)/);
      // Indented continuation line (2+ spaces or tab) belonging to the current bullet
      const isContinuation = /^[ \t]{2,}\S/.test(line) && currentDesc !== null;

      if (h) {
        flush();
        category = h[1].replace(/\*\*/g, "").trim();
      } else if (boldHeading) {
        flush();
        category = (boldHeading as RegExpMatchArray)[1].trim();
      } else if (b || n) {
        flush();
        currentDesc = (b?.[1] ?? n?.[1] ?? "").trim();
      } else if (isContinuation) {
        const cont = line.trim();
        if (cont) currentDesc += "\n" + cont;
      }
    }
    flush();
  };

  // Formal test design wins over the legacy desk check
  if (analysis.testDesign?.scenarios?.length) {
    items.push(...checklistFromTestDesign(analysis.testDesign));
    return items;
  }
  if (analysis.deskCheck?.content) {
    parseSection(analysis.deskCheck.content, "Desk Check Scenarios");
  }
  if (analysis.testSuggestions?.content)
    parseSection(analysis.testSuggestions.content, "Test Suggestions");

  return items;
}

const TECHNIQUE_CATS = new Set(Object.values(TECHNIQUE_LABEL));
const DEV_CATS = new Set(["Unit Tests", "Integration Tests", "What to Automate vs What to Test Manually", "Test Suggestions"]);

/** Returns a cleaned-up checklist, or null when nothing needs changing. */
function migrateChecklist(items: ChecklistItem[]): ChecklistItem[] | null {
  // Only drop developer sections nobody has started marking
  const untouchedDev = new Set(
    [...DEV_CATS].filter(c => items.some(i => i.category === c) && items.every(i => i.category !== c || i.status === "pending")),
  );
  let changed = false;
  const out = items.flatMap(i => {
    if (untouchedDev.has(i.category)) { changed = true; return []; }
    if (TECHNIQUE_CATS.has(i.category)) { changed = true; return [{ ...i, category: SCENARIO_CATEGORY }]; }
    return [i];
  });
  return changed ? out : null;
}

/** Collapsed-row heading for a checklist item. */
function rowHead(text: string): { id?: string; title: string; outcome?: "accepted" | "rejected" } {
  if (isScenarioText(text)) {
    const s = parseScenarioText(text);
    return { id: s.id, title: s.title, outcome: s.outcome ?? undefined };
  }
  return { title: text.split("\n")[0] };
}

const STRIPE: Record<ChecklistStatus, string> = {
  pending: "bg-slate-200 dark:bg-slate-600",
  passed: "bg-emerald-500",
  failed: "bg-red-500",
  clarification: "bg-amber-500",
  blocked: "bg-violet-500",
  na: "bg-slate-400",
};

// ── Component ─────────────────────────────────────────────────────────────────

interface ChecklistTabProps {
  analysis: Analysis | null;
  checklist: ChecklistItem[] | undefined;
  storyTitle?: string;
  jiraKey?: string;
  postedCategories?: string[];
  onCategoryPosted?: (category: string) => void;
  onChecklistChange: (items: ChecklistItem[]) => void;
  refLabel?: string;
  onRefLabelChange?: (label: string) => void;
  environment?: string;
  onEnvironmentChange?: (env: string) => void;
  reports?: IssueReport[];
  onReportsChange?: (r: IssueReport[]) => void;
}

// ── Test reference (the ID of the record a tester used, e.g. a loan) ─────────

const REF_SUGGESTIONS = ["Loan ID", "Product ID", "Customer ID", "User ID", "Account ID", "Contract ID", "Card ID", "Application ID", "Order ID", "Transaction ID"];

/** Guess the most likely ID name from the story, e.g. a lending story → "Loan ID". */
function guessRefLabel(analysis: Analysis | null, storyTitle: string): string {
  const text = `${storyTitle} ${analysis?.explanation?.content ?? ""}`.toLowerCase();
  let best = { label: "Record ID", n: 0 };
  for (const label of REF_SUGGESTIONS) {
    const word = label.replace(/ ID$/, "").toLowerCase();
    const n = text.match(new RegExp(`\\b${word}s?\\b`, "g"))?.length ?? 0;
    if (n > best.n) best = { label, n };
  }
  return best.label;
}

function RefCell({ value, label, alwaysShow, onSave }: { value?: string; label: string; alwaysShow: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => { onSave(draft.trim()); setEditing(false); };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        placeholder={label}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
        className="w-32 h-7 mr-1 px-2 text-[11px] font-mono rounded-lg border border-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      />
    );
  }
  if (value) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        title={`${label}: ${value} — click to change`}
        className="max-w-[9rem] h-7 mr-1 px-2 flex items-center gap-1 rounded-lg text-[11px] font-mono font-medium bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-500/30 hover:border-sky-400 transition-colors"
      >
        <span className="text-[9px] font-sans font-semibold uppercase tracking-wide text-sky-500/80 flex-shrink-0">{label.replace(/ ID$/i, "")}</span>
        <span className="truncate">{value}</span>
      </button>
    );
  }
  return (
    <button
      onClick={() => { setDraft(""); setEditing(true); }}
      title={`Note the ${label} you tested with`}
      className={`h-7 mr-1 px-2 flex items-center gap-1 rounded-lg text-[11px] text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 hover:text-sky-600 hover:border-sky-400 transition-all ${alwaysShow ? "" : "opacity-0 group-hover:opacity-100"}`}
    >
      <Plus className="w-3 h-3" /> {label}
    </button>
  );
}

function RefLabelControl({ label, onChange }: { label: string; onChange: (l: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const commit = () => { const v = draft.trim(); if (v) onChange(v); setEditing(false); };
  if (editing) {
    return (
      <>
        <input
          autoFocus
          list="ref-label-suggestions"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          className="w-36 text-xs px-2 py-1 rounded-lg border border-sky-400 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
        />
        <datalist id="ref-label-suggestions">{REF_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
      </>
    );
  }
  return (
    <button
      onClick={() => { setDraft(label); setEditing(true); }}
      title="Which ID testers note for each case (shown in Excel and Jira). Click to rename, e.g. Product ID or User ID."
      className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:border-sky-400 transition-colors"
    >
      <span className="text-sky-500/80">Tested with</span>
      <span className="font-semibold">{label}</span>
      <Pencil className="w-3 h-3 opacity-60" />
    </button>
  );
}

// ── Test environment (where the tests ran) ────────────────────────────────────

function EnvironmentControl({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [envs, setEnvs] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const open = () => { setEnvs(loadEnvs()); setDraft(""); setEditing(true); };
  const pick = (v: string) => { onChange(v); setEditing(false); };
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!envs.some(e => e.toLowerCase() === v.toLowerCase())) { const next = [...envs, v]; setEnvs(next); saveEnvs(next); }
    pick(v);
  };
  const remove = (e: string) => { const next = envs.filter(x => x !== e); setEnvs(next); saveEnvs(next); };

  if (editing) {
    return (
      <div
        className="flex items-center flex-wrap gap-1 p-1 rounded-lg border border-teal-300 dark:border-teal-500/40 bg-white dark:bg-slate-900"
        onKeyDown={e => { if (e.key === "Escape") setEditing(false); }}
      >
        {envs.map(e => (
          <span key={e} className={`group/env inline-flex items-center rounded-md ${value === e ? "bg-teal-600 text-white" : "text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-500/10"}`}>
            <button onClick={() => pick(e)} className="text-[11px] font-semibold pl-2 pr-1 py-0.5">{e}</button>
            <button
              onClick={() => remove(e)}
              title={`Remove ${e} from your list`}
              className="w-4 h-4 mr-0.5 rounded flex items-center justify-center opacity-0 group-hover/env:opacity-70 hover:!opacity-100 hover:bg-black/10"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          autoFocus
          value={draft}
          placeholder={envs.length ? "Add new…" : "Add your environment…"}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          className="w-32 text-[11px] px-1.5 py-0.5 rounded-md bg-transparent text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
        />
        {draft.trim() && <button onClick={add} className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-teal-600 text-white">Add</button>}
        {value && <button onClick={() => pick("")} title="Clear the environment for this story" className="text-[11px] px-1.5 py-0.5 rounded-md text-slate-400 hover:text-rose-600">Clear</button>}
        <button onClick={() => setEditing(false)} title="Close" className="w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-3 h-3" /></button>
      </div>
    );
  }
  return (
    <button
      onClick={open}
      title="Where did you run these tests? Shown in the Excel and Jira results. You can add or remove environments in your list."
      className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${value
        ? "border-teal-200 dark:border-teal-500/30 bg-teal-50 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300 hover:border-teal-400"
        : "border-dashed border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:border-amber-400"}`}
    >
      <Server className="w-3.5 h-3.5 opacity-70" />
      {value ? <><span className="opacity-70">Environment</span><span className="font-semibold">{value}</span></> : <span className="font-medium">Set environment</span>}
      <Pencil className="w-3 h-3 opacity-60" />
    </button>
  );
}

async function buildSectionXlsx(  cat: string,
  catItems: ChecklistItem[],
  storyTitle: string,
  jiraKey?: string,
  refLabel?: string,
  environment?: string,
) {
  const blob = await buildResultsXlsx({
    sheetName: cat === SCENARIO_CATEGORY ? "Test results" : cat,
    heading: jiraKey ? `${jiraKey}: ${storyTitle}` : storyTitle,
    section: cat,
    items: catItems,
    refLabel,
    environment,
  });

  // e.g. "LSINST-3897 Test results 2026-10-27.xlsx" (story title only when there's no Jira key)
  const fileDateStr = new Date().toISOString().slice(0, 10);
  const safeTitle = (storyTitle || "story").replace(/[\\/:*?"<>|,;]/g, "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  const label     = cat === SCENARIO_CATEGORY ? "Test results" : `${cat.replace(/[\\/:*?"<>|,;]/g, "").trim().slice(0, 30)} results`;
  const fileName  = `${jiraKey || safeTitle} ${label} ${fileDateStr}.xlsx`;
  return { blob, fileName };
}

async function downloadSectionXlsx(cat: string, catItems: ChecklistItem[], storyTitle: string, jiraKey?: string, refLabel?: string, environment?: string) {
  const { blob, fileName } = await buildSectionXlsx(cat, catItems, storyTitle, jiraKey, refLabel, environment);
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ChecklistTab({ analysis, checklist, storyTitle = "", jiraKey, postedCategories = [], onCategoryPosted, onChecklistChange, refLabel, onRefLabelChange, environment, onEnvironmentChange, reports = [], onReportsChange }: ChecklistTabProps) {
  const effectiveRefLabel = refLabel?.trim() || guessRefLabel(analysis, storyTitle);
  const [sectionJiraStatus, setSectionJiraStatus] = useState<Record<string, "idle" | "posting" | "posted" | "error">>({});
  const [sectionJiraError,  setSectionJiraError]  = useState<Record<string, string>>({});
  const [sConfirming,       setSConfirming]       = useState<Record<string, boolean>>({});
  const [sectionCopied,     setSectionCopied]     = useState<Record<string, boolean>>({});
  const [editingId,         setEditingId]         = useState<string | null>(null);
  const [activeCat,         setActiveCat]         = useState<string | null>(null);
  const [addingCat,         setAddingCat]         = useState<string | null>(null);
  // Categories emptied by item deletion but not yet hard-deleted by the user
  const [emptiedCats,       setEmptiedCats]       = useState<string[]>([]);
  const [editingCatName,    setEditingCatName]    = useState<string | null>(null);
  const [catNameValue,      setCatNameValue]      = useState("");
  const [openIds,           setOpenIds]           = useState<Set<string>>(new Set());
  const [statusFilter,      setStatusFilter]      = useState<ChecklistStatus | "all">("all");
  const [editingBug, setEditingBug] = useState<IssueReport | null>(null);
  const reportsRef = useRef(reports);
  useEffect(() => { reportsRef.current = reports; }, [reports]);
  const [reporting,         setReporting]         = useState<{ kind: "bug" | "observation"; draft: ReportDraft; itemId?: string } | null>(null);

  // Tidy older saved checklists: one "Test cases" list, no dev-only sections
  useEffect(() => {
    if (!checklist || !analysis?.testDesign?.scenarios?.length) return;
    const migrated = migrateChecklist(checklist);
    if (migrated) onChecklistChange(migrated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist, analysis]);

  // Auto-generate on first visit (when checklist is undefined)
  useEffect(() => {
    if (analysis && checklist === undefined) {
      onChecklistChange(parseTestsFromAnalysis(analysis));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const items      = checklist ?? [];
  const itemCats   = [...new Set(items.map(i => i.category))];
  // Include emptied categories (soft-deleted) so they stay visible until hard-deleted
  const categories = [...itemCats, ...emptiedCats.filter(c => !itemCats.includes(c))];
  // Active category tab — default to first; stay valid when items change
  const effectiveCat = (activeCat && categories.includes(activeCat)) ? activeCat : (categories[0] ?? "");
  const total      = items.length;
  const done       = items.filter(i => i.status !== "pending").length;
  const pct        = total > 0 ? Math.round((done / total) * 100) : 0;

  const handleGenerate = useCallback(() => {
    if (!analysis) return;
    setEmptiedCats([]);
    onChecklistChange(parseTestsFromAnalysis(analysis));
  }, [analysis, onChecklistChange]);

  const updateStatus = useCallback((id: string, status: ChecklistStatus) => {
    onChecklistChange(items.map(i => i.id === id ? { ...i, status } : i));
  }, [items, onChecklistChange]);


  const deleteItem = useCallback((id: string) => {
    const item = items.find(i => i.id === id);
    if (item) {
      const catItems = items.filter(i => i.category === item.category);
      if (catItems.length === 1) {
        // Last item in category — soft-delete the section (keep visible as empty)
        setEmptiedCats(prev => prev.includes(item.category) ? prev : [...prev, item.category]);
      }
    }
    onChecklistChange(items.filter(i => i.id !== id));
  }, [items, onChecklistChange]);

  const addItem = useCallback((cat: string, text: string) => {
    if (!text.trim()) { setAddingCat(null); return; }
    const newItem: ChecklistItem = {
      id: `cl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      category: cat,
      description: text.trim(),
      status: "pending",
    };
    // Reactivate section if it was emptied
    setEmptiedCats(prev => prev.filter(c => c !== cat));
    const first = items.findIndex(i => i.category === cat);
    onChecklistChange(first < 0 ? [...items, newItem] : [...items.slice(0, first), newItem, ...items.slice(first)]);
    setAddingCat(null);
  }, [items, onChecklistChange]);

  const nextTcId = `TC${items.reduce((m, i) => {
    const n = Number(i.description.match(/^\*\*TC(\d+)/)?.[1] ?? 0);
    return Math.max(m, n);
  }, 0) + 1}`;

  const deleteSection = useCallback((cat: string) => {
    onChecklistChange(items.filter(i => i.category !== cat));
    setEmptiedCats(prev => prev.filter(c => c !== cat));
    // If the deleted section was active, switch to first remaining
    if (activeCat === cat) setActiveCat(null);
  }, [items, activeCat, onChecklistChange]);

  const renameCat = useCallback((oldCat: string, newCat: string) => {
    const trimmed = newCat.trim();
    if (!trimmed || trimmed === oldCat) { setEditingCatName(null); return; }
    onChecklistChange(items.map(i => i.category === oldCat ? { ...i, category: trimmed } : i));
    setEmptiedCats(prev => prev.map(c => c === oldCat ? trimmed : c));
    if (activeCat === oldCat) setActiveCat(trimmed);
    setEditingCatName(null);
  }, [items, activeCat, onChecklistChange]);

  const doSendSection = useCallback(async (cat: string, catItems: ChecklistItem[]) => {
    if (!jiraKey) return;
    setSectionJiraStatus(prev => ({ ...prev, [cat]: "posting" }));
    setSectionJiraError(prev => { const n = { ...prev }; delete n[cat]; return n; });
    const commentTitle = cat === SCENARIO_CATEGORY ? "🧪 Test execution results" : `🧪 Test execution results · ${cat}`;
    try {
      // 1) Attach the Excel results to the ticket (comment still goes out if this fails)
      let attached: { name: string; url?: string } | null = null;
      try {
        const { blob, fileName } = await buildSectionXlsx(cat, catItems, storyTitle, jiraKey, effectiveRefLabel, environment);
        const fd = new FormData();
        fd.append("key", jiraKey);
        fd.append("file", new File([blob], fileName, { type: blob.type }));
        const up = await fetch("/api/jira/attachment", { method: "POST", body: fd });
        if (up.ok) {
          const u = (await up.json()) as { filename?: string; url?: string };
          attached = { name: u.filename ?? fileName, url: u.url };
        }
      } catch { /* fall through without attachment */ }

      // 2) Post the summary comment
      const res = await fetch("/api/jira/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: jiraKey,
          title: commentTitle,
          adf: buildResultsAdf({ title: commentTitle, items: catItems, refLabel: effectiveRefLabel, environment, attachment: attached }),
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to post");
      setSectionJiraStatus(prev => ({ ...prev, [cat]: "posted" }));
      onCategoryPosted?.(cat);
    } catch (err) {
      setSectionJiraStatus(prev => ({ ...prev, [cat]: "error" }));
      setSectionJiraError(prev => ({ ...prev, [cat]: err instanceof Error ? err.message : "Failed to post" }));
      setTimeout(() => {
        setSectionJiraStatus(prev => ({ ...prev, [cat]: "idle" }));
        setSectionJiraError(prev => { const n = { ...prev }; delete n[cat]; return n; });
      }, 5000);
    }
  }, [jiraKey, storyTitle, effectiveRefLabel, environment, onCategoryPosted]);

  const handleSendSectionJira = useCallback((cat: string, catItems: ChecklistItem[]) => {
    if (sectionJiraStatus[cat] === "posting") return;
    if (postedCategories.includes(cat)) {
      // Already sent before — ask for confirmation
      setSConfirming(prev => ({ ...prev, [cat]: true }));
      return;
    }
    doSendSection(cat, catItems);
  }, [sectionJiraStatus, postedCategories, doSendSection]);

  const handleConfirmResend = useCallback((cat: string, catItems: ChecklistItem[]) => {
    setSConfirming(prev => ({ ...prev, [cat]: false }));
    doSendSection(cat, catItems);
  }, [doSendSection]);

  const handleCopySection = useCallback(async (cat: string, catItems: ChecklistItem[]) => {
    await navigator.clipboard.writeText(buildResultsText({ title: cat === SCENARIO_CATEGORY ? "Test execution results" : `Test execution results · ${cat}`, items: catItems, refLabel: effectiveRefLabel, environment }));
    setSectionCopied(prev => ({ ...prev, [cat]: true }));
    setTimeout(() => setSectionCopied(prev => ({ ...prev, [cat]: false })), 2500);
  }, [effectiveRefLabel, environment]);

  // ── No analysis ───────────────────────────────────────────────────────────
  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
        <p className="text-sm">Run an analysis first to generate a checklist.</p>
      </div>
    );
  }

  // ── Empty / loading ───────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-10 flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-100 mb-1">No checklist yet</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Generate a test execution checklist parsed from the analysis.</p>
        </div>
        <button onClick={handleGenerate}
          className="flex items-center gap-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl transition-colors">
          <RefreshCw className="w-4 h-4" /> Generate Checklist
        </button>
      </div>
    );
  }

  const toggleOpen = (id: string) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Mark a case; if it was open, close it and open the next untested one
  const mark = (item: ChecklistItem, status: ChecklistStatus, list: ChecklistItem[]) => {
    const newStatus = item.status === status ? "pending" : status;
    updateStatus(item.id, newStatus);
    if (newStatus !== "pending" && openIds.has(item.id)) {
      const idx = list.findIndex(i => i.id === item.id);
      const nextItem = [...list.slice(idx + 1), ...list.slice(0, idx)].find(i => i.status === "pending");
      setOpenIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        if (nextItem) next.add(nextItem.id);
        return next;
      });
    }
  };

  const counts = STATUS_OPTS.map(o => ({ ...o, n: items.filter(i => i.status === o.value).length }));

  // ── Main ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Summary + filters */}
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-800/95 backdrop-blur rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="font-bold text-slate-800 dark:text-slate-100">Test Execution</span>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-800 dark:text-slate-100">{done}</span> of {total} done · {pct}%
            </span>
          </div>
          <div className="flex items-center gap-2">
          <button
            onClick={() => setReporting({ kind: "bug", draft: emptyDraft(environment ?? "") })}
            title="Register a bug card or add an observation to the story"
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:border-rose-400"
          >
            <Bug className="w-3.5 h-3.5" /> Report issue
          </button>
          <EnvironmentControl value={environment} onChange={v => onEnvironmentChange?.(v)} />
          <RefLabelControl label={effectiveRefLabel} onChange={l => onRefLabelChange?.(l)} />
          <button
            onClick={() => setOpenIds(openIds.size ? new Set() : new Set(items.map(i => i.id)))}
            className="text-xs px-2.5 py-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {openIds.size ? "Collapse all" : "Expand all"}
          </button>
          </div>
        </div>

        {/* Segmented progress by status */}
        <div className="h-2 flex rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700">
          {counts.filter(c => c.value !== "pending" && c.n > 0).map(c => (
            <div key={c.value} className={`${STRIPE[c.value]} transition-all duration-300`} style={{ width: `${(c.n / Math.max(total, 1)) * 100}%` }} title={`${c.n} ${c.label}`} />
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {([{ value: "all" as const, label: "All", n: total, symbol: "" }, ...counts] as { value: ChecklistStatus | "all"; label: string; n: number; symbol: string }[])
            .filter(c => c.value === "all" || c.value === "pending" || c.n > 0)
            .map(c => (
              <button
                key={c.value}
                onClick={() => setStatusFilter(c.value)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors ${
                  statusFilter === c.value
                    ? "bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                }`}
              >
                {c.value !== "all" && <span className={`w-2 h-2 rounded-full ${STRIPE[c.value]}`} />}
                {c.label} <span className="opacity-60">{c.n}</span>
              </button>
            ))}
        </div>
      </div>

      <ReportsPanel reports={reports} environment={environment} onChange={r => onReportsChange?.(r)} onEdit={setEditingBug} />

      {editingBug && (
        <ReportIssueModal
          kind="bug"
          initial={editingBug.snapshot!.draft}
          editing={editingBug}
          storyKey={jiraKey}
          observationNumber={0}
          onSaved={r => onReportsChange?.(reportsRef.current.map(x => x.id === r.id ? r : x))}
          onClose={() => setEditingBug(null)}
        />
      )}

      {reporting && (
        <ReportIssueModal
          kind={reporting.kind}
          initial={reporting.draft}
          itemId={reporting.itemId}
          storyKey={jiraKey}
          observationNumber={reports.reduce((m, r) => Math.max(m, r.kind === "observation" ? r.number ?? 0 : 0), 0) + 1}
          onSaved={r => { const cur = reportsRef.current; onReportsChange?.(cur.some(x => x.id === r.id) ? cur.map(x => x.id === r.id ? r : x) : [...cur, r]); }}
          onClose={() => setReporting(null)}
        />
      )}

      {/* Section tabs (only when there is more than one section) */}
      {categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {categories.map(cat => {
            const catItems = items.filter(i => i.category === cat);
            const catDone  = catItems.filter(i => i.status !== "pending").length;
            const isActive = cat === effectiveCat;
            const isSentToJira = postedCategories.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => setActiveCat(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-emerald-400"
                }`}
              >
                {isSentToJira && !isActive && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-blue-500 text-white leading-none">Jira</span>}
                {cat}
                <span className={`px-1.5 py-0.5 rounded-full font-semibold ${isActive ? "bg-white/20" : "bg-slate-100 dark:bg-slate-700"}`}>{catDone}/{catItems.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active section */}
      {categories.filter(cat => cat === effectiveCat).map(cat => {
        const catItems   = items.filter(i => i.category === cat);
        const shown      = statusFilter === "all" ? catItems : catItems.filter(i => i.status === statusFilter);
        const catDone    = catItems.filter(i => i.status !== "pending").length;
        const catTotal   = catItems.length;
        const catAllDone = catTotal > 0 && catDone === catTotal;
        const isEmpty    = catTotal === 0;
        const sStatus    = sectionJiraStatus[cat] ?? "idle";
        const sCopied    = sectionCopied[cat] ?? false;
        const alreadySentToJira = postedCategories.includes(cat);

        return (
          <div key={cat} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Section header */}
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
              {editingCatName === cat ? (
                <input
                  autoFocus
                  value={catNameValue}
                  onChange={e => setCatNameValue(e.target.value)}
                  onBlur={() => renameCat(cat, catNameValue)}
                  onKeyDown={e => { if (e.key === "Enter") renameCat(cat, catNameValue); if (e.key === "Escape") setEditingCatName(null); }}
                  className="text-sm font-semibold text-slate-700 dark:text-slate-200 bg-transparent border-b-2 border-emerald-400 focus:outline-none flex-1 min-w-0"
                />
              ) : (
                <div className="group/catname flex items-center gap-1.5 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{cat}</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{catDone}/{catTotal}</span>
                  <button
                    onClick={() => { setEditingCatName(cat); setCatNameValue(cat); }}
                    title="Rename this section"
                    className="opacity-0 group-hover/catname:opacity-100 p-0.5 rounded text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-opacity"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => setAddingCat(addingCat === cat ? null : cat)}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 px-2.5 py-1 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add test case
                </button>
                {catDone > 0 && (
                  <button
                    onClick={() => onChecklistChange(items.map(i => i.category === cat ? { ...i, status: "pending" } : i))}
                    title="Reset all statuses in this section to Not tested"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => deleteSection(cat)}
                  title="Delete this entire section"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Finished banner: share results — shown at the top once every case is marked */}
            {!isEmpty && catAllDone && (
              <div className="px-5 py-3 border-b border-emerald-200/70 dark:border-emerald-500/20 bg-gradient-to-r from-emerald-50 to-transparent dark:from-emerald-500/10 dark:to-transparent flex items-center justify-between gap-3 flex-wrap animate-section-in">
                <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                  <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center"><CheckCheck className="w-3.5 h-3.5" /></span>
                  <span className="font-medium text-slate-800 dark:text-slate-100">All {catTotal} cases checked</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => downloadSectionXlsx(cat, catItems, storyTitle, jiraKey, effectiveRefLabel, environment)}
                  title="Download the results as an Excel file"
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700"
                >
                  <Download className="w-3.5 h-3.5" /> Download Excel
                </button>
                {jiraKey ? (
                  sConfirming[cat] ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Already sent — re-send?</span>
                      <button onClick={() => handleConfirmResend(cat, catItems)} className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded-lg">
                        <Send className="w-3 h-3" /> Yes, resend
                      </button>
                      <button onClick={() => setSConfirming(prev => ({ ...prev, [cat]: false }))} className="flex items-center gap-1 text-xs bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 px-2.5 py-1.5 rounded-lg">
                        <X className="w-3 h-3" /> Cancel
                      </button>
                    </div>
                  ) : (sStatus === "posted" || alreadySentToJira) ? (
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2.5 py-1.5 rounded-lg">
                        <Check className="w-3 h-3" /> Sent to {jiraKey}
                      </span>
                      <button onClick={() => setSConfirming(prev => ({ ...prev, [cat]: true }))} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2">
                        Resend?
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleSendSectionJira(cat, catItems)}
                      disabled={sStatus === "posting"}
                      title={sectionJiraError[cat] ?? `Post a results comment on ${jiraKey} with the Excel file attached`}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg disabled:opacity-60 ${
                        sStatus === "error" ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-100" : "bg-blue-600 hover:bg-blue-700 text-white"
                      }`}
                    >
                      {sStatus === "posting" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sStatus === "error" ? <AlertCircle className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
                      {sStatus === "posting" ? "Sending…" : sStatus === "error" ? "Failed — retry?" : `Send to ${jiraKey} + Excel`}
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleCopySection(cat, catItems)}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg ${
                      sCopied ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {sCopied ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {sCopied ? "Copied!" : "Copy results"}
                  </button>
                )}
                </div>
              </div>
            )}


            {/* Add form */}
            {addingCat === cat && (
              <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700/60 bg-emerald-50/40 dark:bg-emerald-500/5">
                <ScenarioEditor newId={nextTcId} onSave={t => addItem(cat, t)} onCancel={() => setAddingCat(null)} />
              </div>
            )}

            {/* Rows */}
            {isEmpty ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No test cases yet. Use “Add test case” above.</p>
            ) : shown.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nothing here for this filter.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {shown.map(item => {
                  const isEditing = editingId === item.id;
                  const open = openIds.has(item.id) || isEditing;
                  const head = rowHead(item.description);
                  return (
                    <div key={item.id} className={`group relative ${open ? "bg-slate-50/70 dark:bg-slate-900/30" : "hover:bg-slate-50/60 dark:hover:bg-slate-700/20"}`}>
                      <span className={`absolute left-0 top-0 bottom-0 w-1 ${STRIPE[item.status]}`} />
                      <div className="flex items-center gap-3 pl-4 pr-3 py-2">
                        <button onClick={() => toggleOpen(item.id)} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-2.5 text-left py-0.5">
                          <ChevronRight className={`w-4 h-4 flex-shrink-0 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`} />
                          {head.id && <span className="flex-shrink-0 font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300">{head.id}</span>}
                          <span className={`text-sm truncate ${item.status === "na" ? "line-through text-slate-400" : "text-slate-800 dark:text-slate-100"}`}>
                            <InlineText text={head.title} />
                          </span>
                          {head.outcome && <span className="flex-shrink-0 hidden sm:inline"><OutcomeTag outcome={head.outcome} /></span>}
                          {reports.filter(r => r.itemId === item.id).map(r => (
                            <span key={r.id} title={r.title} className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${r.kind === "bug" ? "bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                              {r.kind === "bug" ? <><Bug className="w-3 h-3" />{r.key}</> : <><Search className="w-3 h-3" />#{r.number}</>}
                            </span>
                          ))}
                        </button>
                        <div className="flex-shrink-0 flex items-center gap-0.5">
                          <button
                            onClick={() => {
                              if (isEditing) { setEditingId(null); return; }
                              setEditingId(item.id);
                            }}
                            title={isEditing ? "Close editor" : "Edit this test case"}
                            className={`w-7 h-7 mr-1 rounded-lg flex items-center justify-center transition-all ${
                              isEditing
                                ? "bg-violet-100 dark:bg-violet-500/20 text-violet-600 dark:text-violet-300"
                                : `text-slate-400 hover:bg-violet-50 dark:hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300 ${open ? "" : "opacity-0 group-hover:opacity-100"}`
                            }`}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <RefCell
                            value={item.ref}
                            label={effectiveRefLabel}
                            alwaysShow={open}
                            onSave={v => onChecklistChange(items.map(i => i.id === item.id ? { ...i, ref: v || undefined } : i))}
                          />
                          <span className="w-px h-4 bg-slate-200 dark:bg-slate-700 mr-1" />
                          {STATUS_OPTS.filter(o => o.value !== "pending").map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => mark(item, opt.value, shown)}
                              title={item.status === opt.value ? `${opt.label} (click to undo)` : opt.label}
                              className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center font-medium transition-all ${item.status === opt.value ? opt.active : opt.inactive}`}
                            >
                              {opt.symbol}
                            </button>
                          ))}
                          <button
                            onClick={() => deleteItem(item.id)}
                            title="Delete this test case"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {open && (
                        <div className="pl-11 pr-4 pb-4 animate-section-in">
                          {isEditing && isScenarioText(item.description) ? (
                            <ScenarioEditor
                              text={item.description}
                              onCancel={() => setEditingId(null)}
                              onSave={(text) => {
                                onChecklistChange(items.map(i => i.id === item.id ? { ...i, description: text } : i));
                                setEditingId(null);
                              }}
                            />
                          ) : isEditing ? (
                            <MarkdownEditor
                              value={item.description}
                              onCancel={() => setEditingId(null)}
                              onSave={(v) => {
                                onChecklistChange(items.map(i => i.id === item.id ? { ...i, description: v } : i));
                                setEditingId(null);
                              }}
                            />
                          ) : (
                            <div className="space-y-2">
                              <DescriptionLines
                                text={item.description}
                                hideHead
                                className="text-sm text-slate-700 dark:text-slate-300"
                                apis={itemApis(item)}
                                onApisChange={apis => onChecklistChange(items.map(i => i.id === item.id ? { ...i, apis: apis.length ? apis : undefined, api: undefined } : i))}
                              />
                            </div>
                          )}
                          {!isEditing && (
                            <div className={`mt-3 flex items-center gap-2 ${["failed", "blocked", "clarification"].includes(item.status) ? "" : "opacity-70 hover:opacity-100"}`}>
                              <button
                                onClick={() => setReporting({ kind: "bug", itemId: item.id, draft: draftFromItem(item, { environment, refLabel: effectiveRefLabel }) })}
                                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                              >
                                <Bug className="w-3.5 h-3.5" /> Report bug
                              </button>
                              {jiraKey && (
                                <button
                                  onClick={() => setReporting({ kind: "observation", itemId: item.id, draft: draftFromItem(item, { environment, refLabel: effectiveRefLabel }) })}
                                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                                >
                                  <Search className="w-3.5 h-3.5" /> Add observation
                                </button>
                              )}
                              <span className="text-[11px] text-slate-400">pre-filled from this test case</span>
                            </div>
                          )}
                          {!isEditing && !isScenarioText(item.description) && (
                            <ApiRequestList
                              value={itemApis(item)}
                              steps={[]}
                              onChange={apis => onChecklistChange(items.map(i => i.id === item.id ? { ...i, apis: apis.length ? apis : undefined, api: undefined } : i))}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        );
      })}
    </div>
  );
}

