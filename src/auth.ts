import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import { ensureAuthSecret } from "@/lib/local-secret";
import { GITHUB_CLIENT_ID, finishDeviceFlow, DeviceSignin } from "@/lib/github-device";

const PUBLIC_PATHS = ["/login", "/api/auth", "/api/login"];
export const SESSION_MAX_AGE = 8 * 60 * 60; // seconds

const secret = ensureAuthSecret();

/** True when the classic "redirect to GitHub" sign-in is set up (needs the app's client secret). */
export const HAS_GITHUB_WEB_LOGIN = !!(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);

const providers: Provider[] = [
  // Sign-in with a one-time code (GitHub device flow): needs only the public client ID, no secret.
  Credentials({
    id: "github-device",
    name: "GitHub (device code)",
    credentials: { deviceCode: {} },
    async authorize(c) {
      const deviceCode = typeof c?.deviceCode === "string" ? c.deviceCode : "";
      if (!deviceCode) throw new DeviceSignin("failed");
      return finishDeviceFlow(deviceCode);
    },
  }),
];
if (HAS_GITHUB_WEB_LOGIN) {
  providers.push(GitHub({
    clientId: GITHUB_CLIENT_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET!,
    // select_account makes GitHub ask which account to use on every sign-in
    // (GitHub doesn't let apps force a password re-entry).
    authorization: { params: { scope: "read:user", prompt: "select_account" } },
  }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret,
  providers,
  pages: { signIn: "/login" },
  // App login lasts 8 hours (a working day), then GitHub sign-in is required again.
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  callbacks: {
    authorized({ auth: session, request }) {
      const { pathname } = request.nextUrl;
      if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
      if (session?.user) return true;
      if (pathname.startsWith("/api/")) {
        return Response.json({ error: "Sign in with GitHub to use StoryAnalyzer." }, { status: 401 });
      }
      return false; // redirects to /login
    },
    async jwt({ token, account, user }) {
      // Keep the GitHub OAuth token server-side only (inside the encrypted session cookie).
      const fresh = account?.access_token ?? (user as { accessToken?: string } | undefined)?.accessToken;
      if (fresh) {
        token.accessToken = fresh;
        token.signedInAt = Date.now();
      }
      // Hard limit: sign-in expires SESSION_MAX_AGE after login, even if the app is in use.
      if (typeof token.signedInAt !== "number" || Date.now() - token.signedInAt > SESSION_MAX_AGE * 1000) {
        return null;
      }
      return token;
    },
    async session({ session }) {
      return session;
    },
  },
  trustHost: true,
});
