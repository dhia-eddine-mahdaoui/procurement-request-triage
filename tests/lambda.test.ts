import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { APIGatewayProxyEventV2, S3Event } from "aws-lambda";
import { loadPolicy } from "../src/policy.js";
import { POLICY_FILE, SAMPLES_DIR } from "../src/paths.js";
import { RuleProvider } from "../src/provider.js";
import { TriageService } from "../src/service.js";
import { MemoryStore } from "../src/store.js";
import { seedSamples } from "../src/bootstrap.js";
import { ingestS3Event } from "../src/lambda/s3-ingest.js";
import { resolveDatabaseUrl } from "../src/lambda/runtime.js";

const holder: { service?: TriageService } = {};
vi.mock("../src/lambda/runtime.js", async (orig) => ({
  ...(await orig<typeof import("../src/lambda/runtime.js")>()),
  getRuntime: async () => ({ service: holder.service!, pool: undefined }),
}));

const { handler: apiHandler } = await import("../src/lambda/api.js");

const event = (method: string, path: string, body?: unknown, query?: Record<string, string>): APIGatewayProxyEventV2 =>
  ({
    version: "2.0",
    rawPath: path,
    queryStringParameters: query,
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, path } },
  }) as unknown as APIGatewayProxyEventV2;

let store: MemoryStore;
beforeEach(async () => {
  store = new MemoryStore();
  const policy = loadPolicy(POLICY_FILE);
  const provider = new RuleProvider();
  await seedSamples({ store, policy, provider });
  holder.service = new TriageService({ store, policy, provider });
});

describe("API Gateway handler", () => {
  it("serves the same routes as the Node server", async () => {
    const list = (await apiHandler(event("GET", "/api/requests", undefined, { route: "finance" }))) as { statusCode: number; body: string };
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body)).toHaveLength(2);
  });

  it("applies decisions and returns binary documents base64-encoded", async () => {
    const res = (await apiHandler(
      event("POST", "/api/requests/req-02-kestrel-renewal/decision", { decision: "approve", reviewer: "Ana", comment: "ok" }),
    )) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const pdf = (await apiHandler(event("GET", "/api/requests/req-02-kestrel-renewal/document"))) as {
      isBase64Encoded: boolean;
      headers: Record<string, string>;
      body: string;
    };
    expect(pdf.isBase64Encoded).toBe(true);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(pdf.body, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("decodes base64 request bodies", async () => {
    const e = event("POST", "/api/requests/req-02-kestrel-renewal/decision");
    e.body = Buffer.from(JSON.stringify({ decision: "approve", reviewer: "Ana" })).toString("base64");
    e.isBase64Encoded = true;
    expect(((await apiHandler(e)) as { statusCode: number }).statusCode).toBe(200);
  });
});

function s3Event(key: string, etag = "etag1"): S3Event {
  return { Records: [{ s3: { bucket: { name: "docs" }, object: { key, eTag: etag } } }] } as unknown as S3Event;
}

describe("S3 ingest handler", () => {
  const pdf = new Uint8Array(readFileSync(join(SAMPLES_DIR, "06-orbit-statement-of-work.pdf")));

  it("creates one pending request per uploaded PDF", async () => {
    const read = vi.fn(async () => pdf);
    const out = await ingestS3Event(s3Event("incoming/Orbit+Quote.pdf"), holder.service!, read);
    expect(read).toHaveBeenCalledWith("docs", "incoming/Orbit Quote.pdf");
    expect(out.created).toHaveLength(1);
    const req = await store.get(out.created[0]);
    expect(req).toMatchObject({ sourceName: "Orbit Quote.pdf", title: "Orbit Design Studio LLC", status: "pending" });
  });

  it("treats a duplicate delivery of the same object as already processed", async () => {
    const read = async () => pdf;
    const first = await ingestS3Event(s3Event("a.pdf"), holder.service!, read);
    const second = await ingestS3Event(s3Event("a.pdf"), holder.service!, read);
    expect(first.created).toHaveLength(1);
    expect(second).toEqual({ created: [], skipped: first.created });
    expect(await store.count()).toBe(9);
  });

  it("skips unreadable files but lets transient read errors fail the invocation for retry", async () => {
    const junk = await ingestS3Event(s3Event("junk.bin"), holder.service!, async () => new Uint8Array([0, 1, 2, 3]));
    expect(junk.created).toHaveLength(0);
    expect(junk.skipped).toHaveLength(1);
    await expect(ingestS3Event(s3Event("b.pdf"), holder.service!, async () => Promise.reject(new Error("throttled")))).rejects.toThrow("throttled");
  });
});

describe("database URL resolution", () => {
  it("prefers DATABASE_URL, then the named SSM parameter", async () => {
    const read = vi.fn(async (name: string) => `from:${name}`);
    expect(await resolveDatabaseUrl({ DATABASE_URL: "postgres://direct" }, read)).toBe("postgres://direct");
    expect(await resolveDatabaseUrl({ DATABASE_URL_PARAM: "/triage/db-url" }, read)).toBe("from:/triage/db-url");
    await expect(resolveDatabaseUrl({}, read)).rejects.toThrow(/DATABASE_URL/);
  });
});
