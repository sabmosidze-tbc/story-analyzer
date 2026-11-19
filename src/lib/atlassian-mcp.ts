import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { DATA_DIR } from "@/lib/local-secret";
import { getSessionUserId } from "@/lib/github-session";

export const MCP_URL = "https://mcp.atlassian.com/v2/mcp?tools=all";
export const CALLBACK_PATH = "/api/atlassian/callback";

// ── Local store (.data/ is git-ignored) ──────────────────────────────────────
// clients: one dynamic registration per app address (port), used only to sign in
// users:   each GitHub user's own Atlassian sign-in, shared by every port. `client` is the
//          registration that issued the tokens, so refreshing works from any port.
type Site = { cloudId: string; url: string; name?: string };
type UserRec = { tokens?: OAuthTokens; verifier?: string; site?: Site; client?: OAuthClientInformationMixed };
type Store = { clients: Record<string, OAuthClientInformationMixed>; users: Record<string, UserRec> };

const FILE = path.join(DATA_DIR, "atlassian.json");
let writing: Promise<unknown> = Promise.resolve();

/** Older stores kept sign-ins per `userId@origin`; fold them into one per user. */
function migrate(s: Store): Store {
  for (const [k, rec] of Object.entries(s.users)) {
    const at = k.indexOf("@http");
    if (at < 0) continue;
    const userId = k.slice(0, at);
    const origin = k.slice(at + 1);
    if (rec.tokens && !s.users[userId]?.tokens) s.users[userId] = { ...rec, client: rec.client ?? s.clients[origin] };
    delete s.users[k];
  }
  return s;
}

async function readStore(): Promise<Store> {
  try {
    const s = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<Store>;
    return migrate({ clients: s.clients ?? {}, users: s.users ?? {} });
  } catch { return { clients: {}, users: {} }; }
}
function update(fn: (s: Store) => void): Promise<void> {
  const next = writing.then(async () => {
    const s = await readStore();
    fn(s);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
  });
  writing = next.catch(() => {});
  return next;
}

export class AtlassianProvider implements OAuthClientProvider {
  authUrl: URL | null = null;
  constructor(private origin: string, private userId: string) {}
  private get key() { return this.userId; }

  get redirectUrl() { return `${this.origin}${CALLBACK_PATH}`; }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "StoryAnalyzer",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  async clientInformation() {
    const s = await readStore();
    const u = s.users[this.key];
    return u?.tokens && u.client ? u.client : s.clients[this.origin];
  }
  async saveClientInformation(c: OAuthClientInformationMixed) { await update((s) => { s.clients[this.origin] = c; }); }
  async tokens() { return (await readStore()).users[this.key]?.tokens; }
  async saveTokens(t: OAuthTokens) {
    await update((s) => {
      const u = s.users[this.key];
      const client = u?.tokens && u.client ? u.client : s.clients[this.origin];
      s.users[this.key] = { ...u, tokens: t, client };
    });
  }
  async saveCodeVerifier(v: string) { await update((s) => { s.users[this.key] = { ...s.users[this.key], verifier: v }; }); }
  async codeVerifier() { return (await readStore()).users[this.key]?.verifier ?? ""; }
  async redirectToAuthorization(url: URL) { this.authUrl = url; }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    await update((s) => {
      const u = s.users[this.key];
      if (scope === "all" || scope === "client") {
        // Forget whichever registration clientInformation() handed out
        if (u?.tokens && u.client) s.users[this.key] = { ...u, client: undefined, tokens: undefined, site: undefined };
        else delete s.clients[this.origin];
      }
      if (scope === "all" || scope === "tokens") s.users[this.key] = { ...s.users[this.key], tokens: undefined, site: undefined, client: undefined };
      if (scope === "all" || scope === "verifier") s.users[this.key] = { ...s.users[this.key], verifier: undefined };
    });
    dropClient(this.key);
  }
}

export const newTransport = (provider: AtlassianProvider) => new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider });

export async function disconnect(userId: string) {
  await update((s) => { delete s.users[userId]; });
  dropClient(userId);
}

export async function isConnected(userId: string): Promise<Site | false> {
  const u = (await readStore()).users[userId];
  return u?.tokens ? u.site ?? { cloudId: "", url: "" } : false;
}

// ── Connection cache ─────────────────────────────────────────────────────────
const g = globalThis as typeof globalThis & { __atlassianMcp?: Map<string, Promise<Client>> };
const clients: Map<string, Promise<Client>> = (g.__atlassianMcp ??= new Map());
function dropClient(key: string) {
  const c = clients.get(key);
  clients.delete(key);
  c?.then((x) => x.close()).catch(() => {});
}
async function getClient(provider: AtlassianProvider, key: string): Promise<Client> {
  let c = clients.get(key);
  if (!c) {
    c = (async () => {
      const client = new Client({ name: "story-analyzer", version: "1.0.0" });
      await client.connect(newTransport(provider));
      return client;
    })();
    clients.set(key, c);
    c.catch(() => { if (clients.get(key) === c) clients.delete(key); });
  }
  return c;
}

// ── Jira calls ───────────────────────────────────────────────────────────────
export class JiraError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}
export const NOT_CONNECTED = { error: "Connect Jira first (click \"Connect Jira\" at the bottom of the sidebar).", needsAtlassian: true } as const;

