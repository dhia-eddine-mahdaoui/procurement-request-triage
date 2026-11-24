import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildRequest } from "../src/ingest.js";
import { loadPolicy } from "../src/policy.js";
import { POLICY_FILE, SAMPLES_DIR } from "../src/paths.js";
import { RuleProvider } from "../src/provider.js";
import { StoreError, type Store } from "../src/store.js";

const policy = loadPolicy(POLICY_FILE);

export async function sampleRequest(file: string, id: string) {
  const bytes = new Uint8Array(readFileSync(join(SAMPLES_DIR, file)));
  return buildRequest({ id, sourceName: file, bytes }, new RuleProvider(), policy);
}

/** Behaviour every Store implementation must provide. Used for the in-memory store and for Postgres. */
export function storeContract(name: string, make: () => Promise<Store>, opts: { skip?: boolean } = {}): void {
  describe.skipIf(opts.skip)(`${name} store contract`, () => {
    let store: Store;
    beforeEach(async () => {
      store = await make();
      for (const [file, id] of [
        ["01-velora-order-form.pdf", "a-velora"],
        ["03-castor-hosting.pdf", "b-castor"],
        ["05-helio-training-proposal.pdf", "c-helio"],
      ] as const) {
        const built = await sampleRequest(file, id);
        expect(await store.insert(built.request, built.document)).toBe(true);
      }
    });

    it("lists summaries without page text and filters by status, route and text", async () => {
      const all = await store.list();
      expect(all.map((r) => r.id)).toEqual(["a-velora", "b-castor", "c-helio"]);
      expect("pages" in all[0]).toBe(false);
      expect((await store.list({ route: "legal" })).map((r) => r.id)).toEqual(["b-castor"]);
      expect((await store.list({ route: "finance" })).map((r) => r.id)).toEqual(["a-velora"]);
      expect((await store.list({ status: "approved" })).length).toBe(0);
      expect((await store.list({ q: "HELIO" })).map((r) => r.id)).toEqual(["c-helio"]);
      expect((await store.list({ q: "50%" })).length).toBe(0);
    });

    it("round-trips terms, flags, pages and the stored document", async () => {
      const r = await store.get("b-castor");
      expect(r?.terms.liabilityCap.value).toBe("unlimited");
      expect(r?.terms.liabilityCap.page).toBe(2);
      expect(r?.pages.length).toBe(2);
      expect(r?.evaluation.flags.map((f) => f.ruleId)).toEqual(["AMOUNT_ABOVE_FINANCE_THRESHOLD", "DPA_NOT_CONFIRMED", "LIABILITY_UNLIMITED"]);
      expect(r?.evaluation.route).toBe("legal");
      expect(r?.evaluation.policyVersion).toBe(policy.version);
      const doc = await store.document("b-castor");
      expect(doc?.contentType).toBe("application/pdf");
      expect(Buffer.from(doc!.bytes).subarray(0, 4).toString()).toBe("%PDF");
      expect(await store.get("missing")).toBeNull();
      expect(await store.document("missing")).toBeNull();
    });

    it("refuses a duplicate id without changing the stored request", async () => {
      const again = await sampleRequest("03-castor-hosting.pdf", "b-castor");
      expect(await store.insert(again.request, again.document)).toBe(false);
      expect(await store.count()).toBe(3);
    });

    it("decides atomically: status, audit event and later conflict", async () => {
      const { request, event } = await store.decide("a-velora", { decision: "request_changes", reviewer: "Ana", comment: "Need DPA annex" });
      expect(request.status).toBe("changes_requested");
      expect(event).toMatchObject({ fromStatus: "pending", toStatus: "changes_requested", reviewer: "Ana", comment: "Need DPA annex" });
      // a request waiting for changes can be decided again, a final decision cannot
      const approved = await store.decide("a-velora", { decision: "approve", reviewer: "Ben", comment: null });
      expect(approved.request.status).toBe("approved");
      await expect(store.decide("a-velora", { decision: "reject", reviewer: "Cy", comment: "late" })).rejects.toMatchObject({ code: "conflict" });
      const events = await store.events("a-velora");
      expect(events.map((e) => e.action)).toEqual(["approve", "request_changes"]); // newest first
      expect((await store.events()).length).toBe(2);
      expect((await store.events("b-castor")).length).toBe(0);
    });

    it("reports unknown requests", async () => {
      await expect(store.decide("nope", { decision: "approve", reviewer: "Ana", comment: null })).rejects.toBeInstanceOf(StoreError);
      await expect(store.decide("nope", { decision: "approve", reviewer: "Ana", comment: null })).rejects.toMatchObject({ code: "not_found" });
    });

    it("lets exactly one of two concurrent final decisions win", async () => {
      const results = await Promise.allSettled([
        store.decide("c-helio", { decision: "approve", reviewer: "Ana", comment: null }),
        store.decide("c-helio", { decision: "reject", reviewer: "Ben", comment: "no" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      expect((await store.events("c-helio")).length).toBe(1);
    });
  });
}
