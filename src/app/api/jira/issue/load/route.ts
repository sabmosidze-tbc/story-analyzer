import { NextRequest, NextResponse } from "next/server";
import { htmlToAdf } from "@/lib/adf-html";
import { ISSUE_KEY, attachmentUrl, getIssue, jiraFail, jiraFor } from "@/lib/jira-server";
import { JiraError } from "@/lib/atlassian-mcp";

/** Read an existing bug so it can be edited here: GET ?key=LSINST-123 */
export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim().toUpperCase();
  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "That doesn't look like a ticket number (e.g. LSINST-123)" }, { status: 400 });
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;
  try {
    // *navigable brings custom fields too, so the "Environment" dropdown can be found by its label
    const j = await getIssue(jira, key, ["*navigable", "project", "attachment"]);
    const type = j.fields.issuetype?.name ?? "";
    // A bug that was later converted to a Task can still be edited; only epics are refused
    if (/epic/i.test(type)) return NextResponse.json({ error: `${key} is ${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}, not a ticket that can be edited here` }, { status: 422 });

    const envEntry = Object.entries(j.fields.customFields ?? {}).find(([label]) => /^environment$/i.test(label))?.[1];
    const envVal = envEntry?.value as { id?: string } | null | undefined;
    return NextResponse.json({
      key: j.key,
      url: jira.browse(j.key),
      project: j.fields.project?.key ?? key.split("-")[0],
      summary: j.fields.summary ?? "",
      description: htmlToAdf(j.fields.description),
      priorityId: j.fields.priority?.id,
      componentIds: (j.fields.components ?? []).map((c) => c.id),
      labels: j.fields.labels ?? [],
      envOptionId: envVal && typeof envVal === "object" ? envVal.id : undefined,
      attachments: (j.fields.attachment ?? []).map((a) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType ?? "",
        url: attachmentUrl(jira, a.id, a.filename),
      })),
    });
  } catch (e) {
    if (e instanceof JiraError && e.status === 404) return NextResponse.json({ error: `${key} not found` }, { status: 404 });
    return jiraFail(e, "Failed to read the ticket");
  }
}
