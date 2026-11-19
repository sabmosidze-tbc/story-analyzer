import { NextRequest, NextResponse } from "next/server";
import { boardUrl, jiraFail, jiraFor, projectBoards, PROJECT_KEY } from "@/lib/jira-server";

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
  const project = req.nextUrl.searchParams.get("project")?.toUpperCase() ?? "";
  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project key" }, { status: 400 });
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  const cacheKey = `${jira.site.cloudId}/${project}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.meta);

  try {
    const [typesData, boards] = await Promise.all([
      jira.call<{ issueTypes?: { id: string; name: string; subtask?: boolean }[] }>("listJiraProjectIssueTypesMetadata", { projectIdOrKey: project, maxResults: 100 }),
      projectBoards(jira, project).catch(() => []),
    ]);
    const types = typesData.issueTypes ?? [];
    const bug = types.find((t) => /^bug$/i.test(t.name)) ?? types.find((t) => /bug|defect/i.test(t.name) && !t.subtask);
    if (!bug) return NextResponse.json({ error: `Project ${project} has no Bug issue type` }, { status: 422 });

    const fields = (await jira.call<{ fields?: Field[] }>("getJiraIssueTypeMetaWithFields", {
      projectIdOrKey: project, issueTypeId: bug.id, requiredFieldsOnly: false, maxResults: 200,
    })).fields ?? [];
    const byId = (id: string) => fields.find((f) => f.fieldId === id);

    const pr = byId("priority");
    const comp = byId("components");
    const envF = fields.find((f) => /^environment$/i.test(f.name) && f.schema?.type === "option" && f.allowedValues?.length);
    const projName = byId("project")?.allowedValues?.[0]?.name ?? project;
    const proj = { key: project, name: projName };

    const meta: BugMeta = {
      project: proj,
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
      boards: [...boards].sort((a, b) => boardScore(b, proj) - boardScore(a, proj)).map((x) => ({ id: x.id, name: x.name, type: x.type, url: boardUrl(jira, x.id) })),
      unsupported: fields.filter((f) => f.required && !f.hasDefaultValue && !HANDLED.has(f.fieldId) && f.fieldId !== envF?.fieldId).map((f) => f.name),
    };
    cache.set(cacheKey, { at: Date.now(), meta });
    return NextResponse.json(meta);
  } catch (e) {
    return jiraFail(e, `Can't create issues in ${project}`);
  }
}
