import { NextRequest, NextResponse } from "next/server";
import { AtlassianProvider, newTransport } from "@/lib/atlassian-mcp";
import { getSessionUserId } from "@/lib/github-session";

const RETURN_COOKIE = "atlassian_return";

/** Atlassian sends the user back here with a one-time code; swap it for tokens. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const back = req.cookies.get(RETURN_COOKIE)?.value;
  const returnTo = back && back.startsWith("/") && !back.startsWith("//") ? back : "/";
  const go = (params: string) => {
    const url = new URL(returnTo, origin);
    for (const [k, v] of new URLSearchParams(params)) url.searchParams.set(k, v);
    const res = NextResponse.redirect(url);
    res.cookies.delete(RETURN_COOKIE);
    return res;
  };

  const userId = await getSessionUserId(req);
  if (!userId) return NextResponse.redirect(new URL("/login", origin));
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return go(`atlassian=error&reason=${encodeURIComponent(req.nextUrl.searchParams.get("error_description") ?? req.nextUrl.searchParams.get("error") ?? "no code")}`);
  try {
    await newTransport(new AtlassianProvider(origin, userId)).finishAuth(code);
    return go("atlassian=connected");
  } catch (e) {
    return go(`atlassian=error&reason=${encodeURIComponent(e instanceof Error ? e.message : "failed")}`);
  }
}
