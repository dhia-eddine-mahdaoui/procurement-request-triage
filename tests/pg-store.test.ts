import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { loadEnvFile, databaseUrl } from "../src/config.js";
import { loadMigrations, migrate } from "../src/migrate.js";
import { PgStore } from "../src/pg-store.js";
import { storeContract } from "./store.contract.js";

// Runs against a real Postgres when one is configured (`npm run db:up`), otherwise it is skipped.
// Every test gets its own schema, so the development data is never touched.
loadEnvFile();
const url = process.env.TRIAGE_TEST_DATABASE_URL ?? databaseUrl();
const pools: pg.Pool[] = [];
const schemas: string[] = [];

async function freshStore(): Promise<PgStore> {
  const schema = `t_${randomBytes(5).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: url!, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  schemas.push(schema);
  const pool = new pg.Pool({ connectionString: url!, max: 5, options: `-c search_path=${schema}` });
  pools.push(pool);
  await migrate(pool);
  return new PgStore(pool);
}

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  if (!url) return;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  for (const s of schemas) await admin.query(`DROP SCHEMA ${s} CASCADE`);
  await admin.end();
});

storeContract("Postgres", freshStore, { skip: !url });

describe.skipIf(!url)("migrations", () => {
  it("apply once, record themselves and are idempotent", async () => {
    const store = await freshStore();
    void store;
    const pool = pools[pools.length - 1];
    expect(await migrate(pool)).toEqual([]);
    const { rows } = await pool.query("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((r: { name: string }) => r.name)).toEqual(loadMigrations().map((m) => m.name));
  });

  it("enforces constraints in the database", async () => {
    await freshStore();
    const pool = pools[pools.length - 1];
    await expect(
      pool.query("INSERT INTO requests (id, title, source_name, source_type, extractor, status, route, risk_level, policy_version, pages, terms) VALUES ('x','t','s','pdf','rules','bogus','legal','high','1','[]','{}')"),
    ).rejects.toThrow(/check constraint/);
  });
});
