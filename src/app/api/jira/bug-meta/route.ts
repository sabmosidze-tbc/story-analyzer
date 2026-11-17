import { NextRequest, NextResponse } from "next/server";
import { jiraEnv, jiraError, PROJECT_KEY } from "@/lib/jira-server";

export interface BugMeta {
  project: { key: string; name: string };
  issueTypeId: string;
  priorities: { id: string; name: string; iconUrl?: string }[];
  defaultPriorityId?: string;
  components: { id: string; name: string }[];
  /** Jira's own "Environment" dropdown, when the project has one. */
  envField?: { id: string; name: string; options: { id: string; value: string }[] };
  labels: boolean;
  /** Boards that show this project's issues. */
  boards: { id: number; name: string; type: string; url: string }[];
  /** Required fields the app can't fill — creation would fail. */
  unsupported: string[];
}

type Field = {
  fieldId: string;
  name: string;
  required: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; custom?: string };
  allowedValues?: { id: string; name?: string; value?: string; iconUrl?: string; disabled?: boolean }[];
  defaultValue?: { id?: string };
};

const HANDLED = new Set(["project", "issuetype", "summary", "description", "reporter", "priority", "components", "labels", "attachment", "issuelinks"]);

// Main board first: name mentions the project, and real boards beat the rest
const boardScore = (b: { name: string; type: string }, p: { key: string; name: string }) =>
  (b.name.toUpperCase().includes(p.key) ? 3 : 0) + (b.name.toLowerCase().includes(p.name.toLowerCase()) ? 2 : 0) + (/kanban|scrum/.test(b.type) ? 1 : 0);

const TTL = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & { __bugMeta?: Map<string, { at: number; meta: BugMeta }> };
const cache = (g.__bugMeta ??= new Map());

/** Everything the "Report bug" window needs to know about a project's Bug type. */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const project = req.nextUrl.searchParams.get("project")?.toUpperCase() ?? "";
  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project key" }, { status: 400 });

  const hit = cache.get(project);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.meta);

  const { base, headers } = env;
  try {
    const [typesRes, projRes, boardsRes] = await Promise.all([
      fetch(`${base}/rest/api/3/issue/createmeta/${project}/issuetypes?maxResults=100`, { headers }),
      fetch(`${base}/rest/api/3/project/${project}`, { headers }),
      fetch(`${base}/rest/agile/1.0/board?projectKeyOrId=${project}&maxResults=50`, { headers }).catch(() => null),
    ]);
    if (!typesRes.ok) return NextResponse.json({ error: await jiraError(typesRes, `Can't create issues in ${project}`) }, { status: typesRes.status });
    const types = ((await typesRes.json()) as { issueTypes?: { id: string; name: string; subtask?: boolean }[] }).issueTypes ?? [];
    const bug = types.find((t) => /^bug$/i.test(t.name)) ?? types.find((t) => /bug|defect/i.test(t.name) && !t.subtask);
    if (!bug) return NextResponse.json({ error: `Project ${project} has no Bug issue type` }, { status: 422 });
    const boards = boardsRes?.ok ? ((await boardsRes.json()) as { values?: { id: number; name: string; type: string }[] }).values ?? [] : [];
    const proj = projRes.ok ? ((await projRes.json()) as { key: string; name: string }) : { key: project, name: project };

    const fieldsRes = await fetch(`${base}/rest/api/3/issue/createmeta/${project}/issuetypes/${bug.id}?maxResults=200`, { headers });
    if (!fieldsRes.ok) return NextResponse.json({ error: await jiraError(fieldsRes, "Failed to read Bug fields") }, { status: fieldsRes.status });
    const fields = ((await fieldsRes.json()) as { fields?: Field[] }).fields ?? [];
    const byId = (id: string) => fields.find((f) => f.fieldId === id);

    const pr = byId("priority");
    const comp = byId("components");
    const envF = fields.find((f) => /^environment$/i.test(f.name) && f.schema?.type === "option" && f.allowedValues?.length);

    const meta: BugMeta = {
      project: { key: proj.key, name: proj.name },
      issueTypeId: bug.id,
      priorities: (pr?.allowedValues ?? []).map((v) => ({ id: v.id, name: v.name ?? v.value ?? v.id, iconUrl: v.iconUrl })),
      defaultPriorityId: pr?.defaultValue?.id,
      components: (comp?.allowedValues ?? []).map((v) => ({ id: v.id, name: v.name ?? v.value ?? v.id })),
      envField: envF ? {
        id: envF.fieldId,
        name: envF.name,
        options: envF.allowedValues!.filter((v) => !v.disabled).map((v) => ({ id: v.id, value: v.value ?? v.name ?? v.id })),
      } : undefined,
      labels: !!byId("labels"),
      boards: [...boards].sort((a, b) => boardScore(b, proj) - boardScore(a, proj)).map((x) => ({ id: x.id, name: x.name, type: x.type, url: `${base}/secure/RapidBoard.jspa?rapidView=${x.id}` })),
      unsupported: fields.filter((f) => f.required && !f.hasDefaultValue && !HANDLED.has(f.fieldId) && f.fieldId !== envF?.fieldId).map((f) => f.name),
    };
    cache.set(project, { at: Date.now(), meta });
    return NextResponse.json(meta);
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
