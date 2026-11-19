import { NextRequest, NextResponse } from "next/server";
import { jiraFail, jiraFor, PROJECT_KEY } from "@/lib/jira-server";

/** Labels already used in a project, most recently touched first: GET ?project=LSINST */
export async function GET(req: NextRequest) {
  const project = (req.nextUrl.searchParams.get("project") ?? "").trim().toUpperCase();
  if (!PROJECT_KEY.test(project)) return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  try {
    const j = await r.jira.call<{ issues?: { fields?: { labels?: string[] } }[] }>("searchJiraIssuesUsingJql", {
      jql: `project = "${project}" AND labels is not EMPTY ORDER BY updated DESC`, fields: ["labels"], maxResults: 100,
    });
    const seen = new Set<string>();
    for (const i of j.issues ?? []) for (const l of i.fields?.labels ?? []) seen.add(l);
    return NextResponse.json({ labels: [...seen].sort((a, b) => a.localeCompare(b)) });
  } catch (e) {
    return jiraFail(e, "Failed to load labels");
  }
}
