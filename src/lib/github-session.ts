import { getToken } from "next-auth/jwt";
import { SESSION_MAX_AGE } from "@/auth";
import { ensureAuthSecret } from "@/lib/local-secret";

/** Returns the signed-in user's GitHub OAuth token from the encrypted session cookie, or null. */
export async function getGitHubAccessToken(req: Request): Promise<string | null> {
  const jwt = await getToken({
    req,
    secret: ensureAuthSecret(),
    secureCookie: new URL(req.url).protocol === "https:",
  });
  if (typeof jwt?.signedInAt !== "number" || Date.now() - jwt.signedInAt > SESSION_MAX_AGE * 1000) return null;
  return typeof jwt.accessToken === "string" ? jwt.accessToken : null;
}

/** Stable id of the signed-in GitHub user (from the session cookie), or null. */
export async function getSessionUserId(req: Request): Promise<string | null> {
  const jwt = await getToken({ req, secret: ensureAuthSecret(), secureCookie: new URL(req.url).protocol === "https:" });
  if (typeof jwt?.signedInAt !== "number" || Date.now() - jwt.signedInAt > SESSION_MAX_AGE * 1000) return null;
  return typeof jwt.sub === "string" ? jwt.sub : null;
}

export const NOT_SIGNED_IN = { error: "Sign in with GitHub to use StoryAnalyzer." } as const;
