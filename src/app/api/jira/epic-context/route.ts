import { NextRequest, NextResponse } from "next/server";
import type { EpicStory } from "@/types";
import { getIssue, htmlToText, jiraFail, jiraFor, searchAll, type Issue } from "@/lib/jira-server";

export interface EpicContextResponse {
  epicKey: string;
  epicSummary: string;
  epicDescription: string;
  browseUrl: string;
  stories: EpicStory[];
}

const MAX_STORIES = 300;
type StrategyResult = { issues: Issue[]; error?: string };

export async function GET(req: NextRequest) {
  // Never cache — Jira data changes frequently and cached error responses cause confusion
  const nc = { "Cache-Control": "no-store, no-cache, must-revalidate" };

  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400, headers: nc });
  }
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  // ── Step 1: Fetch the ticket and verify it is an Epic ──────────────────────
  let epic: Issue;
  try {
    epic = await getIssue(jira, key, ["summary", "description", "issuetype"]);
  } catch (e) {
    const res = jiraFail(e, "Failed to fetch Jira issue");
    res.headers.set("Cache-Control", nc["Cache-Control"]);
    return res;
  }
  const typeName = epic.fields.issuetype?.name ?? "Unknown";
  if (typeName.toLowerCase() !== "epic") {
    return NextResponse.json(
      { error: `${key} is a "${typeName}" ticket, not an Epic. Please enter an Epic ticket key.` },
      { status: 422, headers: nc }
    );
  }

  // ── Step 2: Child issues, all pages ─────────────────────────────────────────
  // parent = KEY (all project types on Jira Cloud) · "Epic Link" (older company-managed projects)
  const fields = ["summary", "description", "status", "issuetype", "assignee"];
  const run = async (jql: string): Promise<StrategyResult> => {
    try { return { issues: await searchAll(jira, jql, fields, MAX_STORIES) }; }
    catch (e) { return { issues: [], error: e instanceof Error ? e.message : String(e) }; }
  };
  const results = await Promise.all([
    run(`parent = ${key} ORDER BY rank ASC`),
    run(`"Epic Link" = ${key} ORDER BY rank ASC`),
  ]);

  if (results.every((x) => x.error)) {
    return NextResponse.json(
      { error: `Couldn't load the stories of ${key} from Jira: ${results[0].error ?? results[1].error}` },
      { status: 502, headers: nc }
    );
  }

  const seen = new Set<string>();
  const stories: EpicStory[] = [];
  for (const issue of results.flatMap((x) => x.issues)) {
    if (seen.has(issue.key) || issue.fields.issuetype?.subtask) continue;
    seen.add(issue.key);
    stories.push({
      key: issue.key,
      summary: String(issue.fields.summary ?? ""),
      description: htmlToText(issue.fields.description),
      status: String(issue.fields.status?.name ?? "Unknown"),
      ...(issue.fields.issuetype?.name ? { type: issue.fields.issuetype.name } : {}),
      ...(issue.fields.assignee?.displayName ? { assignee: issue.fields.assignee.displayName } : {}),
    });
  }
  // Natural key order (LSINST-2 before LSINST-10)
  stories.sort((a, b) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]));

  const body: EpicContextResponse = {
    epicKey: key,
    epicSummary: String(epic.fields.summary ?? ""),
    epicDescription: htmlToText(epic.fields.description),
    browseUrl: jira.browse(key),
    stories: stories.slice(0, MAX_STORIES),
  };
  return NextResponse.json(body, { headers: nc });
}
