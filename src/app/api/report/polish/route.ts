import { NextRequest, NextResponse } from "next/server";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";

const PROMPT = `You are a senior QA engineer tidying up a bug report written by a tester.
Rewrite ONLY the wording. Never invent facts, numbers, IDs, endpoints or behaviour that are not in the input.
Keep the tester's language (English stays English).

Return JSON only:
{
  "title": "short Jira bug title, max 100 chars: <where> — <what goes wrong> [<when/condition>]. No ticket keys, no 'Bug:' prefix.",
  "steps": ["each reproduction step as one clear imperative sentence, same order and same meaning; keep IDs/values"],
  "actual": "what actually happened, 1-3 plain sentences, factual, mention error messages/codes exactly as given",
  "expected": "what should have happened, 1-2 plain sentences"
}
If a field in the input is empty, return it empty.`;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

  const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const input = {
    kind: body.kind === "observation" ? "observation" : "bug",
    story: s(body.story, 300),
    title: s(body.title, 300),
    preconditions: s(body.preconditions, 2000),
    steps: Array.isArray(body.steps) ? body.steps.map((x) => s(x, 600)).slice(0, 30) : [],
    expected: s(body.expected, 2000),
    actual: s(body.actual, 3000),
  };
  if (!input.title && !input.actual && !input.steps.length) {
    return NextResponse.json({ error: "Nothing to polish yet" }, { status: 400 });
  }

  const token = await getGitHubAccessToken(req);
  if (!token) return NextResponse.json(NOT_SIGNED_IN, { status: 401 });

  try {
    const { runCopilot, resolveCopilotModel, describeCopilotError } = await import("@/lib/copilot-sdk");
    let raw: string;
    try {
      raw = await runCopilot({
        token,
        model: await resolveCopilotModel(token, typeof body.model === "string" ? body.model : undefined),
        system: PROMPT,
        user: JSON.stringify(input, null, 2),
        timeoutMs: 90_000,
      });
    } catch (err) {
      return NextResponse.json({ error: describeCopilotError(err) }, { status: 502 });
    }
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    const out = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as Record<string, unknown>;
    return NextResponse.json({
      title: s(out.title, 255).trim(),
      steps: Array.isArray(out.steps) ? out.steps.map((x) => s(x, 600).trim()).filter(Boolean) : [],
      actual: s(out.actual, 3000).trim(),
      expected: s(out.expected, 2000).trim(),
    });
  } catch {
    return NextResponse.json({ error: "AI returned something unreadable — try again" }, { status: 502 });
  }
}
