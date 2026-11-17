import { NextResponse } from "next/server";

/** Jira connection details from .env.local, or a ready-made 503 response. */
export function jiraEnv():
  | { ok: true; base: string; headers: Record<string, string> }
  | { ok: false; res: NextResponse } {
  const base  = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return { ok: false, res: NextResponse.json({ error: "Jira not configured" }, { status: 503 }) };
  }
  return {
    ok: true,
    base,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`,
      Accept: "application/json",
    },
  };
}

export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{1,9}-\d+$/;
export const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,9}$/;

/** First readable message from a Jira error body. */
export async function jiraError(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as { errorMessages?: string[]; errors?: Record<string, string> };
  const fieldErrors = Object.entries(err.errors ?? {}).map(([k, v]) => `${k}: ${v}`);
  return err.errorMessages?.[0] ?? fieldErrors[0] ?? (res.status === 401 ? "Jira authentication failed" : res.status === 403 ? "No permission in Jira" : fallback);
}
