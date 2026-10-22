import { NextRequest, NextResponse } from "next/server";
import { listCopilotModels, DEFAULT_COPILOT_MODEL, describeCopilotError } from "@/lib/copilot-sdk";
import { getGitHubAccessToken, NOT_SIGNED_IN } from "@/lib/github-session";

export interface CopilotModelEntry {
  id: string;       // value sent to the API: "copilot/<rawId>"
  rawId: string;
  label: string;
}

export async function GET(req: NextRequest) {
  const ghToken = await getGitHubAccessToken(req);
  if (!ghToken) return NextResponse.json({ ...NOT_SIGNED_IN, models: [] }, { status: 401 });
  try {
    const models = await listCopilotModels(ghToken);
    const entries: CopilotModelEntry[] = models.map((m) => ({
      id: `copilot/${m.id}`,
      rawId: m.id,
      label: m.name || m.id,
    }));
    const ids = models.map((m) => m.id);
    const defaultRaw = ids.includes(DEFAULT_COPILOT_MODEL) ? DEFAULT_COPILOT_MODEL : ids.includes("auto") ? "auto" : ids[0];
    return NextResponse.json({ models: entries, defaultModel: defaultRaw ? `copilot/${defaultRaw}` : null });
  } catch (err) {
    return NextResponse.json({ error: describeCopilotError(err), models: [] }, { status: 502 });
  }
}