export type Jira = {
  site: Site;
  browse: (key: string) => string;
  /** Call a Jira MCP tool; cloudId is filled in. Returns the tool's `data` payload. */
  call: <T = Record<string, unknown>>(tool: string, args?: Record<string, unknown>) => Promise<T>;
};

function statusFromText(msg: string): number {
  if (/\b404\b|not found|does not exist|no issue/i.test(msg)) return 404;
  if (/\b403\b|permission|not allowed|forbidden/i.test(msg)) return 403;
  if (/\b401\b|unauthori[sz]ed/i.test(msg)) return 401;
  if (/\b400\b|invalid|required|bad request/i.test(msg)) return 400;
  return 502;
}

/** Readable message from an MCP error payload (JSON or text). */
function errorText(raw: string): string {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const e = (j.error ?? j) as Record<string, unknown> | string;
    if (typeof e === "string") return e;
    const pick = e.message ?? e.errorMessage ?? (e.errorMessages as string[] | undefined)?.[0] ?? e.repairHint;
    if (typeof pick === "string") return pick;
    const fields = e.errors && typeof e.errors === "object" ? Object.entries(e.errors as Record<string, string>).map(([k, v]) => `${k}: ${v}`)[0] : undefined;
    return fields ?? raw.slice(0, 300);
  } catch { return raw.slice(0, 300); }
}

async function rawCall(client: Client, tool: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name: tool, arguments: args });
  const text = (r.content as { type: string; text?: string }[] | undefined)?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
  if (r.isError) {
    const msg = errorText(text) || `${tool} failed`;
    throw new JiraError(msg, statusFromText(msg));
  }
  let parsed: unknown = r.structuredContent;
  if (parsed === undefined) {
    try { parsed = JSON.parse(text); } catch { parsed = { text }; }
  }
  const p = parsed as { data?: unknown; error?: unknown };
  if (p && typeof p === "object" && p.error && !p.data) {
    const msg = typeof p.error === "string" ? p.error : errorText(JSON.stringify(p.error));
    throw new JiraError(msg, statusFromText(msg));
  }
  return (p && typeof p === "object" && "data" in p ? p.data : parsed) as Record<string, unknown>;
}

async function resolveSite(client: Client, key: string): Promise<Site> {
  const saved = (await readStore()).users[key]?.site;
  if (saved?.cloudId) return saved;
  const data = await rawCall(client, "getAccessibleAtlassianResources", {});
  const list = ((data.resources ?? data) as { cloudId?: string; id?: string; url: string; name?: string; products?: { id: string }[] }[]) ?? [];
  const jira = list.filter((r) => !r.products || r.products.some((p) => p.id === "jira"));
  const prefer = process.env.JIRA_BASE_URL?.replace(/\/$/, "");
  const pick = jira.find((r) => prefer && r.url === prefer) ?? jira[0];
  if (!pick) throw new JiraError("Your Atlassian account has no Jira site.", 403);
  const site: Site = { cloudId: pick.cloudId ?? pick.id ?? "", url: pick.url.replace(/\/$/, ""), name: pick.name };
  await update((s) => { s.users[key] = { ...s.users[key], site }; });
  return site;
}

/** The signed-in user's Jira connection, or a ready-made error response. */
export async function jiraFor(req: Request): Promise<{ ok: true; jira: Jira } | { ok: false; res: NextResponse }> {
  const userId = await getSessionUserId(req);
  if (!userId) return { ok: false, res: NextResponse.json({ error: "Sign in with GitHub to use StoryAnalyzer." }, { status: 401 }) };
  const origin = new URL(req.url).origin;
  const key = userId;
  if (!(await readStore()).users[key]?.tokens) return { ok: false, res: NextResponse.json(NOT_CONNECTED, { status: 401 }) };
  const provider = new AtlassianProvider(origin, userId);

  const withClient = async <T>(fn: (c: Client) => Promise<T>): Promise<T> => {
    try {
      return await fn(await getClient(provider, key));
    } catch (e) {
      if (e instanceof JiraError) throw e;
      // Stale session / dropped connection: reconnect once
      dropClient(key);
      return fn(await getClient(provider, key));
    }
  };

  try {
    const site = await withClient((c) => resolveSite(c, key));
    const jira: Jira = {
      site,
      browse: (k) => `${site.url}/browse/${k}`,
      call: (tool, args = {}) => withClient((c) => rawCall(c, tool, { cloudId: site.cloudId, ...args })) as never,
    };
    return { ok: true, jira };
  } catch (e) {
    return { ok: false, res: jiraFail(e, "Couldn't reach Jira") };
  }
}

/** Turn any error from a Jira call into a JSON response. */
export function jiraFail(e: unknown, fallback: string): NextResponse {
  if (e instanceof UnauthorizedError || (e instanceof Error && /unauthori[sz]ed|invalid_grant|invalid_token/i.test(e.message) && !(e instanceof JiraError))) {
    return NextResponse.json(NOT_CONNECTED, { status: 401 });
  }
  if (e instanceof JiraError) return NextResponse.json({ error: e.message || fallback }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error && e.message ? e.message : fallback }, { status: 502 });
}
