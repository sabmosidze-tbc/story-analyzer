// Test-design model (EP / BVA / decision tables / state transitions) and the
// deterministic coverage check. Shared by the API route and the UI.

export type Technique = "EP" | "BVA" | "DT" | "ST";
export type Outcome = "accepted" | "rejected";

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  EP: "Equivalence Partitioning",
  BVA: "Boundary Value Analysis",
  DT: "Decision Table",
  ST: "State Transition",
};

/** Plain-language outcome labels: "rejected" = negative test, the system must refuse. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  accepted: "Positive",
  rejected: "Negative",
};

export const OUTCOME_HINT: Record<Outcome, string> = {
  accepted: "Positive test: the system should allow this and complete the action.",
  rejected: "Negative test: the system should refuse this (error/validation) and change nothing.",
};

export interface Partition {
  id: string;            // EP1, EP2…
  variable: string;      // e.g. "Loan status"
  label: string;         // e.g. "Status in the allowed set"
  value: string;         // representative test value, e.g. "Written Off"
  outcome: Outcome;      // valid class → accepted, invalid class → rejected
  note?: string;
}

export interface Boundary {
  id: string;            // BV1…
  variable: string;      // e.g. "New interest rate"
  value: string;         // e.g. "30.01"
  unit?: string;         // e.g. "%"
  position: "below-min" | "min" | "max" | "above-max";
  outcome: Outcome;
}

export interface DecisionRule {
  id: string;            // DT1-R1…
  when: string[];        // one value per condition ("Y", "N", "Late", "-" = don't care)
  then: string[];        // one value per action
  outcome: Outcome;
  why?: string;          // short reason for this rule, in story terms
}

export interface DecisionTable {
  id: string;            // DT1
  title: string;
  conditions: string[];
  actions: string[];
  rules: DecisionRule[];
  reasoning?: string;    // why these conditions, how rules were collapsed
  source?: string;       // story sentence(s) the table is built from
}

/** Something the story leaves open that blocks precise test design. */
export interface Gap {
  topic: string;         // short title, e.g. "Equal-rate error code"
  detail: string;        // what exactly is missing
  impact?: string;       // why it matters for testing
  question?: string;     // what to ask the BA/PO
  assumption?: string;   // what the scenarios assume until answered
}

export interface Transition {
  id: string;            // ST1…
  from: string;
  event: string;
  to: string;            // target state, or same as from when blocked
  outcome: Outcome;      // allowed → accepted, blocked → rejected
}

export interface Scenario {
  id: string;            // TC1…
  title: string;
  technique: Technique;
  covers: string[];      // model item ids
  preconditions: string;
  steps: string[];
  data: Record<string, string>;
  expected: string;
  outcome: Outcome;
  priority: "high" | "medium" | "low";
}

export interface CoverageIssue {
  scenarioId: string;
  itemId: string;
  reason: string;
}

export interface Coverage {
  total: number;
  covered: number;
  uncovered: string[];
  issues: CoverageIssue[];
  repaired: number;      // scenarios added by the automatic gap-fill round
}

export interface TestDesign {
  techniques: { technique: Technique; reason: string }[];
  /** Techniques considered and deliberately not used (AI reason, or a code check). */
  notUsed?: { technique: Technique; reason: string }[];
  partitions: Partition[];
  boundaries: Boundary[];
  decisionTables: DecisionTable[];
  transitions: Transition[];
  scenarios: Scenario[];
  gaps: Gap[];
  coverage: Coverage;
  model?: string;
  generatedAt: string;
}

// ── Model item lookup ─────────────────────────────────────────────────────────

export interface ModelItem {
  id: string;
  technique: Technique;
  label: string;
  outcome: Outcome;
  value?: string;        // BVA value / EP label / state, used for consistency checks
}

