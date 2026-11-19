import { CredentialsSignin } from "next-auth";

/**
 * Public ID of the team's GitHub OAuth App (not a secret — safe to commit).
 * The app must have "Enable Device Flow" ticked in its GitHub settings.
 */
export const GITHUB_CLIENT_ID = process.env.AUTH_GITHUB_ID || "Ov23liOJTSCbVMAY5oSa";
const SCOPE = "read:user";

export type DeviceStart = { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number };

/** Ask GitHub for a one-time code the user types on github.com/login/device. */
export async function startDeviceFlow(): Promise<DeviceStart> {
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: SCOPE }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof j.device_code !== "string") {
    const msg = j.error === "device_flow_disabled"
      ? "Device sign-in is turned off for the GitHub app. Its owner must tick \"Enable Device Flow\" in the app settings."
      : String(j.error_description ?? j.error ?? `GitHub returned ${res.status}`);
    throw new Error(msg);
  }
  return {
    deviceCode: j.device_code,
    userCode: String(j.user_code),
    verificationUri: String(j.verification_uri ?? "https://github.com/login/device"),
    interval: Number(j.interval) || 5,
    expiresIn: Number(j.expires_in) || 900,
  };
}

/** Thrown from authorize() so the browser can tell "keep waiting" from a real failure. */
export class DeviceSignin extends CredentialsSignin {
  constructor(code: "pending" | "slow_down" | "expired" | "denied" | "failed") {
    super();
    this.code = code;
  }
}

/** One poll: returns the GitHub user + token once the user has approved, otherwise throws DeviceSignin. */
export async function finishDeviceFlow(deviceCode: string) {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof j.access_token !== "string") {
    if (j.error === "authorization_pending") throw new DeviceSignin("pending");
    if (j.error === "slow_down") throw new DeviceSignin("slow_down");
    if (j.error === "expired_token") throw new DeviceSignin("expired");
    if (j.error === "access_denied") throw new DeviceSignin("denied");
    throw new DeviceSignin("failed");
  }
  const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${j.access_token}`, Accept: "application/vnd.github+json" } });
  if (!u.ok) throw new DeviceSignin("failed");
  const user = (await u.json()) as { id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string };
  return {
    id: String(user.id),
    name: user.name || user.login,
    email: user.email ?? null,
    image: user.avatar_url ?? null,
    accessToken: j.access_token,
  };
}
