import type { ApiRequest, ChecklistItem, IssueReport, ObservationState } from "@/types";
import { isScenarioText, parseScenarioText } from "@/lib/test-design";
import { clean, formatPayload, itemApis, type AdfBlock, type AdfDoc } from "@/lib/jira-results";

/** One problem inside a card: its own steps, results and evidence. */
export interface Finding {
  id: string;
  title: string;
  steps: string[];
  apis: ApiRequest[];
  expected: string;
  actual: string;
  testData: string;
  notes: string;
}

/** Everything the tester fills in the "Report bug" / "Add observation" window. */
export interface ReportDraft {
  title: string;
  environment: string;
  preconditions: string;
  steps: string[];
  apis: ApiRequest[];
  expected: string;
  actual: string;
  testData: string;     // one "Name: value" per line
  notes: string;
  testCaseId?: string;  // "TC3"
  /** The first problem's own heading (only shown when the card has several problems) */
  findingTitle?: string;
  /** Further problems after the first one, whose fields are the ones above */
  more?: Finding[];
}

export const MAIN_FINDING = "main";
/** Evidence groups: "<findingId>" = actual result, "<findingId>:exp" = expected result */
export const expGroup = (id: string) => `${id}:exp`;
export const baseGroup = (g?: string) => (g ?? MAIN_FINDING).split(":")[0];
const isExp = (g?: string) => (g ?? "").endsWith(":exp");

export function newFinding(): Finding {
  return { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: "", steps: [""], apis: [], expected: "", actual: "", testData: "", notes: "" };
}

/** All problems in order; the first one lives in the draft's top-level fields. */
export function findingsOf(d: ReportDraft): Finding[] {
  return [
    { id: MAIN_FINDING, title: d.findingTitle ?? "", steps: d.steps, apis: d.apis, expected: d.expected, actual: d.actual, testData: d.testData, notes: d.notes },
    ...(d.more ?? []),
  ];
}

export function withFindings(d: ReportDraft, list: Finding[]): ReportDraft {
  const [m, ...rest] = list;
  return { ...d, findingTitle: m.title, steps: m.steps, apis: m.apis, expected: m.expected, actual: m.actual, testData: m.testData, notes: m.notes, more: rest };
}

export function emptyDraft(environment = ""): ReportDraft {
  return { title: "", environment, preconditions: "", steps: [""], apis: [], expected: "", actual: "", testData: "", notes: "" };
}

/** Pre-fill from a test case so the tester only adds what actually happened. */
export function draftFromItem(item: ChecklistItem, opts: { environment?: string; refLabel?: string }): ReportDraft {
  const ref = item.ref?.trim() ? `${opts.refLabel || "Record ID"}: ${item.ref.trim()}` : "";
  const apis = itemApis(item);
  if (isScenarioText(item.description)) {
    const s = parseScenarioText(item.description);
    return {
      title: clean(s.title),
      environment: opts.environment ?? "",
      preconditions: clean(s.given),
      steps: s.steps.map(clean).filter(Boolean),
      apis,
      expected: s.expected.map(clean).filter(Boolean).join("\n"),
      actual: "",
      testData: [ref, ...s.data.map(([k, v]) => `${clean(k)}: ${clean(v)}`)].filter(Boolean).join("\n"),
      notes: "",
      testCaseId: s.id || undefined,
    };
  }
  const [first, ...rest] = item.description.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    ...emptyDraft(opts.environment),
    title: clean((first ?? "").replace(/^[-*]\s*/, "")),
    steps: rest.length ? rest.map((l) => clean(l.replace(/^[-*\d.)\s]+/, ""))) : [""],
    apis,
    testData: ref,
  };
}

// ── ADF ──────────────────────────────────────────────────────────────────────
type Mark = { type: "strong" } | { type: "em" } | { type: "code" } | { type: "link"; attrs: { href: string } };
type Text = { type: "text"; text: string; marks?: Mark[] };
type StatusNode = { type: "status"; attrs: { text: string; color: "neutral" | "purple" | "blue" | "red" | "yellow" | "green" } };
type Inline = Text | StatusNode;

