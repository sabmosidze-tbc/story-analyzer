import { NextRequest, NextResponse } from "next/server";
import { JiraError, type Jira } from "@/lib/atlassian-mcp";
import { ISSUE_KEY, attachmentUrl, getIssue, jiraFail, jiraFor } from "@/lib/jira-server";

// Keep in sync with experimental.proxyClientMaxBodySize in next.config.ts
const MAX_BYTES = 250 * 1024 * 1024;
const UUID = /\/file\/([0-9a-f-]{36})/i;

/** Signed Atlassian media URL for an attachment (fetchable server-side without extra auth). */
async function downloadUrl(jira: Jira, id: string): Promise<string | undefined> {
  const d = await jira.call<{ downloadUrl?: string }>("downloadJiraIssueAttachment", { attachmentId: id });
  return d.downloadUrl;
}
const mediaIdOf = (url?: string) => url?.match(UUID)?.[1];

/** The tool hands back a curl command for the upload; pull out its URL and headers. */
function parseCurl(cmd: string): { url: string; headers: Record<string, string> } | null {
  const url = cmd.match(/https:\/\/[^\s'"]+/)?.[0];
  if (!url || !/^https:\/\/api\.media\.atlassian\.com\//.test(url)) return null;
  const headers: Record<string, string> = {};
  for (const m of cmd.matchAll(/(?:-H|--header)\s+(['"])(.*?)\1/g)) {
    const i = m[2].indexOf(":");
    if (i > 0) headers[m[2].slice(0, i).trim()] = m[2].slice(i + 1).trim();
  }
  return { url, headers };
}

/** Upload a file as an attachment on a Jira issue. Expects multipart form: key, file, size. */
export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400 }); }

  const key = String(form.get("key") ?? "");
  const file = form.get("file");
  if (!ISSUE_KEY.test(key)) return NextResponse.json({ error: "Invalid Jira key" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 250 MB" }, { status: 413 });
  // The browser sends the real size; a mismatch means the upload was cut short on the way
  const expected = Number(form.get("size") ?? NaN);
  if (Number.isFinite(expected) && expected !== file.size) {
    return NextResponse.json({ error: "File arrived incomplete — please retry" }, { status: 422 });
  }
  const name = file.name.replace(/[\\/:*?"<>|]/g, "").slice(0, 120) || "attachment";

  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  try {
    const before = new Set((await getIssue(jira, key, ["attachment"])).fields.attachment?.map((a) => a.id) ?? []);

    // Phase 1: get a signed upload request, then send the bytes to Atlassian media
    const p1 = await jira.call<{ uploadCommand?: string }>("uploadAttachmentToJiraIssue", { issueIdOrKey: key, filePath: `./${name}` });
    const up = p1.uploadCommand ? parseCurl(p1.uploadCommand) : null;
    if (!up) return NextResponse.json({ error: "Jira didn't return an upload address" }, { status: 502 });
    const res = await fetch(up.url, {
      method: "POST",
      headers: { ...up.headers, "Content-Type": file.type || "application/octet-stream" },
      body: Buffer.from(await file.arrayBuffer()),
    });
    if (!res.ok) return NextResponse.json({ error: `Upload to Jira failed (${res.status})` }, { status: 502 });
    const fileId = ((await res.json()) as { data?: { id?: string } }).data?.id;
    if (!fileId) return NextResponse.json({ error: "Jira didn't confirm the upload" }, { status: 502 });

    // Phase 2: attach the uploaded file to the issue
    await jira.call("uploadAttachmentToJiraIssue", { issueIdOrKey: key, fileId });

    const after = (await getIssue(jira, key, ["attachment"])).fields.attachment ?? [];
    const fresh = after.filter((a) => !before.has(a.id));
    const att = fresh.find((a) => a.filename === name) ?? fresh[fresh.length - 1];
    if (!att) return NextResponse.json({ error: "Jira didn't show the new attachment — please retry" }, { status: 502 });
    if (typeof att.size === "number" && att.size !== file.size) {
      return NextResponse.json({ error: `Jira stored ${att.size} of ${file.size} bytes — please retry` }, { status: 502 });
    }
    // Jira's media id is what lets a description show the image inline
    let mediaId: string | undefined;
    try { mediaId = mediaIdOf(await downloadUrl(jira, att.id)); } catch { /* inline image is optional */ }
    return NextResponse.json({ id: att.id, filename: att.filename, url: attachmentUrl(jira, att.id, att.filename), mediaId, size: att.size ?? file.size });
  } catch (e) {
    if (e instanceof JiraError && e.status === 404) return NextResponse.json({ error: `Issue ${key} not found` }, { status: 404 });
    if (e instanceof JiraError && e.status === 403) return NextResponse.json({ error: "No permission to add attachments" }, { status: 403 });
    return jiraFail(e, "Failed to upload attachment");
  }
}

/** ?view=ID full image · ?thumb=ID preview · ?ids=1,2 → { media: { "1": "uuid" } } */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const r = await jiraFor(req);
  if (!r.ok) return r.res;
  const { jira } = r;

  const view = q.get("view");
  const thumb = q.get("thumb");
  const one = view ?? thumb;
  if (one !== null) {
    if (!/^\d+$/.test(one)) return NextResponse.json({ error: "Invalid attachment id" }, { status: 400 });
    try {
      const src = await downloadUrl(jira, one);
      if (!src) return new NextResponse(null, { status: 404 });
      const u = new URL(src);
      if (thumb) {
        u.pathname = u.pathname.replace(/\/binary$/, "/image");
        u.searchParams.set("width", "320");
        u.searchParams.set("height", "320");
        u.searchParams.set("mode", "fit");
        u.searchParams.delete("dl");
      }
      const res = await fetch(u);
      if (!res.ok) return new NextResponse(null, { status: 404 });
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) return new NextResponse(null, { status: 415 });
      return new NextResponse(await res.arrayBuffer(), {
        headers: { "Content-Type": type, "Content-Disposition": "inline", "Cache-Control": "private, max-age=3600" },
      });
    } catch { return new NextResponse(null, { status: 502 }); }
  }

  const ids = (q.get("ids") ?? "").split(",").filter((x) => /^\d+$/.test(x)).slice(0, 50);
  const media: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const m = mediaIdOf(await downloadUrl(jira, id));
      if (m) media[id] = m;
    } catch { /* skip */ }
  }));
  return NextResponse.json({ media });
}

/** The Atlassian connector has no way to delete attachments. */
export async function DELETE() {
  return NextResponse.json({ error: "Attachments can't be removed from here — delete the file in Jira if needed." }, { status: 501 });
}
