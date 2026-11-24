import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const POLICY_FILE = join(ROOT, "policy", "policy.json");
export const SAMPLES_DIR = join(ROOT, "data", "samples");
export const WEB_DIST = join(ROOT, "web", "dist");
export const DEFAULT_STORE_FILE = join(ROOT, "data", "store.json");
