import { NextRequest, NextResponse } from "next/server";
import { getIssue, htmlToText, jiraFail, jiraFor } from "@/lib/jira-server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  try {
    const { fields } = await getIssue(jira, key, ["summary", "description", "issuetype", "status", "parent"]);
    const summary    = String(fields.summary ?? "");
    const issueType  = String(fields.issuetype?.name ?? "");
    if (/bug|defect/i.test(issueType)) {
      return NextResponse.json({ error: `${key} is a ${issueType} card. Only stories can be analyzed.` }, { status: 422 });
    }
    const status     = String(fields.status?.name ?? "");
    const descRaw    = htmlToText(fields.description);
    const meta       = [issueType, status].filter(Boolean).join(" · ");
    const epicKey    = fields.parent?.key && /epic/i.test(fields.parent.fields?.issuetype?.name ?? "") ? fields.parent.key : undefined;

    const storyText = [
      `${key}: ${summary}`,
      meta ? `[${meta}]` : "",
      "",
      descRaw,
    ]
      .filter((l, i) => i < 2 || l !== "")
      .join("\n")
      .trim();

    return NextResponse.json({ key, summary, storyText, issueType, epicKey, browseUrl: jira.browse(key) });
  } catch (e) {
    return jiraFail(e, "Failed to fetch Jira issue");
  }
}
