import { getToken } from "next-auth/jwt";
import { SESSION_MAX_AGE } from "@/auth";

/** Returns the signed-in user's GitHub OAuth token from the encrypted session cookie, or null. */
export async function getGitHubAccessToken(req: Request): Promise<string | null> {
  const jwt = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: new URL(req.url).protocol === "https:",
  });
  if (typeof jwt?.signedInAt !== "number" || Date.now() - jwt.signedInAt > SESSION_MAX_AGE * 1000) return null;
  return typeof jwt.accessToken === "string" ? jwt.accessToken : null;
}

export const NOT_SIGNED_IN = { error: "Sign in with GitHub to use StoryAnalyzer." } as const;
