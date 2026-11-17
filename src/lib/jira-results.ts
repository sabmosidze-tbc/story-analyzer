import type { ApiRequest, ChecklistItem, ChecklistStatus } from "@/types";
import { isScenarioText, parseScenarioText, OUTCOME_LABEL } from "@/lib/test-design";

// ── Minimal ADF (Atlassian Document Format) types ────────────────────────────
type Mark = { type: "strong" } | { type: "em" } | { type: "code" } | { type: "link"; attrs: { href: string } };
type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "status"; attrs: { text: string; color: "neutral" | "purple" | "blue" | "red" | "yellow" | "green" } };
type Paragraph = { type: "paragraph"; content: Inline[] };
type Heading = { type: "heading"; attrs: { level: number }; content: Inline[] };
type ListItem = { type: "listItem"; content: (Paragraph | CodeBlock)[] };
type List = { type: "bulletList" | "orderedList"; content: ListItem[] };
type Rule = { type: "rule" };
type CodeBlock = { type: "codeBlock"; attrs: { language: string }; content: { type: "text"; text: string }[] };
type Cell = { type: "tableHeader" | "tableCell"; attrs: Record<string, never>; content: (Paragraph | List)[] };
type Table = { type: "table"; attrs: { isNumberColumnEnabled: boolean; layout: "default" }; content: { type: "tableRow"; content: Cell[] }[] };
export type AdfBlock = Paragraph | Heading | Table | List | Rule | CodeBlock;
export type AdfDoc = { type: "doc"; version: 1; content: AdfBlock[] };

const t = (text: string, ...marks: Mark[]): Inline => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const b = (text: string) => t(text, { type: "strong" });
const p = (...content: Inline[]): Paragraph => ({ type: "paragraph", content });
const list = (kind: List["type"], items: string[]): List => ({ type: kind, content: items.map((i) => ({ type: "listItem", content: [p(t(i))] })) });
const code = (text: string, language: string): CodeBlock => ({ type: "codeBlock", attrs: { language }, content: [{ type: "text", text }] });
const cell = (kind: Cell["type"], ...content: Inline[]): Cell => ({ type: kind, attrs: {}, content: [p(...content)] });

// ── Status presentation ──────────────────────────────────────────────────────
export const RESULT: Record<ChecklistStatus, { text: string; label: string; color: "neutral" | "purple" | "red" | "yellow" | "green" }> = {
  failed:        { text: "FAILED",              label: "Failed",              color: "red" },
  blocked:       { text: "BLOCKED",             label: "Blocked",             color: "purple" },
  clarification: { text: "NEEDS CLARIFICATION", label: "Needs clarification", color: "yellow" },
  passed:        { text: "PASSED",              label: "Passed",              color: "green" },
  na:            { text: "N/A",                 label: "N/A",                 color: "neutral" },
  pending:       { text: "NOT RUN",             label: "Not run",             color: "neutral" },
};
export const RESULT_ORDER: ChecklistStatus[] = ["failed", "blocked", "clarification", "passed", "na", "pending"];
const PROBLEM: ChecklistStatus[] = ["failed", "blocked", "clarification"];
const status = (s: ChecklistStatus): Inline => ({ type: "status", attrs: { text: RESULT[s].text, color: RESULT[s].color } });

