import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { auth, signIn, HAS_GITHUB_WEB_LOGIN } from "@/auth";
import DeviceLogin from "@/components/DeviceLogin";
import ErrorNotice from "@/components/ErrorNotice";

export const metadata = { title: "Sign in – StoryAnalyzer" };

function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = safeRedirect(callbackUrl?.replace(/^https?:\/\/[^/]+/, ""));

  if ((await auth())?.user) redirect(redirectTo);

  return (
    <main className="flex-1 flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-900">
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-white">StoryAnalyzer</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Sign in with GitHub to continue. AI analysis runs on your own GitHub Copilot account.
        </p>

        {error && <ErrorNotice message={`Sign-in failed (${error}). Please try again.`} className="mt-4 text-left" />}

        {HAS_GITHUB_WEB_LOGIN ? (
          <form
            className="mt-6"
            action={async () => {
              "use server";
              await signIn("github", { redirectTo });
            }}
          >
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </button>
          </form>
        ) : (
          <DeviceLogin redirectTo={redirectTo} />
        )}
      </div>
    </main>
  );
}
