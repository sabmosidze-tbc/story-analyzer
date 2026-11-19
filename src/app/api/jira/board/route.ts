import { NextRequest, NextResponse } from "next/server";
import { boardUrl, customValue, getIssue, jiraFail, jiraFor, projectBoards } from "@/lib/jira-server";

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

interface Sprint { id?: number; name: string; state: string; boardId?: number; originBoardId?: number }

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key")?.toUpperCase();
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;
  const project = key.split("-")[0];

  try {
    const [boards, issue] = await Promise.all([
      projectBoards(jira, project).catch(() => []),
      getIssue(jira, key, ["customfield_10020"]),
    ]);

    // The Sprint field lists every sprint the issue was in; prefer the open one, else the latest
    const raw = customValue(issue.fields, "customfield_10020");
    const sprints = ((Array.isArray(raw) ? raw : []) as Sprint[]).slice().sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const sprint = sprints.find((s) => s.state === "active") ?? sprints.find((s) => s.state === "future") ?? sprints[0] ?? null;

    // Prefer the board that owns the issue's sprint; otherwise list the project's boards
    const owner = sprint?.originBoardId ?? sprint?.boardId;
    const owning = owner ? boards.filter((b) => b.id === owner) : [];
    const chosen = owning.length > 0 ? owning : boards;

    const body: JiraBoardResponse = {
      key,
      boards: chosen.map((b) => ({ id: b.id, name: b.name, type: b.type, url: boardUrl(jira, b.id) })),
      sprint: sprint ? { name: sprint.name, state: sprint.state } : null,
    };
    return NextResponse.json(body);
  } catch (e) {
    return jiraFail(e, "Failed to load board info");
  }
}
