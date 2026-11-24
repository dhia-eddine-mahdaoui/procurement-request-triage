import { databaseUrl } from "./config.js";
import { buildRequest, loadSampleDocuments } from "./ingest.js";
import { migrate } from "./migrate.js";
import { loadPolicy } from "./policy.js";
import { createPool, PgStore } from "./pg-store.js";
import { POLICY_FILE, SAMPLES_DIR } from "./paths.js";
import { createProvider, type ExtractionProvider } from "./provider.js";
import { TriageService } from "./service.js";
import { MemoryStore, type Store } from "./store.js";
import type { Policy } from "./types.js";

export interface Runtime {
  store: Store;
  service: TriageService;
  policy: Policy;
  provider: ExtractionProvider;
  storeKind: "postgres" | "memory";
}

/** Postgres when a database is configured, otherwise (or with TRIAGE_STORE=memory) an in-memory demo store. */
export async function createRuntime(env: NodeJS.ProcessEnv = process.env): Promise<Runtime> {
  const provider = createProvider(env);
  const policy = loadPolicy(POLICY_FILE);
  const url = env.TRIAGE_STORE === "memory" ? null : databaseUrl(env);
  if (env.TRIAGE_STORE !== "memory" && !url) {
    throw new Error("No database configured. Run `npm run env:init && npm run db:up && npm run db:migrate`, or set TRIAGE_STORE=memory.");
  }
  let store: Store;
  if (url) {
    const pool = createPool(url);
    store = new PgStore(pool);
  } else {
    store = new MemoryStore();
  }
  return { store, policy, provider, service: new TriageService({ store, policy, provider }), storeKind: url ? "postgres" : "memory" };
}

export { migrate };

/** Inserts the bundled sample PDFs that are not stored yet. Returns how many were added. */
export async function seedSamples(rt: Pick<Runtime, "store" | "policy" | "provider">): Promise<number> {
  let added = 0;
  for (const doc of loadSampleDocuments(SAMPLES_DIR)) {
    const built = await buildRequest(doc, rt.provider, rt.policy);
    if (await rt.store.insert(built.request, built.document)) added++;
  }
  return added;
}
