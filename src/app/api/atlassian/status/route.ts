import { NextRequest, NextResponse } from "next/server";
import { disconnect, jiraFor } from "@/lib/atlassian-mcp";
import { getSessionUserId } from "@/lib/github-session";

/** Is this user's Jira connected? Returns the site when it is. */
export async function GET(req: NextRequest) {
  const r = await jiraFor(req);
  if (!r.ok) {
    const body = await r.res.json().catch(() => ({}));
    return NextResponse.json({ connected: false, ...body });
  }
  return NextResponse.json({ connected: true, site: r.jira.site.url, name: r.jira.site.name });
}

/** Forget this user's Jira sign-in. */
export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId(req);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  await disconnect(userId);
  return NextResponse.json({ connected: false });
}
