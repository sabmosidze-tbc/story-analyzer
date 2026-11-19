import { NextRequest, NextResponse } from "next/server";
import { adfToHtml, type AdfNode } from "@/lib/adf-html";
import { JiraError } from "@/lib/atlassian-mcp";
import { ISSUE_KEY, PROJECT_KEY, getIssue, jiraFail, jiraFor } from "@/lib/jira-server";

const str = (v: unknown, max = 255) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)).slice(0, 20) : []);
const cleanLabels = (v: unknown) => Array.isArray(v)
  ? v.filter((l): l is string => typeof l === "string").map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean).slice(0, 10)
  : [];
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Create a Bug, then (optionally) link it to the story and move it to "To Do".
 * Linking/moving problems don't undo the bug — they come back as warnings.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const project = str(body.project, 10).toUpperCase();
  const issueTypeId = str(body.issueTypeId, 20);
  const summary = str(body.summary).replace(/\s+/g, " ");
  const description = body.description as AdfNode | undefined;
  const linkTo = str(body.linkTo, 30).toUpperCase();
  const priorityId = str(body.priorityId, 20);
  const labels = cleanLabels(body.labels);
  const envField = body.envField as { id?: unknown; optionId?: unknown } | undefined;

  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  if (!/^\d+$/.test(issueTypeId)) return NextResponse.json({ error: "Invalid issue type" }, { status: 400 });
  if (!summary) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (linkTo && !ISSUE_KEY.test(linkTo)) return NextResponse.json({ error: "Invalid story key" }, { status: 400 });

  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  try {
    // The tool takes the type by name
    const types = (await jira.call<{ issueTypes?: { id: string; name: string }[] }>("listJiraProjectIssueTypesMetadata", { projectIdOrKey: project, maxResults: 100 })).issueTypes ?? [];
    const issueType = types.find((t) => t.id === issueTypeId)?.name;
    if (!issueType) return NextResponse.json({ error: `Issue type ${issueTypeId} isn't available in ${project}` }, { status: 400 });

    const extra: Record<string, unknown> = {};
    if (/^\d+$/.test(priorityId)) extra.priority = { id: priorityId };
    const comps = ids(body.componentIds);
    if (comps.length) extra.components = comps.map((id) => ({ id }));
    if (envField && typeof envField.id === "string" && /^customfield_\d+$/.test(envField.id) && typeof envField.optionId === "string" && /^\d+$/.test(envField.optionId)) {
      extra[envField.id] = { id: envField.optionId };
    }

    const created = await jira.call<Record<string, unknown>>("createJiraIssue", {
      projectKey: project,
      summary,
      issueType,
      ...(description?.type === "doc" ? { description: adfToHtml(description), contentFormat: "html" } : {}),
      ...(labels.length ? { labels } : {}),
      ...(Object.keys(extra).length ? { additional_fields: extra } : {}),
    });
    const key = String(created.key ?? (created.issue as { key?: string } | undefined)?.key ?? JSON.stringify(created).match(/"key"\s*:\s*"([A-Z][A-Z0-9_]+-\d+)"/)?.[1] ?? "");
    if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "Jira didn't return the new bug's key" }, { status: 502 });
    const warnings: string[] = [];

    let linked = false;
    if (linkTo) {
      try {
        await jira.call("createJiraIssueLink", { linkType: "Relates", inwardIssue: key, outwardIssue: linkTo });
        linked = true;
      } catch (e) { warnings.push(`Couldn't link to ${linkTo}: ${msg(e, "link failed")}`); }
    }

    let status = "";
    if (body.startIn === "todo") {
      try {
        const list = (await jira.call<{ transitions?: { id: string; name: string; to?: { name?: string } }[] }>("listJiraIssueTransitions", { issueIdOrKey: key })).transitions ?? [];
        const move = list.find((t) => /^to\s*-?\s*do$/i.test(t.to?.name ?? "")) ?? list.find((t) => /^to\s*-?\s*do$/i.test(t.name));
        if (!move) {
          warnings.push("Jira doesn't allow moving this bug to To Do directly, so it stayed in its first column.");
        } else {
          await jira.call("transitionJiraIssue", { issueIdOrKey: key, transitionId: move.id });
          status = move.to?.name ?? "To Do";
        }
      } catch (e) { warnings.push(`Couldn't move to To Do: ${msg(e, "transition failed")}`); }
    }
    if (!status) {
      try { status = (await getIssue(jira, key, ["status"])).fields.status?.name ?? ""; } catch { /* optional */ }
    }

    return NextResponse.json({ key, url: jira.browse(key), linked, status, warnings });
  } catch (e) {
    return jiraFail(e, "Failed to create the bug");
  }
}

/** Edit a bug the app created: summary, description, priority, components, labels, environment. */
export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const key = str(body.key, 30).toUpperCase();
  const summary = str(body.summary).replace(/\s+/g, " ");
  const description = body.description as AdfNode | undefined;
  const priorityId = str(body.priorityId, 20);
  const envField = body.envField as { id?: unknown; optionId?: unknown } | undefined;
  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "Invalid issue key" }, { status: 400 });
  if (!summary) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  const fields: Record<string, unknown> = {
    summary,
    components: ids(body.componentIds).map((id) => ({ id })),
    labels: cleanLabels(body.labels),
  };
  if (description?.type === "doc") fields.description = adfToHtml(description);
  if (/^\d+$/.test(priorityId)) fields.priority = { id: priorityId };
  const envId = envField && typeof envField.id === "string" && /^customfield_\d+$/.test(envField.id) ? envField.id : "";
  if (envId) fields[envId] = typeof envField!.optionId === "string" && /^\d+$/.test(envField!.optionId) ? { id: envField!.optionId } : null;

  const put = (f: Record<string, unknown>) => jira.call("editJiraIssue", { issueIdOrKey: key, fields: f, contentFormat: "html" });
  try {
    try {
      await put(fields);
    } catch (e) {
      // The Environment field may not be on the edit screen; save everything else instead of failing
      if (!(envId && e instanceof JiraError && e.status === 400 && /customfield_\d+|environment/i.test(e.message))) throw e;
      const rest = { ...fields };
      delete rest[envId];
      await put(rest);
    }
    return NextResponse.json({ key, url: jira.browse(key) });
  } catch (e) {
    return jiraFail(e, "Failed to update the bug");
  }
}

/** Live status of a few issues: GET ?keys=A-1,B-2 */
export async function GET(req: NextRequest) {
  const keys = (req.nextUrl.searchParams.get("keys") ?? "").toUpperCase().split(",").map((k) => k.trim()).filter((k) => ISSUE_KEY.test(k)).slice(0, 50);
  if (!keys.length) return NextResponse.json({ issues: [] });
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  try {
    const data = await r.jira.call<{ issues?: { key: string; fields: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } } } }[] }>("searchJiraIssuesUsingJql", {
      jql: `key in (${keys.join(",")})`, fields: ["status", "summary"], maxResults: 50, view: "full",
    });
    return NextResponse.json({
      issues: (data.issues ?? []).map((i) => ({
        key: i.key,
        summary: i.fields.summary ?? "",
        status: i.fields.status?.name ?? "",
        category: i.fields.status?.statusCategory?.key ?? "",
      })),
    });
  } catch (e) {
    return jiraFail(e, "Failed to load statuses");
  }
}
