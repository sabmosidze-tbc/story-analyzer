import { NextRequest, NextResponse } from "next/server";
import { jiraEnv, jiraError, ISSUE_KEY } from "@/lib/jira-server";

type Raw = {
  key: string;
  names?: Record<string, string>;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string };
    project?: { key: string };
    priority?: { id?: string };
    components?: { id: string }[];
    labels?: string[];
    attachment?: { id: string; filename: string; mimeType?: string }[];
  };
};

/** Read an existing bug so it can be edited here: GET ?key=LSINST-123 */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim().toUpperCase();
  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "That doesn't look like a ticket number (e.g. LSINST-123)" }, { status: 400 });
  try {
    const res = await fetch(`${env.base}/rest/api/3/issue/${key}?expand=names`, { headers: env.headers });
    if (res.status === 404) return NextResponse.json({ error: `${key} not found` }, { status: 404 });
    if (!res.ok) return NextResponse.json({ error: await jiraError(res, "Failed to read the ticket") }, { status: res.status });
    const j = (await res.json()) as Raw;
    const type = j.fields.issuetype?.name ?? "";
    // A bug that was later converted to a Task can still be edited; only epics are refused
    if (/epic/i.test(type)) return NextResponse.json({ error: `${key} is ${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}, not a ticket that can be edited here` }, { status: 422 });

    const envId = Object.entries(j.names ?? {}).find(([, n]) => /^environment$/i.test(n))?.[0];
    const envVal = envId ? (j.fields[envId] as { id?: string } | null | undefined) : undefined;
    return NextResponse.json({
      key: j.key,
      url: `${env.base}/browse/${j.key}`,
      project: j.fields.project?.key ?? key.split("-")[0],
      summary: j.fields.summary ?? "",
      description: j.fields.description ?? null,
      priorityId: j.fields.priority?.id,
      componentIds: (j.fields.components ?? []).map((c) => c.id),
      labels: j.fields.labels ?? [],
      envOptionId: envVal && typeof envVal === "object" ? envVal.id : undefined,
      attachments: (j.fields.attachment ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType ?? "",
        url: `${env.base}/secure/attachment/${a.id}/${encodeURIComponent(a.filename)}`,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
