import { NextRequest, NextResponse } from "next/server";

type AdfInlineNode = { type: "text"; text: string };
type AdfParagraph  = { type: "paragraph"; content: AdfInlineNode[] };
type AdfHeading    = { type: "heading";   attrs: { level: number }; content: AdfInlineNode[] };
type AdfListItem   = { type: "listItem";  content: AdfParagraph[] };
type AdfList       = { type: "bulletList" | "orderedList"; content: AdfListItem[] };
type AdfBlock      = AdfParagraph | AdfHeading | AdfList;

function txt(s: string): AdfInlineNode {
  return { type: "text", text: s.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1") };
}

function markdownToAdf(title: string, markdown: string): { body: { type: "doc"; version: 1; content: AdfBlock[] } } {
  const nodes: AdfBlock[] = [];
  nodes.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: title }] });

  let listItems: AdfListItem[] = [];
  let listType: "bulletList" | "orderedList" | null = null;

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      nodes.push({ type: listType, content: listItems });
      listItems = [];
      listType  = null;
    }
  };

  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t) { flushList(); continue; }

    const hm  = t.match(/^#{1,4}\s+(.+)/);
    const bm  = t.match(/^[-*•]\s+(.+)/);
    const nm  = t.match(/^(\d+)\.\s+(.+)/);

    if (hm) {
      flushList();
      nodes.push({ type: "heading", attrs: { level: 4 }, content: [txt(hm[1])] });
    } else if (bm) {
      if (listType === "orderedList") flushList();
      listType = "bulletList";
      listItems.push({ type: "listItem", content: [{ type: "paragraph", content: [txt(bm[1])] }] });
    } else if (nm) {
      if (listType === "bulletList") flushList();
      listType = "orderedList";
      listItems.push({ type: "listItem", content: [{ type: "paragraph", content: [txt(nm[2])] }] });
    } else {
      flushList();
      nodes.push({ type: "paragraph", content: [txt(t)] });
    }
  }
  flushList();

  return { body: { type: "doc", version: 1, content: nodes } };
}

/** Extract all plain text from a Jira ADF node tree. */
function extractAdfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  const parts: string[] = [];
  if (n.type === "text" && typeof n.text === "string") parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) parts.push(extractAdfText(child));
  }
  return parts.join(" ");
}

/** Normalize text for duplicate comparison: strip markdown, collapse whitespace, lowercase. */
function normalizeForCompare(s: string): string {
  return s
    .replace(/[#*`>_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export async function POST(req: NextRequest) {
  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const key     = String(body.key     ?? "");
  const title   = String(body.title   ?? "");
  const content = String(body.content ?? "");

  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  if (!title || !content) {
    return NextResponse.json({ error: "Missing title or content" }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${email}:${token}`).toString("base64");

    // ── Duplicate check: skip if we already posted this exact content ──────
    try {
      const listRes = await fetch(
        `${base}/rest/api/3/issue/${key}/comment?maxResults=50&orderBy=-created`,
        { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
      );
      if (listRes.ok) {
        const listData = await listRes.json() as {
          comments: Array<{ author: { emailAddress?: string }; body: unknown }>;
        };
        const newNorm = normalizeForCompare(`${title} ${content}`);
        for (const comment of listData.comments) {
          if (comment.author?.emailAddress !== email) continue;
          const existNorm = normalizeForCompare(extractAdfText(comment.body));
          if (existNorm === newNorm) {
            return NextResponse.json({ alreadyPosted: true });
          }
        }
      }
    } catch { /* if the check fails, proceed to post anyway */ }

    const res  = await fetch(`${base}/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      headers: {
        Authorization:   `Basic ${auth}`,
        "Content-Type":  "application/json",
        Accept:          "application/json",
      },
      body: JSON.stringify(markdownToAdf(title, content)),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (err.errorMessages as string[] | undefined)?.[0];
      if (res.status === 401) return NextResponse.json({ error: "Jira authentication failed" }, { status: 401 });
      if (res.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404 });
      return NextResponse.json({ error: msg ?? "Failed to post comment" }, { status: res.status });
    }

    const data = await res.json() as { id: string; created: string };
    return NextResponse.json({ id: data.id, created: data.created });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect to Jira" },
      { status: 500 }
    );
  }
}