const t = (text: string, ...marks: Mark[]): Text => (marks.length ? { type: "text", text, marks } : { type: "text", text });
const b = (text: string) => t(text, { type: "strong" });
const p = (...content: Inline[]) => ({ type: "paragraph" as const, content });
const ICON: Record<string, string> = { "Expected result": "✅", "Actual result": "❌" };
const h = (level: number, text: string) => ({ type: "heading" as const, attrs: { level }, content: [t(ICON[text] ? `${ICON[text]} ${text}` : text)] });
const panel = (panelType: "success" | "error" | "info" | "note", content: unknown[]) => ({ type: "panel", attrs: { panelType }, content }) as unknown as AdfBlock;
const rule = () => ({ type: "rule" }) as unknown as AdfBlock;
const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const paras = (s: string, empty = "—") => (lines(s).length ? lines(s).map((l) => p(t(l))) : [p(t(empty, { type: "em" }))]);

function requestBlocks(api: ApiRequest) {
  const body = formatPayload(api.body ?? "");
  const head = p(t(`${api.method.toUpperCase()} ${api.url.trim() || "—"}`, { type: "code" }));
  return body.text
    ? [head, { type: "codeBlock" as const, attrs: { language: body.json ? "json" : "text" }, content: [{ type: "text" as const, text: body.text }] }]
    : [head];
}

type Att = { name: string; url?: string; group?: string; mediaId?: string; image?: boolean };

function findingBlocks(f: Finding, level: number, attachments: Att[]): AdfBlock[] {
  const out: AdfBlock[] = [];
  const steps = f.steps.map((x) => x.trim()).filter(Boolean);
  const loose = f.apis.filter((a) => !a.step || a.step > steps.length);

  if (steps.length) {
    out.push(h(level, "Steps to reproduce"), {
      type: "orderedList",
      content: steps.map((x, i) => ({
        type: "listItem" as const,
        content: [p(t(x)), ...f.apis.filter((a) => a.step === i + 1).flatMap(requestBlocks)],
      })),
    } as AdfBlock);
  }
  if (loose.length) out.push(h(level, "Requests"), ...(loose.flatMap(requestBlocks) as AdfBlock[]));
  // Images Jira already stores are shown inline; everything else is a link
  const evidence = (list: Att[]): AdfBlock[] => {
    const inline = list.filter((x) => x.mediaId && x.image);
    const rest = list.filter((x) => !(x.mediaId && x.image));
    return [
      ...inline.map((x) => ({ type: "mediaSingle", attrs: { layout: "center" }, content: [{ type: "media", attrs: { type: "file", id: x.mediaId, collection: "" } }] }) as unknown as AdfBlock),
      ...(rest.length ? [{
        type: "bulletList",
        content: rest.map((x) => ({
          type: "listItem" as const,
          content: [p(x.url ? t(`📎 ${x.name}`, { type: "link", attrs: { href: x.url } }) : t(`📎 ${x.name}`))],
        })),
      } as AdfBlock] : []),
    ];
  };
  out.push(h(level, "Expected result"), panel("success", paras(f.expected)), ...evidence(attachments.filter((x) => isExp(x.group))));
  out.push(h(level, "Actual result"), panel("error", paras(f.actual)), ...evidence(attachments.filter((x) => !isExp(x.group))));
  const data = lines(f.testData);
  if (data.length) {
    out.push(h(level, "Test data"), {
      type: "bulletList",
      content: data.map((l) => {
        const m = l.match(/^([^:]{1,40}):\s*(.+)$/);
        return { type: "listItem" as const, content: [m ? p(b(`${m[1]}: `), t(m[2])) : p(t(l))] };
      }),
    } as AdfBlock);
  }
  if (f.notes.trim()) out.push(h(level, "Notes"), panel("info", paras(f.notes)));
  return out;
}

function bodyBlocks(d: ReportDraft, level: number, attachments: Att[]): AdfBlock[] {
  const out: AdfBlock[] = [];
  out.push(h(level, "Environment"), p(d.environment.trim() ? b(d.environment.trim()) : t("not specified", { type: "em" })));
  if (d.preconditions.trim()) out.push(h(level, "Preconditions"), ...paras(d.preconditions));
  const list = findingsOf(d);
  if (list.length === 1) {
    out.push(...findingBlocks(list[0], level, attachments));
  } else {
    list.forEach((f, i) => {
      if (i > 0) out.push(rule());
      out.push(h(level, `${i + 1}) ${f.title.trim() || `Problem ${i + 1}`}`));
      out.push(...findingBlocks(f, level + 1, attachments.filter((x) => baseGroup(x.group) === f.id)));
    });
  }
  return out;
}

