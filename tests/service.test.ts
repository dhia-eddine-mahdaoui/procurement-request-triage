import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "../src/policy.js";
import { POLICY_FILE, SAMPLES_DIR } from "../src/paths.js";
import { RuleProvider } from "../src/provider.js";
import { route, type ApiResponse } from "../src/router.js";
import { TriageService } from "../src/service.js";
import { MemoryStore } from "../src/store.js";
import { seedSamples } from "../src/bootstrap.js";

let service: TriageService;
let store: MemoryStore;

beforeEach(async () => {
  store = new MemoryStore();
  const policy = loadPolicy(POLICY_FILE);
  const provider = new RuleProvider();
  await seedSamples({ store, policy, provider });
  service = new TriageService({ store, policy, provider });
});

const call = (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<ApiResponse> =>
  route(service, { method, path, query, body: body === undefined ? null : JSON.stringify(body) });
const data = (r: ApiResponse) => JSON.parse(r.body);

describe("API router over the service", () => {
  it("lists and filters requests", async () => {
    const all = data(await call("GET", "/api/requests"));
    expect(all).toHaveLength(8);
    expect(all[0].pages).toBeUndefined();
    const legal = data(await call("GET", "/api/requests", undefined, { route: "legal" }));
    expect(legal).toHaveLength(4);
    const q = data(await call("GET", "/api/requests", undefined, { q: "kestrel", status: "pending" }));
    expect(q.map((r: { title: string }) => r.title)).toEqual(["Kestrel Metrics Inc."]);
    expect((await call("GET", "/api/requests", undefined, { route: "nope" })).status).toBe(400);
  });

  it("returns the detail with pages for highlighting and serves the original PDF", async () => {
    const detail = data(await call("GET", "/api/requests/req-02-kestrel-renewal"));
    expect(detail.request.pages.length).toBeGreaterThan(0);
    expect(detail.request.terms.noticeDays.page).toBeGreaterThan(0);
    const doc = await call("GET", "/api/requests/req-02-kestrel-renewal/document");
    expect(doc.headers["content-type"]).toBe("application/pdf");
    expect(doc.isBase64).toBe(true);
    expect(Buffer.from(doc.body, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect((await call("GET", "/api/requests/nope")).status).toBe(404);
  });

  it("creates a request from an uploaded PDF (base64) and from pasted text", async () => {
    const pdf = readFileSync(join(SAMPLES_DIR, "06-orbit-statement-of-work.pdf")).toString("base64");
    const created = await call("POST", "/api/requests", { fileName: "upload.pdf", contentBase64: pdf });
    expect(created.status).toBe(201);
    expect(data(created)).toMatchObject({ title: "Orbit Design Studio LLC", sourceType: "pdf", status: "pending" });
    const text = await call("POST", "/api/requests", { text: "Vendor: Pasted Ltd\nTotal price: EUR 500." });
    expect(data(text)).toMatchObject({ title: "Pasted Ltd", sourceType: "text" });
    expect(data(await call("GET", "/api/requests"))).toHaveLength(10);
  });

  it("rejects unreadable uploads with a useful message", async () => {
    expect((await call("POST", "/api/requests", {})).status).toBe(400);
    expect((await call("POST", "/api/requests", { contentBase64: "!!!" })).status).toBe(400);
    const notPdf = Buffer.from([0, 1, 2, 3, 0, 5]).toString("base64");
    const bad = await call("POST", "/api/requests", { contentBase64: notPdf });
    expect(bad.status).toBe(422);
    expect(data(bad).error).toMatch(/Unsupported file type/);
    const blank = await call("POST", "/api/requests", { text: "   \n  " });
    expect(blank.status).toBe(400);
  });

  it("validates decisions, records the audit trail and blocks a second final decision", async () => {
    const id = "req-04-ironbridge-support";
    expect((await call("POST", `/api/requests/${id}/decision`, { decision: "maybe", reviewer: "A" })).status).toBe(400);
    expect((await call("POST", `/api/requests/${id}/decision`, { decision: "approve" })).status).toBe(400);
    const noComment = await call("POST", `/api/requests/${id}/decision`, { decision: "reject", reviewer: "Ana" });
    expect(noComment.status).toBe(400);
    expect(data(noComment).error).toMatch(/comment is required/);

    const ok = await call("POST", `/api/requests/${id}/decision`, { decision: "reject", reviewer: "Ana", comment: "No liability cap" });
    expect(ok.status).toBe(200);
    expect(data(ok).request.status).toBe("rejected");
    expect((await call("POST", `/api/requests/${id}/decision`, { decision: "approve", reviewer: "Ben" })).status).toBe(409);

    const audit = data(await call("GET", "/api/audit"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ requestId: id, reviewer: "Ana", action: "reject", fromStatus: "pending", toStatus: "rejected" });
    expect((await call("POST", "/api/requests/nope/decision", { decision: "approve", reviewer: "A" })).status).toBe(404);
  });

  it("answers health and unknown routes", async () => {
    expect(data(await call("GET", "/api/health"))).toMatchObject({ ok: true, extractor: "rules" });
    expect((await call("GET", "/api/unknown")).status).toBe(404);
    const badJson = await route(service, { method: "POST", path: "/api/requests", query: {}, body: "[1]" });
    expect(badJson.status).toBe(400);
  });
});

describe("seedSamples", () => {
  it("is idempotent", async () => {
    const again = await seedSamples({ store, policy: loadPolicy(POLICY_FILE), provider: new RuleProvider() });
    expect(again).toBe(0);
    expect(await store.count()).toBe(8);
  });
});
