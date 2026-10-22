"use client";

import { useEffect, useState } from "react";
import { Columns3, Timer } from "lucide-react";
import type { JiraBoardResponse } from "@/app/api/jira/board/route";

// One request per key per page load, shared across badges
const cache = new Map<string, Promise<JiraBoardResponse | null>>();

function loadBoard(key: string) {
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/jira/board?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? (r.json() as Promise<JiraBoardResponse>) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

const TYPE_LABEL: Record<string, string> = { kanban: "Kanban", scrum: "Scrum", simple: "Board" };
const TYPE_COLOR: Record<string, string> = {
  kanban: "text-sky-600 dark:text-sky-400",
  scrum: "text-violet-600 dark:text-violet-400",
};

/** Shows which Jira board (Kanban / Scrum) and sprint a ticket belongs to. */
export default function JiraBoardBadge({ jiraKey }: { jiraKey?: string }) {
  const [info, setInfo] = useState<{ key: string; data: JiraBoardResponse | null } | null>(null);

  useEffect(() => {
    if (!jiraKey) return;
    let cancelled = false;
    loadBoard(jiraKey.toUpperCase()).then((data) => {
      if (!cancelled) setInfo({ key: jiraKey, data });
    });
    return () => { cancelled = true; };
  }, [jiraKey]);

  const data = info && info.key === jiraKey ? info.data : null;
  if (!jiraKey || !data || (data.boards.length === 0 && !data.sprint)) return null;

  const board = data.boards[0];
  const extra = data.boards.length - 1;
  const pill =
    "flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700";

  return (
    <>
      {board && (
        <a
          href={board.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`${pill} hover:border-slate-400 dark:hover:border-slate-500 transition-colors`}
          title={data.boards.map((b) => `${b.name} (${TYPE_LABEL[b.type] ?? b.type})`).join("\n")}
        >
          <Columns3 className={`w-3 h-3 ${TYPE_COLOR[board.type] ?? ""}`} />
          <span className={`font-medium ${TYPE_COLOR[board.type] ?? ""}`}>{TYPE_LABEL[board.type] ?? board.type}</span>
          {extra > 0 && <span>+{extra}</span>}
        </a>
      )}
      {data.sprint && (
        <span className={pill} title={`Sprint state: ${data.sprint.state}`}>
          <Timer className="w-3 h-3" />
          {data.sprint.name}
          {data.sprint.state !== "active" && <span className="opacity-70">({data.sprint.state})</span>}
        </span>
      )}
    </>
  );
}
