import type { Jira } from "@/lib/atlassian-mcp";
import { htmlToAdf, type AdfNode } from "@/lib/adf-html";

export { jiraFor, jiraFail } from "@/lib/atlassian-mcp";

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;
export const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/;

export type Fields = Record<string, unknown> & {
  summary?: string;
  description?: string | null;
  issuetype?: { id?: string; name?: string; subtask?: boolean };
  status?: { name?: string; statusCategory?: { key?: string } };
  project?: { key: string; name?: string };
  priority?: { id?: string; name?: string };
  components?: { id: string; name?: string }[];
  labels?: string[];
  assignee?: { displayName?: string } | null;
  parent?: { key?: string; fields?: { issuetype?: { name?: string } } };
  attachment?: { id: string; filename: string; mimeType?: string; size?: number; created?: string }[];
  customFields?: Record<string, { id?: string; value?: unknown }>;
};
export type Issue = { id?: string; key: string; fields: Fields };

/** Read one issue with Jira's full field set; rich text comes back as HTML. */
export const getIssue = (jira: Jira, key: string, fields: string[]) =>
  jira.call<Issue>("getJiraIssue", { issueIdOrKey: key, fields, view: "full", responseContentFormat: "html" });

/** JQL search over all pages (up to `max`). */
export async function searchAll(jira: Jira, jql: string, fields: string[], max = 300): Promise<Issue[]> {
  const out: Issue[] = [];
  let next: string | undefined;
  do {
    const page = await jira.call<{ issues?: Issue[]; nextPageToken?: string; isLast?: boolean }>("searchJiraIssuesUsingJql", {
      jql, fields, maxResults: Math.min(100, max - out.length), view: "full", responseContentFormat: "html",
      ...(next ? { nextPageToken: next } : {}),
    });
    out.push(...(page.issues ?? []));
    next = page.isLast === false || (page.isLast === undefined && page.nextPageToken) ? page.nextPageToken : undefined;
  } while (next && out.length < max);
  return out;
}

/** Value of a custom field, whether Jira returns it raw or under `customFields` by label. */
export function customValue(fields: Fields, id: string): unknown {
  if (id in fields) return fields[id];
  return Object.values(fields.customFields ?? {}).find((f) => f?.id === id)?.value;
}

export const attachmentUrl = (jira: Jira, id: string, name: string) => `${jira.site.url}/secure/attachment/${id}/${encodeURIComponent(name)}`;
export const boardUrl = (jira: Jira, id: number) => `${jira.site.url}/secure/RapidBoard.jspa?rapidView=${id}`;

type Board = { id: number; name: string; type: string };
const BOARDS_TTL_MS = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & { __jiraProjectBoards?: Map<string, { at: number; boards: Board[] }> };
const boardCache = (g.__jiraProjectBoards ??= new Map());

/** Boards that show a project's issues (cached for 10 minutes). */
export async function projectBoards(jira: Jira, project: string): Promise<Board[]> {
  const key = `${jira.site.cloudId}/${project}`;
  const cached = boardCache.get(key);
  if (cached && Date.now() - cached.at < BOARDS_TTL_MS) return cached.boards;
  const data = await jira.call<{ values?: Board[] }>("listJiraBoards", { projectKeyOrId: project, maxResults: 50 });
  const boards = (data.values ?? []).map((b) => ({ id: b.id, name: b.name, type: b.type }));
  boardCache.set(key, { at: Date.now(), boards });
  return boards;
}

/** Plain text of a Jira rich-text body (stories and epics, for the AI). */
export function htmlToText(html: string | null | undefined): string {
  const doc = htmlToAdf(html);
  return doc ? adfToText(doc).trim() : "";
}

function adfToText(node: AdfNode): string {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "status") return String(node.attrs?.text ?? "");
  const children = Array.isArray(node.content) ? node.content.map(adfToText).join("") : "";
  switch (node.type) {
    case "paragraph":   return children + "\n";
    case "heading":     return `\n${"#".repeat(Number(node.attrs?.level) || 1)} ${children}\n`;
    case "bulletList":
    case "orderedList": return children;
    case "listItem":    return `- ${children}`;
    case "codeBlock":   return `\`\`\`\n${children}\`\`\`\n`;
    case "blockquote":  return `> ${children}\n`;
    case "rule":        return "\n---\n";
    case "tableRow":    return children + "\n";
    case "tableCell":
    case "tableHeader": return children.trim() + " | ";
    default:            return children;
  }
}
