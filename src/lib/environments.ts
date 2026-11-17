export const ENV_DEFAULTS = ["DEV", "TEST", "UAT", "PREPROD"];
const ENV_KEY = "story-analyzer:environments";

/** Each user keeps their own list of environments (saved in this browser). */
export function loadEnvs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ENV_KEY) ?? "null");
    if (Array.isArray(raw)) return raw.filter((e): e is string => typeof e === "string" && !!e.trim());
  } catch { /* fall back to defaults */ }
  return ENV_DEFAULTS;
}
export function saveEnvs(list: string[]) {
  try { localStorage.setItem(ENV_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}
