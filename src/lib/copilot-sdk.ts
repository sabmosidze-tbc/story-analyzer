/**
 * Server-only access to GitHub Copilot models through the official Copilot SDK.
 *
 * Every request runs as the signed-in user: their GitHub OAuth token (from the
 * NextAuth session) is handed to a per-user Copilot client, so models, policies and
 * usage come from that user's own Copilot subscription.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { CopilotClient, type ModelInfo } from "@github/copilot-sdk";

export const DEFAULT_COPILOT_MODEL = process.env.COPILOT_MODEL?.trim() || "claude-sonnet-5.5";

const MODELS_TTL_MS = 10 * 60 * 1000;
const CLIENT_IDLE_MS = 30 * 60 * 1000;
const MAX_CLIENTS = 20;

interface UserClient {
  client: Promise<CopilotClient>;
  lastUsed: number;
  models?: { at: number; models: ModelInfo[] };
}

const g = globalThis as typeof globalThis & {
  __storyAnalyzerCopilotClients?: Map<string, UserClient>;
};
const clients = (g.__storyAnalyzerCopilotClients ??= new Map());

// Never let the runtime fall back to ambient credentials (the app's GITHUB_TOKEN PAT,
// gh CLI login, etc.) — only the signed-in user's token may be used.
function runtimeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !["GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN"].includes(k)) env[k] = v;
  }
  return env;
}

function stopEntry(key: string, entry: UserClient) {
  clients.delete(key);
  entry.client.then((c) => c.stop()).catch(() => {});
}

function evictClients() {
  const now = Date.now();
  for (const [key, entry] of clients) {
    if (now - entry.lastUsed > CLIENT_IDLE_MS) stopEntry(key, entry);
  }
  while (clients.size >= MAX_CLIENTS) {
    const [oldestKey, oldest] = [...clients.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    stopEntry(oldestKey, oldest);
  }
}

function getUserClient(token: string): UserClient {
  if (!token) throw new Error("Not signed in to GitHub.");
  const key = crypto.createHash("sha256").update(token).digest("hex");
  let entry = clients.get(key);
  if (!entry) {
    evictClients();
    const client = new CopilotClient({ gitHubToken: token, useLoggedInUser: false, logLevel: "error", env: runtimeEnv() });
    const created: UserClient = {
      lastUsed: Date.now(),
      client: client.start().then(
        () => client,
        (err) => {
          clients.delete(key);
          throw err;
        }
      ),
    };
    clients.set(key, created);
    entry = created;
  }
  entry.lastUsed = Date.now();
  return entry;
}

// Empty scratch dir so sessions never pick up repo instruction files (AGENTS.md etc.)
function scratchDir(): string {
  const dir = path.join(os.tmpdir(), "story-analyzer-copilot");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function listCopilotModels(token: string): Promise<ModelInfo[]> {
  const entry = getUserClient(token);
  if (entry.models && Date.now() - entry.models.at < MODELS_TTL_MS) return entry.models.models;
  const client = await entry.client;
  const models = (await client.listModels()).filter((m) => m.policy?.state !== "disabled");
  entry.models = { at: Date.now(), models };
  return models;
}

/** Maps a requested model ("copilot/<id>" or a legacy id) to a model available to this user. */
export async function resolveCopilotModel(token: string, requested?: string): Promise<string> {
  const wanted = requested?.startsWith("copilot/") ? requested.slice("copilot/".length) : undefined;
  try {
    const ids = (await listCopilotModels(token)).map((m) => m.id);
    if (wanted && ids.includes(wanted)) return wanted;
    if (ids.includes(DEFAULT_COPILOT_MODEL)) return DEFAULT_COPILOT_MODEL;
    return ids.includes("auto") ? "auto" : ids[0] ?? DEFAULT_COPILOT_MODEL;
  } catch {
    return wanted ?? DEFAULT_COPILOT_MODEL;
  }
}

export function describeCopilotError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not signed in/i.test(msg)) {
    return "You are not signed in. Sign in with GitHub to use Copilot models.";
  }
  if (/no copilot|copilot (is not|not) (enabled|available)|subscription|403|forbidden/i.test(msg)) {
    return `Your GitHub account doesn't have access to Copilot (${msg}). Make sure Copilot is enabled for this account.`;
  }
  if (/401|unauthori[sz]ed|bad credentials|authenticat/i.test(msg)) {
    return "GitHub rejected your sign-in token. Sign out and sign in with GitHub again.";
  }
  return msg;
}

interface RunCopilotOptions {
  token: string;
  model: string;
  system: string;
  user: string;
  onDelta?: (text: string) => void;
  timeoutMs?: number;
}

/** Runs a single prompt (no tools) and returns the full response text, streaming deltas via onDelta. */
export async function runCopilot({ token, model, system, user, onDelta, timeoutMs = 5 * 60 * 1000 }: RunCopilotOptions): Promise<string> {
  const client = await getUserClient(token).client;
  const session = await client.createSession({
    model,
    streaming: true,
    systemMessage: { mode: "replace", content: system },
    availableTools: [],
    infiniteSessions: { enabled: false },
    enableSessionStore: false,
    workingDirectory: scratchDir(),
  });

  let streamed = "";
  let sessionError: string | null = null;
  const offDelta = session.on("assistant.message_delta", (evt) => {
    const text = evt.data.deltaContent;
    if (!text) return;
    streamed += text;
    onDelta?.(text);
  });
  const offError = session.on("session.error", (evt) => {
    sessionError = evt.data.message;
  });

  try {
    const final = await session.sendAndWait({ prompt: user }, timeoutMs);
    if (sessionError) throw new Error(sessionError);
    const content = final?.data?.content ?? streamed;
    // Some models only emit the final message — forward it so callers still get output
    if (!streamed && content) onDelta?.(content);
    return content;
  } finally {
    offDelta();
    offError();
    await session.disconnect().catch(() => {});
    await client.deleteSession(session.sessionId).catch(() => {});
  }
}
