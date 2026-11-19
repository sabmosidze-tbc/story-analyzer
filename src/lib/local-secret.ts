import fs from "fs";
import path from "path";
import crypto from "crypto";

export const DATA_DIR = path.join(process.cwd(), ".data");

/** Use AUTH_SECRET from the environment, or create one on first start and keep it in .data/ (git-ignored). */
export function ensureAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const file = path.join(DATA_DIR, "auth-secret");
  let secret = "";
  try { secret = fs.readFileSync(file, "utf8").trim(); } catch { /* first start */ }
  if (!secret) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { flag: "wx", mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    // Re-read so parallel first starts all agree on whichever write won
    secret = fs.readFileSync(file, "utf8").trim();
  }
  process.env.AUTH_SECRET = secret;
  return secret;
}
