import { NextRequest, NextResponse } from "next/server";

export interface JiraBoardInfo {
  id: number;
  name: string;
  type: "kanban" | "scrum" | "simple" | string;
  url: string;
}

export interface JiraBoardResponse {
  key: string;
  boards: JiraBoardInfo[];
  sprint: { name: string; state: string } | null;
}

interface AgileBoard { id: number; name: string; type: string }
interface AgileSprint { name: string; state: string; originBoardId?: number }

const BOARDS_TTL_MS = 10 * 60 * 1000;
const g = globalThis as typeof globalThis & {
  __jiraProjectBoards?: Map<string, { at: number; boards: AgileBoard[] }>;
};
const boardCache = (g.__jiraProjectBoards ??= new Map());

export async function GET(req: NextRequest) {
  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503 });
  }

  const key = req.nextUrl.searchParams.get("key")?.toUpperCase();
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  const project = key.split("-")[0];
  const headers = { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`, Accept: "application/json" };

  try {
    const cached = boardCache.get(project);
    const boardsPromise: Promise<AgileBoard[]> = cached && Date.now() - cached.at < BOARDS_TTL_MS
      ? Promise.resolve(cached.boards)
      : fetch(`${base}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}&maxResults=50`, { headers })
          .then(async (r) => (r.ok ? ((await r.json()) as { values?: AgileBoard[] }).values ?? [] : []))
          .then((boards) => {
            boardCache.set(project, { at: Date.now(), boards });
            return boards;
          });

    const [boards, issueRes] = await Promise.all([
      boardsPromise,
      fetch(`${base}/rest/agile/1.0/issue/${key}?fields=sprint,closedSprints`, { headers }),
    ]);

    let sprint: AgileSprint | null = null;
    if (issueRes.ok) {
      const issue = (await issueRes.json()) as { fields?: { sprint?: AgileSprint | null; closedSprints?: AgileSprint[] } };
      sprint = issue.fields?.sprint ?? issue.fields?.closedSprints?.at(-1) ?? null;
    } else if (issueRes.status === 404) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }

    // Prefer the board that owns the issue's sprint; otherwise list the project's boards
    const owning = sprint?.originBoardId ? boards.filter((b) => b.id === sprint!.originBoardId) : [];
    const chosen = owning.length > 0 ? owning : boards;

    const body: JiraBoardResponse = {
      key,
      boards: chosen.map((b) => ({ id: b.id, name: b.name, type: b.type, url: `${base}/secure/RapidBoard.jspa?rapidView=${b.id}` })),
      sprint: sprint ? { name: sprint.name, state: sprint.state } : null,
    };
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "Failed to load board info" }, { status: 502 });
  }
}
