import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key || !/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(
    `${base}/rest/api/3/issue/${key}?fields=summary,issuetype`,
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Issue not found" }, { status: res.status });
  }

  const data = await res.json() as { fields?: { summary?: string; issuetype?: { name?: string } } };
  return NextResponse.json({
    summary: data.fields?.summary ?? "",
    issueType: data.fields?.issuetype?.name ?? "",
    browseUrl: `${base}/browse/${key}`,
  });
}
