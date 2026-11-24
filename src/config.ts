import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./paths.js";

/** Minimal .env loader (Node 18 has no --env-file). Existing environment variables win. */
export function loadEnvFile(file = join(ROOT, ".env"), env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}

/** DATABASE_URL, or one assembled from the DB_* variables written by `npm run env:init`. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { DB_USER: user, DB_CREDENTIAL: cred, DB_NAME: name, DB_HOST_PORT: port } = env;
  if (!user || !cred || !name || !port) return null;
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(cred)}@localhost:${port}/${name}`;
}
