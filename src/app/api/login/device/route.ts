import { NextResponse } from "next/server";
import { startDeviceFlow } from "@/lib/github-device";

/** Start "Sign in with GitHub" using a one-time code. Public: called from the login page. */
export async function POST() {
  try {
    return NextResponse.json(await startDeviceFlow(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Couldn't reach GitHub" }, { status: 502 });
  }
}
