import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, validatePolicy } from "../src/policy.js";
import { POLICY_FILE } from "../src/paths.js";
import type { ExtractedTerms, Policy } from "../src/types.js";

const policy = JSON.parse(readFileSync(POLICY_FILE, "utf8")) as Policy;

/** A complete, clean set of terms: no flags expected unless a test changes a field. */
function cleanTerms(overrides: Partial<Record<keyof ExtractedTerms, unknown>> = {}): ExtractedTerms {
  const base: ExtractedTerms = {
    vendor: { value: "Test Vendor Ltd", snippet: "Vendor: Test Vendor Ltd" },
    amount: { value: { amount: 5000, currency: "EUR" }, snippet: "Total: EUR 5,000" },
    termMonths: { value: 12, snippet: "Term: 12 months" },
    autoRenew: { value: false, snippet: "No auto-renewal." },
    noticeDays: { value: null, snippet: null },
    liabilityCap: { value: { amount: 5000, currency: "EUR" }, snippet: "Liability capped at EUR 5,000." },
    dpaPresent: { value: true, snippet: "A DPA is attached." },
    paymentTermsDays: { value: 30, snippet: "Net 30" },
  };
  for (const [k, v] of Object.entries(overrides)) {
    (base as unknown as Record<string, unknown>)[k] = v;
  }
  return base;
}

const ids = (terms: ExtractedTerms) => evaluate(terms, policy).flags.map((f) => f.ruleId);

describe("policy file", () => {
  it("is structurally valid", () => {
    expect(() => validatePolicy(policy)).not.toThrow();
  });
});

describe("evaluate", () => {
  it("passes a clean document to the default route with no risk", () => {
    const result = evaluate(cleanTerms(), policy);
    expect(result.flags).toEqual([]);
    expect(result.route).toBe("procurement");
    expect(result.riskLevel).toBe("none");
  });

  it("routes totals above 10,000 EUR to finance, and not exactly 10,000", () => {
    expect(ids(cleanTerms({ amount: { value: { amount: 10001, currency: "EUR" }, snippet: "x" } }))).toContain("AMOUNT_ABOVE_FINANCE_THRESHOLD");
    expect(ids(cleanTerms({ amount: { value: { amount: 10000, currency: "EUR" }, snippet: "x" } }))).not.toContain("AMOUNT_ABOVE_FINANCE_THRESHOLD");
  });

  it("converts foreign currency before the finance threshold check", () => {
    // 12,000 USD * 0.92 = 11,040 EUR -> above threshold
    const usd = evaluate(cleanTerms({ amount: { value: { amount: 12000, currency: "USD" }, snippet: "x" } }), policy);
    expect(usd.flags.find((f) => f.ruleId === "AMOUNT_ABOVE_FINANCE_THRESHOLD")?.message).toContain("11,040");
    // 9,900 USD * 0.92 = 9,108 EUR -> below threshold
    expect(ids(cleanTerms({ amount: { value: { amount: 9900, currency: "USD" }, snippet: "x" } }))).not.toContain("AMOUNT_ABOVE_FINANCE_THRESHOLD");
  });

  it("flags auto-renewal with notice under 30 days, and with no notice stated", () => {
    const short = cleanTerms({ autoRenew: { value: true, snippet: "a" }, noticeDays: { value: 29, snippet: "b" } });
    expect(ids(short)).toContain("AUTO_RENEW_SHORT_NOTICE");
    const ok = cleanTerms({ autoRenew: { value: true, snippet: "a" }, noticeDays: { value: 30, snippet: "b" } });
    expect(ids(ok)).not.toContain("AUTO_RENEW_SHORT_NOTICE");
    const unstated = cleanTerms({ autoRenew: { value: true, snippet: "a" }, noticeDays: { value: null, snippet: null } });
    expect(ids(unstated)).toContain("AUTO_RENEW_SHORT_NOTICE");
  });

  it("does not apply the notice rule when auto-renewal is off", () => {
    expect(ids(cleanTerms({ autoRenew: { value: false, snippet: "a" }, noticeDays: { value: 5, snippet: "b" } }))).not.toContain(
      "AUTO_RENEW_SHORT_NOTICE",
    );
  });

  it("routes a missing or unconfirmed DPA to legal", () => {
    const result = evaluate(cleanTerms({ dpaPresent: { value: null, snippet: null } }), policy);
    expect(result.flags.map((f) => f.ruleId)).toContain("DPA_NOT_CONFIRMED");
    expect(result.route).toBe("legal");
    expect(result.riskLevel).toBe("high");
  });

  it("flags missing and unlimited liability caps", () => {
    expect(ids(cleanTerms({ liabilityCap: { value: null, snippet: null } }))).toContain("LIABILITY_CAP_MISSING");
    expect(ids(cleanTerms({ liabilityCap: { value: "unlimited", snippet: "unlimited" } }))).toContain("LIABILITY_UNLIMITED");
  });

  it("routes incomplete key terms back to the requester", () => {
    const result = evaluate(cleanTerms({ amount: { value: null, snippet: null } }), policy);
    const flag = result.flags.find((f) => f.ruleId === "KEY_TERMS_MISSING");
    expect(flag?.route).toBe("requester");
    expect(flag?.message).toContain("amount");
    expect(result.route).toBe("requester");
  });

  it("picks the most senior route when several rules fire", () => {
    // finance (amount) + procurement (short notice) + legal (no DPA) -> legal
    const result = evaluate(
      cleanTerms({
        amount: { value: { amount: 20000, currency: "EUR" }, snippet: "x" },
        autoRenew: { value: true, snippet: "a" },
        noticeDays: { value: 10, snippet: "b" },
        dpaPresent: { value: false, snippet: "c" },
      }),
      policy,
    );
    expect(result.route).toBe("legal");
    expect(result.riskLevel).toBe("high");
    expect(result.flags).toHaveLength(3);
  });
});
