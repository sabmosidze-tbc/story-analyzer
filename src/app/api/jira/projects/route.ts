import { NextRequest, NextResponse } from "next/server";
import { jiraEnv, jiraError } from "@/lib/jira-server";

/** Projects the Jira user can create issues in, filtered by name or key. */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  try {
    const res = await fetch(
      `${env.base}/rest/api/3/project/search?action=create&maxResults=20&orderBy=name${q ? `&query=${encodeURIComponent(q)}` : ""}`,
      { headers: env.headers },
    );
    if (!res.ok) return NextResponse.json({ error: await jiraError(res, "Failed to load projects") }, { status: res.status });
    const data = (await res.json()) as { values?: { key: string; name: string }[] };
    return NextResponse.json({ projects: (data.values ?? []).map((p) => ({ key: p.key, name: p.name })) });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
