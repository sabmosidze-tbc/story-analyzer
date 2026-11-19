import { NextRequest, NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { AtlassianProvider, newTransport } from "@/lib/atlassian-mcp";
import { getSessionUserId } from "@/lib/github-session";

const RETURN_COOKIE = "atlassian_return";

/** "Connect Jira": send the user to Atlassian's consent screen (no app registration or token needed). */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const userId = await getSessionUserId(req);
  if (!userId) return NextResponse.redirect(new URL("/login", origin));

  const back = req.nextUrl.searchParams.get("returnTo");
  const returnTo = back && back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const provider = new AtlassianProvider(origin, userId);

  let res: NextResponse;
  try {
    const client = new Client({ name: "story-analyzer", version: "1.0.0" });
    await client.connect(newTransport(provider));
    await client.close();
    res = NextResponse.redirect(new URL(returnTo, origin)); // already connected
  } catch (e) {
    if (e instanceof UnauthorizedError && provider.authUrl) res = NextResponse.redirect(provider.authUrl);
    else return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't start the Jira connection" }, { status: 502 });
  }
  res.cookies.set(RETURN_COOKIE, returnTo, { httpOnly: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
