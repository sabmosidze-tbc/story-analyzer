import { NextRequest, NextResponse } from "next/server";
import { getIssue, jiraFail, jiraFor } from "@/lib/jira-server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  try {
    const { fields } = await getIssue(r.jira, key, ["summary", "issuetype"]);
    return NextResponse.json({
      summary: fields.summary ?? "",
      issueType: fields.issuetype?.name ?? "",
      browseUrl: r.jira.browse(key),
    });
  } catch (e) {
    return jiraFail(e, "Issue not found");
  }
}
