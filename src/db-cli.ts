import { createRuntime, migrate, seedSamples } from "./bootstrap.js";
import { loadEnvFile } from "./config.js";
import { databaseUrl } from "./config.js";
import { createPool } from "./pg-store.js";

/** `tsx src/db-cli.ts migrate|seed`: database housekeeping for local development. */
async function main(): Promise<void> {
  loadEnvFile();
  const cmd = process.argv[2];
  if (cmd === "migrate") {
    const url = databaseUrl();
    if (!url) throw new Error("No database configured (see .env.example)");
    const pool = createPool(url);
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Schema is up to date");
    await pool.end();
  } else if (cmd === "seed") {
    const rt = await createRuntime();
    console.log(`Added ${await seedSamples(rt)} sample requests (existing ones were kept)`);
    await rt.store.close();
  } else {
    throw new Error("Usage: db-cli.ts migrate|seed");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