/** "(gap 3)" etc. refer to the app's internal gap list — meaningless in Jira. */
export function clean(s: string): string {
  return s
    .replace(/\s*\((?:see )?gaps? \d+(?:\s*(?:,|and)\s*\d+)*\)/gi, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Everything we know about one test case, ready for export. */
export interface ResultRow {
  id: string;
  title: string;
  given: string;
  steps: string[];
  data: [string, string][];
  expected: string[];
  type: string;
  ref: string;
  apis: ApiRequest[];
  status: ChecklistStatus;
}

/** Pretty-prints JSON payloads; anything else is returned as typed. */
export function formatPayload(body: string): { text: string; json: boolean } {
  const raw = body.trim();
  if (!raw) return { text: "", json: false };
  try { return { text: JSON.stringify(JSON.parse(raw), null, 2), json: true }; }
  catch { return { text: raw, json: false }; }
}

/** "POST /api/loans/1/rate" + formatted payload, for code blocks and Excel. */
export function requestText(api: ApiRequest): string {
  const head = `${api.method.toUpperCase()} ${api.url.trim()}`.trim();
  const body = formatPayload(api.body ?? "").text;
  return body ? `${head}\n\n${body}` : head;
}

/** Method + endpoint line, then the payload as a highlighted code block. */
function requestBlocks(api: ApiRequest, label?: string): AdfBlock[] {
  const body = formatPayload(api.body ?? "");
  const line = p(...(label ? [b(label)] : []), t(`${api.method.toUpperCase()} ${api.url.trim() || "—"}`, { type: "code" }));
  return body.text ? [line, code(body.text, body.json ? "json" : "text")] : [line];
}

const hasApi = (api?: ApiRequest): api is ApiRequest => !!api && !!(api.url?.trim() || api.body?.trim());

/** All requests on a checklist item (handles the older single-request field). */
export function itemApis(item: Pick<ChecklistItem, "apis" | "api">): ApiRequest[] {
  return (item.apis ?? (item.api ? [item.api] : [])).filter(hasApi);
}

/** Requests in step order; ones not tied to a step go last. */
const sortApis = (apis: ApiRequest[]) => [...apis].sort((a, z) => (a.step ?? 999) - (z.step ?? 999));

/** "Step 2 · Change the interest rate" */
export function stepLabel(api: ApiRequest, steps: string[]): string {
  if (!api.step) return "Not tied to a step";
  const text = steps[api.step - 1];
  return text ? `Step ${api.step} · ${text}` : `Step ${api.step}`;
}

/** One row per test case, in checklist order. */
export function resultRows(items: ChecklistItem[]): ResultRow[] {
  return items.map((item, idx): ResultRow => {
    const ref = item.ref?.trim() ?? "";
    if (isScenarioText(item.description)) {
      const s = parseScenarioText(item.description);
      return {
        id: s.id,
        title: clean(s.title),
        given: clean(s.given),
        steps: s.steps.map(clean).filter(Boolean),
        data: s.data.map(([k, v]): [string, string] => [clean(k), clean(v)]).filter(([k]) => k),
        expected: s.expected.map(clean).filter(Boolean),
        type: s.outcome ? OUTCOME_LABEL[s.outcome] : "",
        ref,
        apis: sortApis(itemApis(item)),
        status: item.status,
      };
    }
    const [first, ...rest] = item.description.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      id: `#${idx + 1}`,
      title: clean((first ?? "").replace(/^\*\*(.+)\*\*$/, "$1")),
      given: "", steps: rest.map(clean), data: [], expected: [], type: "", ref, apis: sortApis(itemApis(item)), status: item.status,
    };
  });
}

const byResult = (rows: ResultRow[]) => [...rows].sort((a, z) => RESULT_ORDER.indexOf(a.status) - RESULT_ORDER.indexOf(z.status));

/** "3 test cases · 1 passed · 1 failed · 1 needs clarification" */
export function resultSummary(rows: ResultRow[]): string {
  const parts = RESULT_ORDER
    .map((s) => [s, rows.filter((r) => r.status === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${RESULT[s].label.toLowerCase()}`);
  return [`${rows.length} test case${rows.length === 1 ? "" : "s"}`, ...parts].join(" · ");
}

export function buildResultsAdf(opts: { title: string; items: ChecklistItem[]; refLabel?: string; environment?: string; attachment?: { name: string; url?: string } | null }): AdfDoc {
  const rows = resultRows(opts.items);
  // Only show the "tested with" column when somebody actually filled it in
  const withRef = !!opts.refLabel && rows.some((r) => r.ref);
  const problems = byResult(rows).filter((r) => PROBLEM.includes(r.status));

  const content: AdfBlock[] = [
    { type: "heading", attrs: { level: 3 }, content: [t(opts.title)] },
    p(b("Environment: "), opts.environment?.trim() ? t(opts.environment.trim(), { type: "code" }) : t("not specified", { type: "em" })),
    p(b(resultSummary(rows))),
    {
      type: "table",
      attrs: { isNumberColumnEnabled: false, layout: "default" },
      content: [
        { type: "tableRow", content: [
          cell("tableHeader", b("ID")), cell("tableHeader", b("Test case")), cell("tableHeader", b("Expected result")),
          ...(withRef ? [cell("tableHeader", b(opts.refLabel!))] : []),
          cell("tableHeader", b("Type")), cell("tableHeader", b("Result")),
        ] },
        ...byResult(rows).map((r) => ({
          type: "tableRow" as const,
          content: [
            cell("tableCell", b(r.id)),
            cell("tableCell", t(r.title)),
            r.expected.length > 1
              ? { type: "tableCell" as const, attrs: {}, content: [list("bulletList", r.expected)] }
              : cell("tableCell", t(r.expected[0] || "—")),
            ...(withRef ? [cell("tableCell", r.ref ? t(r.ref, { type: "code" }) : t("—"))] : []),
            cell("tableCell", t(r.type || "—")),
            cell("tableCell", status(r.status)),
          ],
        })),
      ],
    },
  ];

  // Full detail for anything that didn't pass, so the developer can reproduce it from Jira
  if (problems.length) {
    content.push({ type: "heading", attrs: { level: 4 }, content: [t("🔎 Needs attention — how to reproduce")] });
    problems.forEach((r, i) => {
      if (i > 0) content.push({ type: "rule" });
      content.push(p(status(r.status), t("  "), b(`${r.id} · ${r.title}`)));
      if (r.given) content.push(p(b("Starting point: "), t(r.given)));
      if (r.steps.length) {
        // Each request sits directly under the step it was sent in
        content.push(p(b("Steps:")));
        content.push({
          type: "orderedList",
          content: r.steps.map((s, si) => ({
            type: "listItem" as const,
            content: [p(t(s)), ...r.apis.filter((a) => a.step === si + 1).flatMap((a) => requestBlocks(a, "Request: ") as (Paragraph | CodeBlock)[])],
          })),
        });
      }
      if (r.data.length) content.push(p(b("Test data: "), t(r.data.map(([k, v]) => (v ? `${k}: ${v}` : k)).join(" · "))));
      if (r.ref && opts.refLabel) content.push(p(b(`${opts.refLabel}: `), t(r.ref, { type: "code" })));
      const loose = r.apis.filter((a) => !a.step || a.step > r.steps.length);
      loose.forEach((a) => content.push(...requestBlocks(a, "Request: ")));
      if (r.expected.length) { content.push(p(b("Expected:"))); content.push(list("bulletList", r.expected)); }
    });
  }

  // Requests used by the tests that went fine, so they can be re-run
  const otherApi = byResult(rows).filter((r) => r.apis.length && !PROBLEM.includes(r.status));
  if (otherApi.length) {
    content.push({ type: "heading", attrs: { level: 4 }, content: [t("📡 Requests used in other tests")] });
    otherApi.forEach((r) => {
      content.push(p(status(r.status), t("  "), b(`${r.id} · ${r.title}`)));
      r.apis.forEach((a) => {
        content.push(p(t(stepLabel(a, r.steps), { type: "em" })));
        content.push(...requestBlocks(a));
      });
    });
  }

  if (opts.attachment) {
    const { name, url } = opts.attachment;
    content.push(p(
      b("📎 Full results: "),
      url ? t(name, { type: "link", attrs: { href: url } }) : t(name, { type: "code" }),
    ));
  }

  return { type: "doc", version: 1, content };
}

/** Plain-text version (for copy to clipboard). */
export function buildResultsText(opts: { title: string; items: ChecklistItem[]; refLabel?: string; environment?: string }): string {
  const rows = resultRows(opts.items);
  const out = [opts.title, `Environment: ${opts.environment?.trim() || "not specified"}`, resultSummary(rows), ""];
  for (const r of byResult(rows)) {
    out.push(`[${RESULT[r.status].text}] ${r.id} · ${r.title}${r.type ? ` (${r.type})` : ""}${r.ref && opts.refLabel ? ` — ${opts.refLabel}: ${r.ref}` : ""}`);
    if (PROBLEM.includes(r.status)) {
      if (r.given) out.push(`   Starting point: ${r.given}`);
      r.steps.forEach((s, i) => {
        out.push(`   ${i + 1}. ${s}`);
        r.apis.filter((a) => a.step === i + 1).forEach((a) => out.push(...requestText(a).split("\n").map((l) => `      ${l}`)));
      });
      if (r.expected.length) out.push(`   Expected: ${r.expected.join("; ")}`);
    }
    const shown = PROBLEM.includes(r.status) ? r.apis.filter((a) => !a.step || a.step > r.steps.length) : r.apis;
    shown.forEach((a) => { out.push(`   ${stepLabel(a, r.steps)}:`); out.push(...requestText(a).split("\n").map((l) => `      ${l}`)); });
  }
  return out.join("\n");
}