/** Description of a new Bug card. */
export function buildBugAdf(d: ReportDraft, opts: { storyKey?: string; storyUrl?: string; attachments: Att[] }): AdfDoc {
  const found: Inline[] = [];
  if (opts.storyKey) {
    found.push(t("Found while testing "), opts.storyUrl ? t(opts.storyKey, { type: "link", attrs: { href: opts.storyUrl } }, ) : b(opts.storyKey));
    if (d.testCaseId) found.push(t(" · test case "), b(d.testCaseId));
  }
  return {
    type: "doc",
    version: 1,
    content: [...(found.length ? [p(...found)] : []), ...bodyBlocks(d, 3, opts.attachments)] as AdfBlock[],
  };
}

export const OBS_STATE: Record<ObservationState, { label: string; jira: string; color: StatusNode["attrs"]["color"] }> = {
  "open":          { label: "Open",            jira: "OPEN",           color: "yellow" },
  "fixed":         { label: "Fixed — retest",  jira: "READY TO RETEST", color: "blue" },
  "retest-passed": { label: "Retested ✓",      jira: "RETEST PASSED",  color: "green" },
  "retest-failed": { label: "Still failing",   jira: "STILL FAILING",  color: "red" },
};

const status = (s: ObservationState): StatusNode => ({ type: "status", attrs: { text: OBS_STATE[s].jira, color: OBS_STATE[s].color } });

/** Comment on the story: "🔎 Observation #2 — title". */
export function buildObservationAdf(d: ReportDraft, opts: { number: number; attachments: Att[] }): AdfDoc {
  const head: Inline[] = [status("open")];
  if (d.testCaseId) head.push(t("  ·  test case "), b(d.testCaseId));
  return {
    type: "doc",
    version: 1,
    content: [
      { type: "heading", attrs: { level: 3 }, content: [t(`🔎 Observation #${opts.number} — ${d.title.trim() || "Untitled"}`)] },
      p(...head),
      ...bodyBlocks(d, 4, opts.attachments),
    ] as AdfBlock[],
  };
}

/** Short follow-up comment when an observation is fixed or retested. */
export function buildObservationUpdateAdf(r: IssueReport, state: ObservationState, opts: { environment?: string; note?: string }): AdfDoc {
  const verb = state === "fixed" ? "marked as fixed, ready to retest"
    : state === "retest-passed" ? "retested — works now ✅"
    : state === "retest-failed" ? "retested — still failing ❌"
    : "reopened";
  const content: AdfBlock[] = [
    p(b(`🔎 Observation #${r.number ?? "?"} — ${r.title}`)),
    p(status(state), t(`  ${verb}${opts.environment ? ` on ${opts.environment}` : ""}.`)),
  ];
  if (opts.note?.trim()) content.push(...(paras(opts.note) as AdfBlock[]));
  return { type: "doc", version: 1, content };
}

/** Plain-text version of the report, for copying. */
export function reportText(d: ReportDraft): string {
  const steps = d.steps.map((s) => s.trim()).filter(Boolean);
  const out = [d.title.trim(), "", `Environment: ${d.environment.trim() || "not specified"}`];
  if (d.preconditions.trim()) out.push("", "Preconditions:", d.preconditions.trim());
  if (steps.length) {
    out.push("", "Steps to reproduce:");
    steps.forEach((s, i) => {
      out.push(`${i + 1}. ${s}`);
      for (const a of d.apis.filter((x) => x.step === i + 1)) {
        out.push(`   ${a.method.toUpperCase()} ${a.url}`);
        const body = formatPayload(a.body ?? "").text;
        if (body) out.push(...body.split("\n").map((l) => `   ${l}`));
      }
    });
  }
  out.push("", "Expected result:", d.expected.trim() || "—", "", "Actual result:", d.actual.trim() || "—");
  if (d.testData.trim()) out.push("", "Test data:", d.testData.trim());
  if (d.notes.trim()) out.push("", "Notes:", d.notes.trim());
  return out.join("\n");
}
