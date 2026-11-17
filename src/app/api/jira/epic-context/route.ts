import { NextRequest, NextResponse } from "next/server";

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
};

function adfToText(node: AdfNode): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return String(node.attrs?.text ?? "");
  const children = Array.isArray(node.content)
    ? node.content.map((c) => adfToText(c)).join("")
    : "";
  switch (node.type) {
    case "paragraph":   return children + "\n";
    case "heading":     return `\n${"#".repeat(Number(node.attrs?.level) || 1)} ${children}\n`;
    case "bulletList":
    case "orderedList": return children;
    case "listItem":    return `- ${children}`;
    case "codeBlock":   return `\`\`\`\n${children}\`\`\`\n`;
    case "blockquote":  return `> ${children}\n`;
    case "rule":        return "\n---\n";
    default:            return children;
  }
}

import type { EpicStory } from "@/types";

export interface EpicContextResponse {
  epicKey: string;
  epicSummary: string;
  epicDescription: string;
  browseUrl: string;
  stories: EpicStory[];
}

const MAX_STORIES = 300;
const PAGE = 100;

type JiraIssueRaw = {
  key: string;
  fields: {
    summary?: string;
    description?: AdfNode | null;
    status?: { name?: string };
    issuetype?: { name?: string; subtask?: boolean };
    assignee?: { displayName?: string } | null;
  };
};
type StrategyResult = { issues: JiraIssueRaw[]; error?: string };

export async function GET(req: NextRequest) {
  // Never cache — Jira data changes frequently and cached error responses cause confusion
  const nc = { "Cache-Control": "no-store, no-cache, must-revalidate" };

  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503, headers: nc });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400, headers: nc });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  // ── Step 1: Fetch the ticket and verify it is an Epic ──────────────────────
  const epicRes = await fetch(`${base}/rest/api/3/issue/${key}?fields=summary,description,issuetype`, { headers });
  if (!epicRes.ok) {
    if (epicRes.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404, headers: nc });
    if (epicRes.status === 401) return NextResponse.json({ error: "Jira authentication failed" }, { status: 401, headers: nc });
    return NextResponse.json({ error: "Failed to fetch Jira issue" }, { status: epicRes.status, headers: nc });
  }

  const epicData = await epicRes.json() as { fields: { summary?: string; description?: AdfNode | null; issuetype?: { name?: string } } };
  const typeName = epicData.fields.issuetype?.name ?? "Unknown";
  if (typeName.toLowerCase() !== "epic") {
    return NextResponse.json(
      { error: `${key} is a "${typeName}" ticket, not an Epic. Please enter an Epic ticket key.` },
      { status: 422, headers: nc }
    );
  }

  // ── Step 2: Child issues, all pages ─────────────────────────────────────────
  // A: Agile epic endpoint · B: parent = KEY (all project types on Jira Cloud)
  // C: "Epic Link" (older company-managed projects). Merged + deduplicated.
  const fields = "summary,description,status,issuetype,assignee";

  const errorOf = async (res: Response) => {
    const body = await res.json().catch(() => ({})) as { errorMessages?: string[] };
    return body.errorMessages?.[0] ?? `HTTP ${res.status}`;
  };

  async function runJql(jql: string): Promise<StrategyResult> {
    const issues: JiraIssueRaw[] = [];
    let next: string | undefined;
    try {
      do {
        const url = `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${PAGE}&fields=${fields}${next ? `&nextPageToken=${encodeURIComponent(next)}` : ""}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return { issues, error: await errorOf(res) };
        const data = await res.json() as { issues?: JiraIssueRaw[]; nextPageToken?: string; isLast?: boolean };
        issues.push(...(data.issues ?? []));
        next = data.isLast === false || data.nextPageToken ? data.nextPageToken : undefined;
      } while (next && issues.length < MAX_STORIES);
      return { issues };
    } catch (e) {
      return { issues, error: String(e) };
    }
  }

  async function runAgileApi(): Promise<StrategyResult> {
    const issues: JiraIssueRaw[] = [];
    try {
      for (let startAt = 0; startAt < MAX_STORIES; ) {
        const res = await fetch(`${base}/rest/agile/1.0/epic/${key}/issue?startAt=${startAt}&maxResults=${PAGE}&fields=${fields}`, { headers });
        if (!res.ok) return { issues, error: await errorOf(res) };
        const data = await res.json() as { issues?: JiraIssueRaw[]; total?: number };
        const page = data.issues ?? [];
        issues.push(...page);
        startAt += page.length;
        if (page.length === 0 || (data.total !== undefined && startAt >= data.total)) break;
      }
      return { issues };
    } catch (e) {
      return { issues, error: String(e) };
    }
  }

  const results = await Promise.all([
    runAgileApi(),
    runJql(`parent = ${key} ORDER BY rank ASC`),
    runJql(`"Epic Link" = ${key} ORDER BY rank ASC`),
  ]);

  if (results.every((r) => r.error)) {
    return NextResponse.json(
      { error: `Couldn't load the stories of ${key} from Jira: ${results[0].error ?? results[1].error}` },
      { status: 502, headers: nc }
    );
  }

  const seen = new Set<string>();
  const stories: EpicStory[] = [];
  // Prefer search/jql results (ADF descriptions) over the agile API (plain-text descriptions).
  for (const issue of [results[1], results[2], results[0]].flatMap((r) => r.issues)) {
    if (seen.has(issue.key) || issue.fields.issuetype?.subtask) continue;
    seen.add(issue.key);
    const desc = issue.fields.description as AdfNode | string | null | undefined;
    stories.push({
      key: issue.key,
      summary: String(issue.fields.summary ?? ""),
      description: typeof desc === "string" ? desc.trim() : desc ? adfToText(desc).trim() : "",
      status: String(issue.fields.status?.name ?? "Unknown"),
      ...(issue.fields.issuetype?.name ? { type: issue.fields.issuetype.name } : {}),
      ...(issue.fields.assignee?.displayName ? { assignee: issue.fields.assignee.displayName } : {}),
    });
  }
  // Natural key order (LSINST-2 before LSINST-10)
  stories.sort((a, b) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]));

  const body: EpicContextResponse = {
    epicKey: key,
    epicSummary: String(epicData.fields.summary ?? ""),
    epicDescription: epicData.fields.description ? adfToText(epicData.fields.description).trim() : "",
    browseUrl: `${base}/browse/${key}`,
    stories: stories.slice(0, MAX_STORIES),
  };
  return NextResponse.json(body, { headers: nc });
}
