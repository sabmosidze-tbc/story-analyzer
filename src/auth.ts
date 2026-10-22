import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const PUBLIC_PATHS = ["/login", "/api/auth"];
export const SESSION_MAX_AGE = 8 * 60 * 60; // seconds

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID!,
      clientSecret: process.env.AUTH_GITHUB_SECRET!,
      // select_account makes GitHub ask which account to use on every sign-in
      // (GitHub doesn't let apps force a password re-entry).
      authorization: { params: { scope: "read:user", prompt: "select_account" } },
    }),
  ],
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
    async jwt({ token, account }) {
      // Keep the GitHub OAuth token server-side only (inside the encrypted session cookie).
      if (account?.access_token) {
        token.accessToken = account.access_token;
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
