import { NextRequest, NextResponse } from "next/server";
import { jiraFail, jiraFor } from "@/lib/jira-server";

/** Projects the Jira user can create issues in, filtered by name or key. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  try {
    const data = await r.jira.call<{ values?: { key: string; name: string }[] }>("listJiraProjects", {
      action: "create", maxResults: 20, ...(q ? { query: q } : {}),
    });
    const projects = (data.values ?? []).map((p) => ({ key: p.key, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ projects });
  } catch (e) {
    return jiraFail(e, "Failed to load projects");
  }
}
