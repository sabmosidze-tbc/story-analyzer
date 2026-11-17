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
    case "paragraph":    return children + "\n";
    case "heading":      return `\n${"#".repeat(Number(node.attrs?.level) || 1)} ${children}\n`;
    case "bulletList":
    case "orderedList":  return children;
    case "listItem":     return `- ${children}`;
    case "codeBlock":    return `\`\`\`\n${children}\`\`\`\n`;
    case "blockquote":   return `> ${children}\n`;
    case "rule":         return "\n---\n";
    default:             return children;
  }
}

export async function GET(req: NextRequest) {
  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const res = await fetch(
      `${base}/rest/api/3/issue/${key}?fields=summary,description,issuetype,status,parent`,
      {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (err.errorMessages as string[] | undefined)?.[0];
      if (res.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404 });
      if (res.status === 401) return NextResponse.json({ error: "Jira authentication failed. Check JIRA_EMAIL and JIRA_API_TOKEN." }, { status: 401 });
      return NextResponse.json({ error: msg ?? "Failed to fetch Jira issue" }, { status: res.status });
    }

    const data = await res.json() as { fields: Record<string, unknown> };
    const { fields } = data;
    const summary    = String(fields.summary ?? "");
    const issueType  = String((fields.issuetype as Record<string, string>)?.name ?? "");
    if (/bug|defect/i.test(issueType)) {
      return NextResponse.json({ error: `${key} is a ${issueType} card. Only stories can be analyzed.` }, { status: 422 });
    }
    const status     = String((fields.status as Record<string, string>)?.name ?? "");
    const descRaw    = fields.description ? adfToText(fields.description as AdfNode) : "";
    const meta       = [issueType, status].filter(Boolean).join(" · ");
    const parent     = fields.parent as { key?: string; fields?: { issuetype?: { name?: string } } } | undefined;
    const epicKey    = parent?.key && /epic/i.test(parent.fields?.issuetype?.name ?? "") ? parent.key : undefined;

    const storyText = [
      `${key}: ${summary}`,
      meta ? `[${meta}]` : "",
      "",
      descRaw.trim(),
    ]
      .filter((l, i) => i < 2 || l !== "")
      .join("\n")
      .trim();

    return NextResponse.json({ key, summary, storyText, issueType, epicKey, browseUrl: `${base}/browse/${key}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect to Jira" },
      { status: 500 }
    );
  }
}
