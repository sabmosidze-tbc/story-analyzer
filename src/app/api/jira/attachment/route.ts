import { NextRequest, NextResponse } from "next/server";
import { jiraEnv, jiraError } from "@/lib/jira-server";

// Keep in sync with experimental.proxyClientMaxBodySize in next.config.ts
const MAX_BYTES = 250 * 1024 * 1024;

/** Upload a file as an attachment on a Jira issue. Expects multipart form: key, file. */
export async function POST(req: NextRequest) {
  const base  = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!base || !email || !token) {
    return NextResponse.json({ error: "Jira not configured" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const key  = String(form.get("key") ?? "");
  const file = form.get("file");
  if (!/^[A-Z]{2,10}-\d+$/.test(key)) {
    return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is larger than 250 MB" }, { status: 413 });
  }
  // The browser sends the real size; a mismatch means the upload was cut short on the way
  const expected = Number(form.get("size") ?? NaN);
  if (Number.isFinite(expected) && expected !== file.size) {
    return NextResponse.json({ error: "File arrived incomplete — please retry" }, { status: 422 });
  }
  const name = file.name.replace(/[\\/:*?"<>|]/g, "").slice(0, 120) || "attachment";

  const out = new FormData();
  out.append("file", file, name);

  try {
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const res = await fetch(`${base}/rest/api/3/issue/${key}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: out,
    });
    if (!res.ok) {
      if (res.status === 401) return NextResponse.json({ error: "Jira authentication failed" }, { status: 401 });
      if (res.status === 403) return NextResponse.json({ error: "No permission to add attachments" }, { status: 403 });
      if (res.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404 });
      return NextResponse.json({ error: "Failed to upload attachment" }, { status: res.status });
    }
    const data = await res.json() as Array<{ id: string; filename: string; size?: number }>;
    const id = data[0]?.id;
    const size = data[0]?.size;
    if (typeof size === "number" && size !== file.size) {
      return NextResponse.json({ error: `Jira stored ${size} of ${file.size} bytes — please retry` }, { status: 502 });
    }
    const filename = data[0]?.filename ?? name;
    const url = id ? `${base.replace(/\/$/, "")}/secure/attachment/${id}/${encodeURIComponent(filename)}` : undefined;
    // Jira's media id is what lets a description show the image inline
    let mediaId: string | undefined;
    if (id) {
      try {
        const r = await fetch(`${base}/rest/api/3/attachment/content/${id}`, { headers: { Authorization: `Basic ${auth}` }, redirect: "manual" });
        const loc = r.headers.get("location") ?? "";
        mediaId = loc.match(/\/file\/([0-9a-f-]{36})/i)?.[1];
      } catch { /* inline image is optional */ }
    }
    return NextResponse.json({ id, filename, url, mediaId, size: size ?? file.size });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect to Jira" },
      { status: 500 },
    );
  }
}

/** Media ids for existing attachments: GET ?ids=1,2 → { media: { "1": "uuid" } } */
export async function GET(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  // Full-size picture shown inline instead of downloaded: GET ?view=12345
  const view = req.nextUrl.searchParams.get("view");
  if (view) {
    if (!/^\d+$/.test(view)) return NextResponse.json({ error: "Invalid attachment id" }, { status: 400 });
    try {
      const r = await fetch(`${env.base}/rest/api/3/attachment/content/${view}`, { headers: env.headers });
      if (!r.ok) return new NextResponse(null, { status: 404 });
      const type = r.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) return new NextResponse(null, { status: 415 });
      return new NextResponse(await r.arrayBuffer(), { headers: { "Content-Type": type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" } });
    } catch { return new NextResponse(null, { status: 502 }); }
  }
  // Preview picture of an existing attachment: GET ?thumb=12345
  const thumb = req.nextUrl.searchParams.get("thumb");
  if (thumb) {
    if (!/^\d+$/.test(thumb)) return NextResponse.json({ error: "Invalid attachment id" }, { status: 400 });
    try {
      const r = await fetch(`${env.base}/rest/api/3/attachment/thumbnail/${thumb}?fallbackToDefault=false`, { headers: env.headers });
      if (!r.ok) return new NextResponse(null, { status: 404 });
      return new NextResponse(await r.arrayBuffer(), { headers: { "Content-Type": r.headers.get("content-type") ?? "image/png", "Cache-Control": "private, max-age=3600" } });
    } catch { return new NextResponse(null, { status: 502 }); }
  }
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 50);
  const media: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const r = await fetch(`${env.base}/rest/api/3/attachment/content/${id}`, { headers: env.headers, redirect: "manual" });
      const m = (r.headers.get("location") ?? "").match(/\/file\/([0-9a-f-]{36})/i)?.[1];
      if (m) media[id] = m;
    } catch { /* skip */ }
  }));
  return NextResponse.json({ media });
}

/** Remove an attachment: DELETE ?id=12345 */
export async function DELETE(req: NextRequest) {
  const env = jiraEnv();
  if (!env.ok) return env.res;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "Invalid attachment id" }, { status: 400 });
  try {
    const res = await fetch(`${env.base}/rest/api/3/attachment/${id}`, { method: "DELETE", headers: env.headers });
    if (!res.ok && res.status !== 404) return NextResponse.json({ error: await jiraError(res, "Failed to remove the attachment") }, { status: res.status });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to connect to Jira" }, { status: 502 });
  }
}
