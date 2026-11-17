// Client-safe Epic workspace types, AI output parsing and helpers.
import type { EpicContext, EpicStory, StoryEntry, ChecklistStatus } from "@/types";

export type RiskLevel = "high" | "medium" | "low";

export interface EpicStoryNote {
  key: string;
  role: string;              // what this story contributes to the epic, one line
  dependsOn: string[];       // story keys it relies on
  risk: RiskLevel;
  riskReason?: string;
}

export interface EpicE2EScenario {
  id: string;                // E2E1…
  title: string;
  stories: string[];
  priority: RiskLevel;
  steps: string[];
  expected: string[];
}

export interface EpicRisk { title: string; stories: string[]; why: string; severity: RiskLevel }
export interface EpicQuestion { question: string; stories: string[] }

export interface EpicAnalysis {
  goal: string;
  scope: string[];
  outOfScope: string[];
  businessRules: { rule: string; stories: string[] }[];
  dataEntities: { name: string; notes: string; stories: string[] }[];
  storyNotes: EpicStoryNote[];
  e2eScenarios: EpicE2EScenario[];
  integrationRisks: EpicRisk[];
  regression: string[];
  questions: EpicQuestion[];
  prerequisites: string[];
}

const arr = <T>(v: unknown, map: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : [];
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown): string[] => arr(v, (x) => str(x) || null);
const risk = (v: unknown): RiskLevel => { const s = String(v ?? "").trim().toLowerCase(); return s === "high" || s === "low" ? s : "medium"; };
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Tolerant parser: accepts raw JSON or JSON inside ``` fences. */
export function parseEpicOutput(raw: string): { analysis: EpicAnalysis; contextBlock: string } | null {
  const candidates = [raw.trim(), raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? "", raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const p = obj(JSON.parse(c));
      if (!p) continue;
      const contextBlock = str(p.contextBlock);
      const analysis: EpicAnalysis = {
        goal: str(p.goal),
        scope: strs(p.scope),
        outOfScope: strs(p.outOfScope),
        businessRules: arr(p.businessRules, (x) => { const o = obj(x); return o && str(o.rule) ? { rule: str(o.rule), stories: strs(o.stories) } : null; }),
        dataEntities: arr(p.dataEntities, (x) => { const o = obj(x); return o && str(o.name) ? { name: str(o.name), notes: str(o.notes), stories: strs(o.stories) } : null; }),
        storyNotes: arr(p.storyNotes, (x) => { const o = obj(x); return o && str(o.key) ? { key: str(o.key), role: str(o.role), dependsOn: strs(o.dependsOn), risk: risk(o.risk), riskReason: str(o.riskReason) || undefined } : null; }),
        e2eScenarios: arr(p.e2eScenarios, (x) => { const o = obj(x); return o && str(o.title) ? { id: str(o.id), title: str(o.title), stories: strs(o.stories), priority: risk(o.priority), steps: strs(o.steps), expected: strs(o.expected) } : null; })
          .map((s, i) => ({ ...s, id: s.id || `E2E${i + 1}` })),
        integrationRisks: arr(p.integrationRisks, (x) => { const o = obj(x); return o && str(o.title) ? { title: str(o.title), stories: strs(o.stories), why: str(o.why), severity: risk(o.severity) } : null; }),
        regression: strs(p.regression),
        questions: arr(p.questions, (x) => { const o = obj(x); return o && str(o.question) ? { question: str(o.question), stories: strs(o.stories) } : null; }),
        prerequisites: strs(p.prerequisites),
      };
      if (contextBlock || analysis.goal) return { analysis, contextBlock: contextBlock || analysis.goal };
    } catch { /* try next */ }
  }
  return null;
}

/** Small stable hash, used to notice stories that changed in Jira after the epic was analyzed. */
export function storyHash(s: Pick<EpicStory, "summary" | "description">): string {
  let h = 5381;
  const t = `${s.summary}\n${s.description}`.replace(/\s+/g, " ").trim();
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface EpicDrift { added: string[]; changed: string[]; removed: string[] }

export function epicDrift(epic: EpicContext): EpicDrift {
  const base = epic.analyzedHashes;
  const now = epic.stories;
  if (!base || !now) return { added: [], changed: [], removed: [] };
  const nowKeys = new Set(now.map((s) => s.key));
  return {
    added: now.filter((s) => !(s.key in base)).map((s) => s.key),
    changed: now.filter((s) => s.key in base && base[s.key] !== storyHash(s)).map((s) => s.key),
    removed: Object.keys(base).filter((k) => !nowKeys.has(k)),
  };
}

// ── Test progress per story (from the story history) ─────────────────────────

export interface StoryProgress {
  entryId?: string;
  analyzed: boolean;
  total: number;
  counts: Partial<Record<ChecklistStatus, number>>;
  state: "not-analyzed" | "analyzed" | "testing" | "failed" | "passed";
}

export function storyProgress(key: string, entries: StoryEntry[]): StoryProgress {
  const entry = entries.find((e) => e.jiraKey === key && !e.isPending);
  if (!entry) return { analyzed: false, total: 0, counts: {}, state: "not-analyzed" };
  const counts: Partial<Record<ChecklistStatus, number>> = {};
  for (const i of entry.checklist ?? []) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const total = entry.checklist?.length ?? 0;
  const done = total - (counts.pending ?? 0);
  const state: StoryProgress["state"] =
    (counts.failed ?? 0) > 0 ? "failed" : total > 0 && done === total ? "passed" : done > 0 ? "testing" : "analyzed";
  return {
    entryId: entry.id,
    analyzed: true,
    total,
    counts,
    state,
  };
}

export const isDoneStatus = (s: string) => /done|closed|resolved|complete|released/i.test(s);
export const isActiveStatus = (s: string) => /progress|review|test|qa|dev/i.test(s) && !isDoneStatus(s);

// ── Markdown export of the test strategy ─────────────────────────────────────

export function strategyMarkdown(epic: EpicContext): string {
  const a = epic.analysis;
  if (!a) return epic.contextBlock;
  const tag = (ks: string[]) => (ks.length ? ` _(${ks.join(", ")})_` : "");
  const out: string[] = [`# ${epic.epicKey} — ${epic.epicSummary}`, "", `**Goal:** ${a.goal}`, ""];
  if (a.e2eScenarios.length) {
    out.push("## End-to-end scenarios", "");
    for (const s of a.e2eScenarios) {
      out.push(`### ${s.id} · ${s.title} [${s.priority}]${tag(s.stories)}`);
      s.steps.forEach((st, i) => out.push(`${i + 1}. ${st}`));
      if (s.expected.length) out.push("", "**Expected:**", ...s.expected.map((e) => `- ${e}`));
      out.push("");
    }
  }
  if (a.integrationRisks.length) out.push("## Integration risks", "", ...a.integrationRisks.map((r) => `- **[${r.severity}] ${r.title}**${tag(r.stories)} — ${r.why}`), "");
  if (a.regression.length) out.push("## Regression", "", ...a.regression.map((r) => `- ${r}`), "");
  if (a.questions.length) out.push("## Open questions", "", ...a.questions.map((q) => `- ${q.question}${tag(q.stories)}`), "");
  if (a.prerequisites.length) out.push("## Test prerequisites", "", ...a.prerequisites.map((p) => `- ${p}`), "");
  return out.join("\n").trim();
}
