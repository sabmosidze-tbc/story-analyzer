import { NextRequest, NextResponse } from "next/server";
import { adfToHtml, type AdfNode } from "@/lib/adf-html";
import { JiraError } from "@/lib/atlassian-mcp";
import { ISSUE_KEY, htmlToText, jiraFail, jiraFor } from "@/lib/jira-server";

function txt(s: string): AdfNode {
  return { type: "text", text: s.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1") };
}

function markdownToAdf(title: string, markdown: string): AdfNode {
  const nodes: AdfNode[] = [{ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: title }] }];
  let listItems: AdfNode[] = [];
  let listType: "bulletList" | "orderedList" | null = null;
  const flushList = () => {
    if (listItems.length && listType) nodes.push({ type: listType, content: listItems });
    listItems = [];
    listType = null;
  };

  for (const line of markdown.split("\n")) {
    const t = line.trim();
    if (!t) { flushList(); continue; }
    const hm = t.match(/^#{1,4}\s+(.+)/);
    const bm = t.match(/^[-*•]\s+(.+)/);
    const nm = t.match(/^(\d+)\.\s+(.+)/);
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
  return { type: "doc", attrs: { version: 1 }, content: nodes };
}

/** Normalize text for duplicate comparison: strip markdown, collapse whitespace, lowercase. */
const normalize = (s: string) => s.replace(/[#*`>_~•]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const key = String(body.key ?? "");
  const title = String(body.title ?? "");
  const content = String(body.content ?? "");
  // Callers can send a ready-made ADF document instead of markdown (richer formatting).
  const adf = body.adf && typeof body.adf === "object" && (body.adf as { type?: unknown }).type === "doc" ? (body.adf as AdfNode) : null;

  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  if (!adf && (!title || !content)) return NextResponse.json({ error: "Missing title or content" }, { status: 400 });

  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;
  const html = adfToHtml(adf ?? markdownToAdf(title, content));

  // ── Duplicate check: skip if this user already posted this exact content ──
  try {
    const [me, list] = await Promise.all([
      jira.call<{ accountId?: string }>("atlassianUserInfo", {}),
      jira.call<{ comments?: { author?: { accountId?: string }; body?: string }[] }>("listJiraIssueComments", {
        issueIdOrKey: key, maxResults: 20, orderBy: "-created", responseContentFormat: "html", view: "full",
      }),
    ]);
    const mine = normalize(htmlToText(html));
    if (me.accountId && (list.comments ?? []).some((c) => c.author?.accountId === me.accountId && normalize(htmlToText(c.body)) === mine)) {
      return NextResponse.json({ alreadyPosted: true });
    }
  } catch { /* if the check fails, post anyway */ }

  try {
    const res = await jira.call<Record<string, unknown>>("addOrEditJiraIssueComment", { issueIdOrKey: key, commentBody: html, contentFormat: "html" });
    const id = String(res.commentId ?? res.id ?? (res.comment as { id?: string } | undefined)?.id ?? "");
    const created = String(res.created ?? (res.comment as { created?: string } | undefined)?.created ?? new Date().toISOString());
    return NextResponse.json({ id, created, url: id ? `${jira.browse(key)}?focusedCommentId=${id}` : jira.browse(key) });
  } catch (e) {
    if (e instanceof JiraError && e.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404 });
    return jiraFail(e, "Failed to post comment");
  }
}
