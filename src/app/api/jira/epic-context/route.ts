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

export interface JiraEpicStory {
  key: string;
  summary: string;
  description: string;
  status: string;
}

export interface EpicContextResponse {
  epicKey: string;
  epicSummary: string;
  stories: JiraEpicStory[];
}

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
  const epicRes = await fetch(
    `${base}/rest/api/3/issue/${key}?fields=summary,issuetype`,
    { headers }
  );

  if (!epicRes.ok) {
    if (epicRes.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404, headers: nc });
    if (epicRes.status === 401) return NextResponse.json({ error: "Jira authentication failed" }, { status: 401, headers: nc });
    return NextResponse.json({ error: "Failed to fetch Jira issue" }, { status: epicRes.status, headers: nc });
  }

  const epicData = await epicRes.json() as { fields: Record<string, unknown> };
  const issueTypeName = String(
    (epicData.fields.issuetype as Record<string, string>)?.name ?? ""
  ).toLowerCase();

  if (issueTypeName !== "epic") {
    return NextResponse.json(
      { error: `${key} is a "${(epicData.fields.issuetype as Record<string, string>)?.name ?? "Unknown"}" ticket, not an Epic. Please enter an Epic ticket key.` },
      { status: 422, headers: nc }
    );
  }

  const epicSummary = String(epicData.fields.summary ?? "");

  // ── Step 2: Fetch child stories via 3 parallel strategies ────────────────
  // Strategy A: Jira Software Agile API — native epic-children endpoint
  // Strategy B: next-gen / team-managed projects → parent = KEY
  // Strategy C: classic / company-managed projects → "Epic Link" = KEY
  // All three run in parallel; failures are silently ignored so one bad field
  // name doesn't block the other strategies. Results are merged + deduplicated.
  const searchFields = "summary,description,status,issuetype";
  const maxResults = 30;

  type JiraIssueRaw = {
    key: string;
    fields: {
      summary?: string;
      description?: AdfNode | null;
      status?: { name?: string };
      issuetype?: { name?: string };
    };
  };

  type StrategyResult = { issues: JiraIssueRaw[]; error?: string };

  async function runJql(jql: string): Promise<StrategyResult> {
    try {
      const res = await fetch(
        `${base}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=${searchFields}`,
        { headers }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { errorMessages?: string[] };
        return { issues: [], error: body.errorMessages?.[0] ?? `HTTP ${res.status}` };
      }
      const data = await res.json() as { issues?: JiraIssueRaw[] };
      return { issues: data.issues ?? [] };
    } catch (e) {
      return { issues: [], error: String(e) };
    }
  }

  async function runAgileApi(): Promise<StrategyResult> {
    try {
      const res = await fetch(
        `${base}/rest/agile/1.0/epic/${key}/issue?maxResults=${maxResults}&fields=${searchFields}`,
        { headers }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { errorMessages?: string[] };
        return { issues: [], error: body.errorMessages?.[0] ?? `HTTP ${res.status}` };
      }
      const data = await res.json() as { issues?: JiraIssueRaw[] };
      return { issues: data.issues ?? [] };
    } catch (e) {
      return { issues: [], error: String(e) };
    }
  }

  const [agileResult, nextGenResult, classicResult] = await Promise.all([
    runAgileApi(),
    runJql(`parent = ${key} ORDER BY created DESC`),
    runJql(`"Epic Link" = ${key} ORDER BY created DESC`),
  ]);

  // Merge and deduplicate by key
  const seen = new Set<string>();
  const merged: JiraIssueRaw[] = [];
  for (const issue of [...agileResult.issues, ...nextGenResult.issues, ...classicResult.issues]) {
    if (!seen.has(issue.key)) {
      seen.add(issue.key);
      merged.push(issue);
    }
  }

  const stories: JiraEpicStory[] = merged.map((issue) => ({
    key: issue.key,
    summary: String(issue.fields.summary ?? ""),
    description: issue.fields.description
      ? adfToText(issue.fields.description).trim()
      : "(no description)",
    status: String(issue.fields.status?.name ?? "Unknown"),
  }));

  return NextResponse.json(
    {
      epicKey: key,
      epicSummary,
      browseUrl: `${base}/browse/${key}`,
      stories,
      _debug: {
        agile:   { count: agileResult.issues.length,   error: agileResult.error   ?? null },
        nextGen: { count: nextGenResult.issues.length, error: nextGenResult.error ?? null },
        classic: { count: classicResult.issues.length, error: classicResult.error ?? null },
      },
    },
    { headers: nc }
  );
}
