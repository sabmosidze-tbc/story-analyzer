import { NextRequest, NextResponse } from "next/server";
import { ISSUE_KEY, PROJECT_KEY, jiraEnv, jiraError } from "@/lib/jira-server";

const str = (v: unknown, max = 255) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^\d+$/.test(x)).slice(0, 20) : []);

/**
 * Create a Bug, then (optionally) link it to the story and move it to "To Do".
 * Linking/moving problems don't undo the bug — they come back as warnings.
 */
export async function POST(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const { base, headers } = env;

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const project = str(body.project, 10).toUpperCase();
  const issueTypeId = str(body.issueTypeId, 20);
  const summary = str(body.summary).replace(/\s+/g, " ");
  const description = body.description as { type?: string } | undefined;
  const linkTo = str(body.linkTo, 30).toUpperCase();
  const priorityId = str(body.priorityId, 20);
  const labels = Array.isArray(body.labels)
    ? body.labels.filter((l): l is string => typeof l === "string").map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean).slice(0, 10)
    : [];
  const envField = body.envField as { id?: unknown; optionId?: unknown } | undefined;

  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  if (!/^\d+$/.test(issueTypeId)) return NextResponse.json({ error: "Invalid issue type" }, { status: 400 });
  if (!summary) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (linkTo && !ISSUE_KEY.test(linkTo)) return NextResponse.json({ error: "Invalid story key" }, { status: 400 });

  const fields: Record<string, unknown> = {
    project: { key: project },
    issuetype: { id: issueTypeId },
    summary,
  };
  if (description?.type === "doc") fields.description = description;
  if (/^\d+$/.test(priorityId)) fields.priority = { id: priorityId };
  const comps = ids(body.componentIds);
  if (comps.length) fields.components = comps.map((id) => ({ id }));
  if (labels.length) fields.labels = labels;
  if (envField && typeof envField.id === "string" && /^customfield_\d+$/.test(envField.id) && typeof envField.optionId === "string" && /^\d+$/.test(envField.optionId)) {
    fields[envField.id] = { id: envField.optionId };
  }

  const json = { ...headers, "Content-Type": "application/json" };
  try {
    const created = await fetch(`${base}/rest/api/3/issue`, { method: "POST", headers: json, body: JSON.stringify({ fields }) });
    if (!created.ok) return NextResponse.json({ error: await jiraError(created, "Failed to create the bug") }, { status: created.status });
    const { key } = (await created.json()) as { key: string };
    const warnings: string[] = [];

    let linked = false;
    if (linkTo) {
      const res = await fetch(`${base}/rest/api/3/issueLink`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ type: { name: "Relates" }, inwardIssue: { key }, outwardIssue: { key: linkTo } }),
      });
      linked = res.ok;
      if (!res.ok) warnings.push(`Couldn't link to ${linkTo}: ${await jiraError(res, "link failed")}`);
    }

    let status = "";
    if (body.startIn === "todo") {
      const tr = await fetch(`${base}/rest/api/3/issue/${key}/transitions`, { headers });
      const list = tr.ok ? ((await tr.json()) as { transitions?: { id: string; name: string; to?: { name?: string } }[] }).transitions ?? [] : [];
      const move = list.find((t) => /^to\s*-?\s*do$/i.test(t.to?.name ?? "")) ?? list.find((t) => /^to\s*-?\s*do$/i.test(t.name));
      if (!move) {
        warnings.push("Jira doesn't allow moving this bug to To Do directly, so it stayed in its first column.");
      } else {
        const res = await fetch(`${base}/rest/api/3/issue/${key}/transitions`, { method: "POST", headers: json, body: JSON.stringify({ transition: { id: move.id } }) });
        if (res.ok) status = move.to?.name ?? "To Do";
        else warnings.push(`Couldn't move to To Do: ${await jiraError(res, "transition failed")}`);
      }
    }
    if (!status) {
      const s = await fetch(`${base}/rest/api/3/issue/${key}?fields=status`, { headers });
      if (s.ok) status = ((await s.json()) as { fields?: { status?: { name?: string } } }).fields?.status?.name ?? "";
    }

    return NextResponse.json({ key, url: `${base}/browse/${key}`, linked, status, warnings });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}

/** Edit a bug the app created: summary, description, priority, components, labels, environment. */
export async function PUT(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const { base, headers } = env;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const key = str(body.key, 30).toUpperCase();
  const summary = str(body.summary).replace(/\s+/g, " ");
  const description = body.description as { type?: string } | undefined;
  const priorityId = str(body.priorityId, 20);
  const envField = body.envField as { id?: unknown; optionId?: unknown } | undefined;
  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "Invalid issue key" }, { status: 400 });
  if (!summary) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  const fields: Record<string, unknown> = { summary, components: ids(body.componentIds).map((id) => ({ id })) };
  fields.labels = Array.isArray(body.labels)
    ? body.labels.filter((l): l is string => typeof l === "string").map((l) => l.trim().replace(/\s+/g, "-")).filter(Boolean).slice(0, 10)
    : [];
  if (description?.type === "doc") fields.description = description;
  if (/^\d+$/.test(priorityId)) fields.priority = { id: priorityId };
  if (envField && typeof envField.id === "string" && /^customfield_\d+$/.test(envField.id)) {
    fields[envField.id] = typeof envField.optionId === "string" && /^\d+$/.test(envField.optionId) ? { id: envField.optionId } : null;
  }
  try {
    const put = (f: Record<string, unknown>) => fetch(`${base}/rest/api/3/issue/${key}`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ fields: f }) });
    let res = await put(fields);
    // The Environment field may not be on the edit screen; save everything else instead of failing
    if (res.status === 400 && envField && typeof envField.id === "string" && envField.id in fields) {
      const text = await res.clone().text();
      if (text.includes(envField.id)) {
        const rest = { ...fields };
        delete rest[envField.id];
        res = await put(rest);
      }
    }
    if (!res.ok) return NextResponse.json({ error: await jiraError(res, "Failed to update the bug") }, { status: res.status });
    return NextResponse.json({ key, url: `${base}/browse/${key}` });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}

/** Live status of a few issues: GET ?keys=A-1,B-2 */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const keys = (req.nextUrl.searchParams.get("keys") ?? "").toUpperCase().split(",").map((k) => k.trim()).filter((k) => ISSUE_KEY.test(k)).slice(0, 50);
  if (!keys.length) return NextResponse.json({ issues: [] });
  try {
    const res = await fetch(`${env.base}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { ...env.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jql: `key in (${keys.join(",")})`, fields: ["status", "summary"], maxResults: 50 }),
    });
    if (!res.ok) return NextResponse.json({ error: await jiraError(res, "Failed to load statuses") }, { status: res.status });
    const data = (await res.json()) as { issues?: { key: string; fields: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } } } }[] };
    return NextResponse.json({
      issues: (data.issues ?? []).map((i) => ({
        key: i.key,
        summary: i.fields.summary ?? "",
        status: i.fields.status?.name ?? "",
        category: i.fields.status?.statusCategory?.key ?? "",
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
