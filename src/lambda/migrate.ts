import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations, migrate } from "../migrate.js";
import { getRuntime } from "./runtime.js";

/** Applies pending SQL migrations. The SQL files are packaged next to the bundle; invoke once per deploy. */
export async function handler(): Promise<{ applied: string[] }> {
  const { pool } = await getRuntime();
  const dir = process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "migrations");
  return { applied: await migrate(pool, loadMigrations(dir)) };
}
