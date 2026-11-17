import { NextRequest, NextResponse } from "next/server";
import { jiraEnv, jiraError, PROJECT_KEY } from "@/lib/jira-server";

/** Labels already used in a project, most recently touched first: GET ?project=LSINST */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const project = (req.nextUrl.searchParams.get("project") ?? "").trim().toUpperCase();
  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  try {
    const res = await fetch(`${env.base}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { ...env.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ jql: `project = "${project}" AND labels is not EMPTY ORDER BY updated DESC`, fields: ["labels"], maxResults: 100 }),
    });
    if (!res.ok) return NextResponse.json({ error: await jiraError(res, "Failed to load labels") }, { status: res.status });
    const j = (await res.json()) as { issues?: { fields?: { labels?: string[] } }[] };
    const seen = new Set<string>();
    for (const i of j.issues ?? []) for (const l of i.fields?.labels ?? []) seen.add(l);
    return NextResponse.json({ labels: [...seen].sort((a, b) => a.localeCompare(b)) });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
