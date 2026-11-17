import type { ApiRequest, IssueReport } from "@/types";
import { MAIN_FINDING, emptyDraft, expGroup, newFinding, withFindings, type Finding } from "@/lib/bug-report";

type N = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string }[]; content?: N[] };
type Att = { id: string; filename: string; mimeType: string; url: string };
type File = NonNullable<IssueReport["snapshot"]>["files"][number];

const text = (n: N | undefined): string => {
  if (!n) return "";
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  return (n.content ?? []).map(text).join("");
};
const lineList = (n: N) => text(n).split("\n").map((l) => l.trim()).filter((l) => l && l !== "—");

const SECTION = /^(environment|preconditions|steps to reproduce|requests|expected result|actual result|test data|notes)$/i;

function apiFrom(para: N): ApiRequest | null {
  if (!(para.content ?? []).some((c) => c.marks?.some((m) => m.type === "code"))) return null;
  const m = text(para).trim().match(/^([A-Za-z]+)\s+(.*)$/);
  return m ? { method: m[1].toUpperCase(), url: m[2] === "—" ? "" : m[2] } : null;
}

/** Read the sections this app writes into a bug description back into the editable form. */
export function parseBugAdf(doc: N | null, atts: Att[], mediaToAtt: Record<string, string>) {
  const findings: Finding[] = [{ ...newFinding(), id: MAIN_FINDING, steps: [] }];
  let cur = findings[0];
  let numbered = false;
  let recognized = false;
  let section = "";
  let environment = "";
  let preconditions = "";
  let storyKey: string | undefined;
  let testCaseId: string | undefined;
  const used = new Set<string>();
  const files: File[] = [];

  const attach = (a: Att | undefined, group: string) => {
    if (!a || used.has(a.id)) return;
    used.add(a.id);
    files.push({ id: a.id, name: a.filename, url: a.url, group, image: a.mimeType.startsWith("image/") });
  };
  const byName = (name: string) => atts.find((a) => a.filename === name && !used.has(a.id));

  // Panels only add colour: read what is inside them as if it sat at the top level
  for (const node of (doc?.content ?? []).flatMap((n) => (n.type === "panel" ? n.content ?? [] : [n]))) {
    if (node.type === "heading") {
      const title = text(node).trim().replace(/^[^\p{L}\p{N}]+/u, "");
      const num = title.match(/^\d+\)\s*(.*)$/);
      if (num) {
        recognized = true;
        const name = /^Problem \d+$/.test(num[1]) ? "" : num[1];
        if (numbered) { cur = { ...newFinding(), steps: [], title: name }; findings.push(cur); } else { numbered = true; cur.title = name; }
        section = "";
      } else if (SECTION.test(title)) {
        recognized = true;
        section = title.toLowerCase();
      } else section = "";
      continue;
    }
    const group = section === "expected result" ? expGroup(cur.id) : cur.id;
    switch (section) {
      case "": {
        const t = text(node);
        if (node.type === "paragraph" && t.startsWith("Found while testing")) {
          storyKey = t.match(/[A-Z][A-Z0-9_]+-\d+/)?.[0];
          testCaseId = t.match(/test case\s+(\S+)/)?.[1];
        }
        break;
      }
      case "environment": { const t = text(node).trim(); if (node.type === "paragraph" && t && t !== "not specified") environment = t; break; }
      case "preconditions": preconditions = [preconditions, ...lineList(node)].filter(Boolean).join("\n"); break;
      case "steps to reproduce":
        if (node.type === "orderedList") {
          (node.content ?? []).forEach((li, i) => {
            const kids = li.content ?? [];
            cur.steps.push(text(kids[0]).trim());
            for (const k of kids.slice(1)) {
              if (k.type === "paragraph") { const a = apiFrom(k); if (a) cur.apis.push({ ...a, step: i + 1 }); }
              else if (k.type === "codeBlock" && cur.apis.length) cur.apis[cur.apis.length - 1].body = text(k);
            }
          });
        }
        break;
      case "requests":
        if (node.type === "paragraph") { const a = apiFrom(node); if (a) cur.apis.push(a); }
        else if (node.type === "codeBlock" && cur.apis.length) cur.apis[cur.apis.length - 1].body = text(node);
        break;
      case "expected result":
      case "actual result": {
        const key = section === "expected result" ? "expected" : "actual";
        if (node.type === "paragraph") cur[key] = [cur[key], ...lineList(node)].filter(Boolean).join("\n");
        else if (node.type === "mediaSingle") {
          const id = (node.content ?? []).map((m) => m.attrs?.id).find((v) => typeof v === "string") as string | undefined;
          attach(atts.find((a) => a.id === (id ? mediaToAtt[id] : "")), group);
        } else if (node.type === "bulletList") {
          for (const li of node.content ?? []) attach(byName(text(li).replace(/^📎\s*/, "").trim()), group);
        }
        break;
      }
      case "test data":
        if (node.type === "bulletList") cur.testData = [cur.testData, ...(node.content ?? []).map((li) => text(li).trim())].filter(Boolean).join("\n");
        break;
      case "notes": cur.notes = [cur.notes, ...lineList(node)].filter(Boolean).join("\n"); break;
    }
  }

  if (!recognized) {
    // Written by hand in Jira: keep the text, so nothing is lost
    findings[0].notes = (doc?.content ?? []).map((n) => text(n).trim()).filter(Boolean).join("\n");
  }
  for (const f of findings) if (!f.steps.length) f.steps = [""];
  for (const a of atts) attach(a, MAIN_FINDING);
  return { findings, environment, preconditions, storyKey, testCaseId, files, foreign: !recognized };
}

/** Load a Jira bug by key and turn it into something the edit window can open. */
export async function loadBug(key: string): Promise<{ report: IssueReport; foreign: boolean }> {
  const res = await fetch(`/api/jira/issue/load?key=${encodeURIComponent(key.trim())}`);
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? "Couldn't load that ticket");
  const atts = j.attachments as Att[];

  const images = atts.filter((a) => a.mimeType.startsWith("image/"));
  const mediaToAtt: Record<string, string> = {};
  const mediaOf: Record<string, string> = {};
  if (images.length) {
    try {
      const m = (await (await fetch(`/api/jira/attachment?ids=${images.map((a) => a.id).join(",")}`)).json()) as { media?: Record<string, string> };
      for (const [attId, mid] of Object.entries(m.media ?? {})) { mediaToAtt[mid] = attId; mediaOf[attId] = mid; }
    } catch { /* images fall back to links */ }
  }

  const p = parseBugAdf(j.description, atts, mediaToAtt);
  const draft = withFindings({ ...emptyDraft(p.environment), title: j.summary, preconditions: p.preconditions, testCaseId: p.testCaseId }, p.findings);
  const report: IssueReport = {
    id: `bug-${j.key}`,
    kind: "bug",
    title: j.summary,
    testCaseId: p.testCaseId,
    key: j.key,
    url: j.url,
    environment: p.environment || undefined,
    createdAt: new Date().toISOString(),
    snapshot: {
      draft,
      projectKey: j.project,
      priorityId: j.priorityId,
      componentIds: j.componentIds,
      labels: (j.labels as string[]).join(", "),
      envOptionId: j.envOptionId,
      storyKey: p.storyKey,
      files: p.files.map((f) => ({ ...f, mediaId: f.id ? mediaOf[f.id] : undefined })),
    },
  };
  return { report, foreign: p.foreign };
}