export function modelItems(d: Pick<TestDesign, "partitions" | "boundaries" | "decisionTables" | "transitions">): ModelItem[] {
  return [
    ...d.partitions.map((p) => ({ id: p.id, technique: "EP" as const, label: `${p.variable}: ${p.label}`, outcome: p.outcome, value: p.value })),
    ...d.boundaries.map((b) => ({ id: b.id, technique: "BVA" as const, label: `${b.variable} = ${b.value}${b.unit ?? ""}`, outcome: b.outcome, value: b.value })),
    ...d.decisionTables.flatMap((t) =>
      t.rules.map((r) => ({
        id: r.id,
        technique: "DT" as const,
        label: `${t.title}: ${t.conditions.map((c, i) => `${c}=${r.when[i] ?? "-"}`).join(", ")}`,
        outcome: r.outcome,
      })),
    ),
    ...d.transitions.map((t) => ({ id: t.id, technique: "ST" as const, label: `${t.from} → ${t.event} → ${t.to}`, outcome: t.outcome, value: t.from })),
  ];
}

// ── Coverage check (deterministic, no AI) ─────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[\s,]/g, "");
const numeric = (s: string) => {
  const m = s.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

function scenarioText(s: Scenario): string {
  return [s.title, s.preconditions, ...s.steps, ...Object.values(s.data)].join(" ");
}

/** Is `item` really exercised by `s`? Returns a reason string when the claim looks false. */
function checkClaim(item: ModelItem, s: Scenario): string | null {
  const text = scenarioText(s);
  if (item.technique === "BVA" && item.value) {
    const target = numeric(item.value);
    const values = Object.values(s.data).map(numeric).filter((n): n is number => n !== null);
    const hit = target !== null
      ? values.some((v) => Math.abs(v - target) < 1e-9) || norm(text).includes(norm(item.value))
      : norm(text).includes(norm(item.value));
    if (!hit) return `test data does not use the boundary value ${item.value}`;
  }
  if ((item.technique === "EP" || item.technique === "ST") && item.value && item.value.length <= 40) {
    const n = numeric(item.value);
    const values = Object.values(s.data).map(numeric);
    const hit = norm(text).includes(norm(item.value)) || (n !== null && /^[\d.,\s%-]+$/.test(item.value) && values.includes(n));
    if (!hit) return `scenario never uses "${item.value}"`;
  }
  return null;
}

export function computeCoverage(d: Omit<TestDesign, "coverage" | "generatedAt">, repaired = 0): Coverage {
  const items = modelItems(d);
  const byId = new Map(items.map((i) => [i.id, i]));
  const coveredIds = new Set<string>();
  const issues: CoverageIssue[] = [];

  for (const s of d.scenarios) {
    const claimed = s.covers.map((id) => byId.get(id)).filter((i): i is ModelItem => !!i);
    const valid: ModelItem[] = [];
    for (const item of claimed) {
      const reason = checkClaim(item, s);
      if (reason) issues.push({ scenarioId: s.id, itemId: item.id, reason });
      else valid.push(item);
    }

    // EP/BVA rule: one invalid class per test, otherwise one error can mask another
    const rejecting = valid.filter((i) => i.outcome === "rejected" && (i.technique === "EP" || i.technique === "BVA"));
    if (rejecting.length > 1) {
      issues.push({
        scenarioId: s.id,
        itemId: rejecting.map((i) => i.id).join("+"),
        reason: "combines several invalid values, so one error can hide another",
      });
      continue;
    }

    // Expected result must agree with the model
    const expectRejected = valid.some((i) => i.outcome === "rejected");
    const expectedOutcome: Outcome = expectRejected ? "rejected" : "accepted";
    if (valid.length && s.outcome !== expectedOutcome) {
      issues.push({
        scenarioId: s.id,
        itemId: valid.map((i) => i.id).join("+"),
        reason: `expects "${s.outcome}" but the model says "${expectedOutcome}"`,
      });
      continue;
    }

    valid.forEach((i) => coveredIds.add(i.id));
  }

  return {
    total: items.length,
    covered: items.filter((i) => coveredIds.has(i.id)).length,
    uncovered: items.filter((i) => !coveredIds.has(i.id)).map((i) => i.id),
    issues,
    repaired,
  };
}

// ── Normalisation of raw AI output ────────────────────────────────────────────

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const outcome = (v: unknown): Outcome => (str(v).toLowerCase().startsWith("rej") || str(v).toLowerCase() === "invalid" ? "rejected" : "accepted");
const TECHS: Technique[] = ["EP", "BVA", "DT", "ST"];
const tech = (v: unknown): Technique => (TECHS.includes(str(v).toUpperCase() as Technique) ? (str(v).toUpperCase() as Technique) : "EP");

export function normalizeScenarios(raw: unknown, startAt = 1): Scenario[] {
  return arr<Record<string, unknown>>(raw).map((s, i) => ({
    id: `TC${startAt + i}`,
    title: str(s.title) || `Scenario ${startAt + i}`,
    technique: tech(s.technique),
    covers: arr<unknown>(s.covers).map(str).filter(Boolean),
    preconditions: str(s.preconditions),
    steps: arr<unknown>(s.steps).map(str).filter(Boolean),
    data: Object.fromEntries(
      Object.entries((s.data && typeof s.data === "object" ? s.data : {}) as Record<string, unknown>).map(([k, v]) => [k, str(v)]),
    ),
    expected: str(s.expected),
    outcome: outcome(s.outcome),
    priority: (["high", "medium", "low"].includes(str(s.priority)) ? str(s.priority) : "medium") as Scenario["priority"],
  }));
}

export function normalizeModel(raw: Record<string, unknown>) {
  const positions = ["below-min", "min", "max", "above-max"] as const;
  return {
    techniques: arr<Record<string, unknown>>(raw.techniques).map((t) => ({ technique: tech(t.technique), reason: str(t.reason) })),
    partitions: arr<Record<string, unknown>>(raw.partitions).map((p) => ({
      id: str(p.id), variable: str(p.variable), label: str(p.label), value: str(p.value) || str(p.label),
      outcome: outcome(p.outcome), note: str(p.note) || undefined,
    })).filter((p) => p.id),
    boundaries: arr<Record<string, unknown>>(raw.boundaries).map((b) => ({
      id: str(b.id), variable: str(b.variable), value: str(b.value), unit: str(b.unit) || undefined,
      position: (positions as readonly string[]).includes(str(b.position)) ? (str(b.position) as Boundary["position"]) : "min",
      outcome: outcome(b.outcome),
    })).filter((b) => b.id),
    decisionTables: arr<Record<string, unknown>>(raw.decisionTables).map((t) => ({
      id: str(t.id), title: str(t.title),
      conditions: arr<unknown>(t.conditions).map(str),
      actions: arr<unknown>(t.actions).map(str),
      rules: arr<Record<string, unknown>>(t.rules).map((r) => ({
        id: str(r.id), when: arr<unknown>(r.when).map(str), then: arr<unknown>(r.then).map(str), outcome: outcome(r.outcome),
        why: str(r.why) || undefined,
      })).filter((r) => r.id),
      reasoning: str(t.reasoning) || undefined,
      source: str(t.source) || undefined,
    })).filter((t) => t.id),
    transitions: arr<Record<string, unknown>>(raw.transitions).map((t) => ({
      id: str(t.id), from: str(t.from), event: str(t.event), to: str(t.to), outcome: outcome(t.outcome),
    })).filter((t) => t.id),
    notUsed: arr<Record<string, unknown>>(raw.notUsed).map((t) => ({ technique: tech(t.technique), reason: str(t.reason) })).filter((t) => t.reason),
    gaps: normalizeGaps(raw.gaps),
  };
}

export function normalizeGaps(raw: unknown): Gap[] {
  return arr<unknown>(raw).map((g): Gap | null => {
    if (typeof g === "string") return g.trim() ? { topic: "", detail: g.trim() } : null;
    if (!g || typeof g !== "object") return null;
    const o = g as Record<string, unknown>;
    const detail = str(o.detail) || str(o.missing) || str(o.text);
    if (!detail && !str(o.topic)) return null;
    return {
      topic: str(o.topic),
      detail,
      impact: str(o.impact) || undefined,
      question: str(o.question) || undefined,
      assumption: str(o.assumption) || undefined,
    };
  }).filter((g): g is Gap => !!g);
}

/**
 * State Transition only fits when the feature actually moves something between states.
 * If no accepted transition changes state, the "states" are just eligibility classes,
 * so they're re-filed as Equivalence Partitions (same ids, so coverage still lines up).
 */
export function demoteFakeTransitions<T extends Pick<TestDesign, "transitions" | "partitions" | "techniques"> & { notUsed?: TestDesign["notUsed"] }>(
  d: T,
  scenarios: Scenario[],
): { design: T; scenarios: Scenario[] } {
  if (!d.transitions.length) return { design: d, scenarios };
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const realChange = d.transitions.some((t) => t.outcome === "accepted" && t.to && !same(t.from, t.to));
  if (realChange) return { design: d, scenarios };
  const asPartitions: Partition[] = d.transitions.map((t) => ({
    id: t.id,
    variable: "Status",
    label: `${t.from}: ${t.event} ${t.outcome === "accepted" ? "allowed" : "blocked"}`,
    value: t.from,
    outcome: t.outcome,
  }));
  return {
    design: {
      ...d,
      transitions: [],
      techniques: [
        ...d.techniques.filter((t) => t.technique !== "ST"),
        ...(d.techniques.some((t) => t.technique === "EP") ? [] : [{ technique: "EP" as const, reason: "Each status is a class that is either allowed or blocked." }]),
      ],
      partitions: [...d.partitions, ...asPartitions],
      notUsed: [
        ...(d.notUsed ?? []).filter((n) => n.technique !== "ST"),
        { technique: "ST", reason: "The story doesn't change any status; the status only decides whether the action is allowed. Those cases are tested as Equivalence Partitions instead." },
      ],
    },
    scenarios: scenarios.map((s) => (s.technique === "ST" ? { ...s, technique: "EP" as const } : s)),
  };
}

// ── Grounding check: drop decision tables the story doesn't support ───────────

const words = (s: string) => s.toLowerCase().normalize("NFKD").match(/[a-z0-9_]{4,}/g) ?? [];

/** Share of the table's distinctive words (source, conditions, actions) that appear in the story. */
export function groundingScore(t: DecisionTable, story: string): number {
  const storyWords = new Set(words(story));
  const own = new Set(words([t.source ?? "", ...t.conditions, ...t.actions].join(" ")));
  if (own.size === 0) return 1;
  let hit = 0;
  own.forEach((w) => { if (storyWords.has(w)) hit++; });
  return hit / own.size;
}

export function dropUngroundedTables<T extends Pick<TestDesign, "decisionTables"> & { notUsed?: TestDesign["notUsed"] }>(d: T, story: string): T {
  const keep = d.decisionTables.filter((t) => groundingScore(t, story) >= 0.6);
  if (keep.length === d.decisionTables.length) return d;
  const dropped = d.decisionTables.filter((t) => !keep.includes(t)).map((t) => `“${t.title}”`).join(", ");
  return {
    ...d,
    decisionTables: keep,
    notUsed: keep.length ? d.notUsed : [
      ...(d.notUsed ?? []).filter((n) => n.technique !== "DT"),
      { technique: "DT", reason: `Removed ${dropped}: its conditions don't match the story text.` },
    ],
  };
}

// ── Decision table quality check (deterministic) ──────────────────────────────

const isAny = (v: string) => !v.trim() || v.trim() === "-" || v.trim() === "*";
const yn = (v: string) => {
  const s = v.trim().toUpperCase();
  return s === "Y" || s === "YES" || s === "T" || s === "TRUE" ? "Y" : s === "N" || s === "NO" || s === "F" || s === "FALSE" ? "N" : s;
};

export interface TableCheck {
  conditions: number;
  combinations: number;       // every possible combination of condition values
  covered: number;            // combinations matched by at least one rule
  missing: string[][];        // examples of uncovered combinations (max 3)
  conflicts: { a: string; b: string }[]; // rules overlapping with different results
  overlaps: { a: string; b: string }[];  // rules overlapping with the same result (redundant)
  collapsed: boolean;         // uses don't-care to merge cases
  tooLarge: boolean;
}

export function checkDecisionTable(t: DecisionTable): TableCheck {
  const n = t.conditions.length;
  const domains = t.conditions.map((_, ci) => {
    const vals = new Set<string>();
    t.rules.forEach((r) => { const v = r.when[ci] ?? "-"; if (!isAny(v)) vals.add(yn(v)); });
    if ([...vals].every((v) => v === "Y" || v === "N")) { vals.add("Y"); vals.add("N"); }
    return [...vals];
  });
  const combinations = domains.reduce((a, d) => a * Math.max(1, d.length), 1);
  const matches = (r: DecisionRule, combo: string[]) => combo.every((v, ci) => isAny(r.when[ci] ?? "-") || yn(r.when[ci]) === v);
  const result = (r: DecisionRule) => `${r.outcome}|${r.then.map((x) => (x.trim() ? "x" : "")).join(",")}`;
  const collapsed = t.rules.some((r) => r.when.some(isAny));
  const empty: TableCheck = { conditions: n, combinations, covered: 0, missing: [], conflicts: [], overlaps: [], collapsed, tooLarge: true };
  if (n === 0 || combinations > 4096) return empty;

  let covered = 0;
  const missing: string[][] = [];
  const conflictKeys = new Set<string>();
  const overlapKeys = new Set<string>();
  const combo = new Array<string>(n);
  const walk = (i: number) => {
    if (i === n) {
      const hit = t.rules.filter((r) => matches(r, combo));
      if (hit.length) covered++;
      else if (missing.length < 3) missing.push([...combo]);
      for (let a = 0; a < hit.length; a++) for (let b = a + 1; b < hit.length; b++) {
        const key = `${hit[a].id}|${hit[b].id}`;
        (result(hit[a]) === result(hit[b]) ? overlapKeys : conflictKeys).add(key);
      }
      return;
    }
    for (const v of domains[i]) { combo[i] = v; walk(i + 1); }
  };
  walk(0);
  const pairs = (s: Set<string>) => [...s].map((k) => { const [a, b] = k.split("|"); return { a, b }; });
  return { conditions: n, combinations, covered, missing, conflicts: pairs(conflictKeys), overlaps: pairs(overlapKeys), collapsed, tooLarge: false };
}

// ── Checklist conversion ──────────────────────────────────────────────────────

/** Markdown version for PDF export / Jira. */
export function testDesignToMarkdown(d: TestDesign): string {
  const out: string[] = [];
  out.push(`**Coverage: ${d.coverage.covered}/${d.coverage.total} model items** · ${d.scenarios.length} scenarios · techniques: ${d.techniques.map((t) => t.technique).join(", ")}`);
  for (const t of ["EP", "BVA", "DT", "ST"] as Technique[]) {
    const list = d.scenarios.filter((s) => s.technique === t);
    if (!list.length) continue;
    out.push(`\n### ${TECHNIQUE_LABEL[t]}`);
    for (const s of list) {
      const data = Object.entries(s.data).map(([k, v]) => `${k}: ${v}`).join(", ");
      out.push(`- **${s.id} ${s.title}** (covers ${s.covers.join(", ")})`);
      if (s.preconditions) out.push(`  Given: ${s.preconditions}`);
      if (data) out.push(`  Data: ${data}`);
      out.push(`  → **${OUTCOME_LABEL[s.outcome]}** — ${s.expected}`);
    }
  }
  if (d.gaps.length) {
    out.push(`\n### Missing from the story`);
    d.gaps.forEach((g) => {
      out.push(`- ${g.topic ? `**${g.topic}:** ` : ""}${g.detail}`);
      if (g.impact) out.push(`  Why it matters: ${g.impact}`);
      if (g.question) out.push(`  Ask: ${g.question}`);
      if (g.assumption) out.push(`  Assumed for now: ${g.assumption}`);
    });
  }
  return out.join("\n");
}

/** Editable, structured view of a scenario checklist item (stored as text). */
export interface ScenarioText {
  id: string;
  title: string;
  given: string;
  steps: string[];
  data: [string, string][];
  outcome: Outcome | null;
  expected: string[];
}

export const SCENARIO_HEAD = /^\*\*(TC\d+)\s*·\s*(.+?)\*\*$/;

export function isScenarioText(text: string): boolean {
  return SCENARIO_HEAD.test(text.split("\n")[0].trim());
}

export function formatScenarioText(s: ScenarioText): string {
  const lines = [`**${s.id} · ${s.title.trim()}**`];
  if (s.given.trim()) lines.push(`Given: ${s.given.trim()}`);
  for (const st of s.steps) if (st.trim()) lines.push(`Step: ${st.trim()}`);
  const data = s.data.filter(([k]) => k.trim()).map(([k, v]) => `${k.trim()}: ${v.trim()}`).join(", ");
  if (data) lines.push(`Data: ${data}`);
  const exp = s.expected.map((e) => e.trim()).filter(Boolean).join("; ");
  lines.push(`Expected: ${s.outcome ? `**${OUTCOME_LABEL[s.outcome]}** — ` : ""}${exp}`);
  return lines.join("\n");
}

export function parseScenarioText(text: string): ScenarioText {
  const [head, ...rest] = text.split("\n").map((l) => l.trim());
  const m = head.match(SCENARIO_HEAD);
  const field = (name: string) => rest.find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? "";
  const steps = rest.filter((l) => l.startsWith("Step:")).map((l) => l.slice(5).trim());
  const data = field("Data");
  const expRaw = field("Expected");
  const em = expRaw.match(/^\*\*(Accepted|Rejected|Should work|Should be blocked|Positive|Negative)\*\*\s*—?\s*(.*)$/);
  const outcome: Outcome | null = em ? (/^(Rejected|Should be blocked|Negative)$/.test(em[1]) ? "rejected" : "accepted") : null;
  const expBody = (em ? em[2] : expRaw).replace(/\.$/, "");
  // New format separates checks with ";"; older items used commas.
  const expected = (expBody.includes(";") ? expBody.split(/;\s*/) : expBody.split(/,\s+(?=[A-Za-z])/))
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => e.charAt(0).toUpperCase() + e.slice(1));
  return {
    id: m?.[1] ?? "TC",
    title: m?.[2] ?? head,
    given: field("Given"),
    steps,
    data: data
      ? data.split(/,\s+(?=[\w .-]{1,40}:)/).map((p): [string, string] => {
          const i = p.indexOf(":");
          return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ""];
        })
      : [],
    outcome,
    expected,
  };
}

export function scenarioChecklistDescription(s: Scenario): string {
  return formatScenarioText({
    id: s.id,
    title: s.title,
    given: s.preconditions,
    steps: s.steps,
    data: Object.entries(s.data).map(([k, v]) => [k, String(v)]),
    outcome: s.outcome,
    expected: s.expected.replace(/\.$/, "").split(/;\s*|,\s+(?=[A-Za-z])/),
  });
}

/** Checklist items (one per scenario) in a single list. */
export const SCENARIO_CATEGORY = "Test cases";

export function checklistFromTestDesign(d: TestDesign) {
  return d.scenarios.map((s, i) => ({
    id: `td-${i + 1}`,
    category: SCENARIO_CATEGORY,
    description: scenarioChecklistDescription(s),
    status: "pending" as const,
  }));
}
