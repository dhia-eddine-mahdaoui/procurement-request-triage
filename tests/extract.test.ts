import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTerms, parseAmount } from "../src/extract.js";
import { groundTerms } from "../src/provider.js";
import { SOURCES_DIR } from "../src/paths.js";

const sample = (name: string) => readFileSync(join(SOURCES_DIR, name), "utf8");

describe("parseAmount", () => {
  it("reads symbol and code prefixes and trailing codes", () => {
    expect(parseAmount("Total: EUR 24,000.00")).toEqual({ amount: 24000, currency: "EUR" });
    expect(parseAmount("Fee: $6,500")).toEqual({ amount: 6500, currency: "USD" });
    expect(parseAmount("Price: £1,800.50")).toEqual({ amount: 1800.5, currency: "GBP" });
    expect(parseAmount("Price: 9,900 USD")).toEqual({ amount: 9900, currency: "USD" });
  });

  it("returns null when there is no amount", () => {
    expect(parseAmount("Fees: to be confirmed")).toBeNull();
  });
});

describe("extractTerms on synthetic vendor documents", () => {
  it("extracts vendor, amount, term, auto-renew, notice, cap, DPA and payment terms with source lines", () => {
    const t = extractTerms(sample("01-velora-order-form.txt"));
    expect(t.vendor.value).toBe("Velora Analytics Ltd");
    expect(t.amount).toEqual({ value: { amount: 24000, currency: "EUR" }, snippet: "Total contract value: EUR 24,000.00, excluding VAT", page: 1 });
    expect(t.termMonths.value).toBe(12);
    expect(t.autoRenew.value).toBe(true);
    expect(t.noticeDays.value).toBe(60);
    expect(t.liabilityCap.value).toEqual({ amount: 48000, currency: "EUR" });
    expect(t.dpaPresent.value).toBe(true);
    expect(t.paymentTermsDays.value).toBe(30);
    expect(t.noticeDays.snippet).toBe("Notice of non-renewal: at least 60 days before the end of the then-current term.");
  });

  it("reads annual fees and a USD cap", () => {
    const t = extractTerms(sample("02-kestrel-renewal.txt"));
    expect(t.amount.value).toEqual({ amount: 6500, currency: "USD" });
    expect(t.autoRenew.value).toBe(true);
    expect(t.noticeDays.value).toBe(14);
    expect(t.liabilityCap.value).toEqual({ amount: 6500, currency: "USD" });
    expect(t.paymentTermsDays.value).toBe(45);
  });

  it("detects an unlimited liability and a missing DPA", () => {
    const t = extractTerms(sample("03-castor-hosting.txt"));
    expect(t.amount.value).toEqual({ amount: 50400, currency: "EUR" });
    expect(t.termMonths.value).toBe(36);
    expect(t.autoRenew.value).toBe(false);
    expect(t.liabilityCap.value).toBe("unlimited");
    expect(t.dpaPresent.value).toBe(false);
  });

  it("treats 'not applicable' auto-renewal as false and leaves unstated fields null", () => {
    const t = extractTerms(sample("04-ironbridge-support.txt"));
    expect(t.autoRenew.value).toBe(false);
    expect(t.liabilityCap).toEqual({ value: null, snippet: null, page: null });
    expect(t.dpaPresent).toEqual({ value: null, snippet: null, page: null });
    expect(t.amount.value).toEqual({ amount: 1800, currency: "GBP" });
  });

  it("reports a missing key amount as null (incomplete quote)", () => {
    const t = extractTerms(sample("05-helio-training-proposal.txt"));
    expect(t.amount).toEqual({ value: null, snippet: null, page: null });
    expect(t.vendor.value).toBe("Helio Learning BV");
    expect(t.termMonths.value).toBe(3);
    expect(t.liabilityCap.value).toEqual({ amount: 5000, currency: "EUR" });
  });

  it("keeps the snippet but no value when a DPA is only available on request", () => {
    const t = extractTerms(sample("08-tessera-storage-schedule.txt"));
    expect(t.dpaPresent.value).toBeNull();
    expect(t.dpaPresent.snippet).toBe("Data protection: a data processing agreement is available on request.");
    expect(t.noticeDays.value).toBe(21);
    expect(t.autoRenew.value).toBe(true);
  });
});

describe("parseAmount formats", () => {
  it("reads continental separators and magnitude suffixes", () => {
    expect(parseAmount("EUR 18.500,00")).toEqual({ amount: 18500, currency: "EUR" });
    expect(parseAmount("EUR 1.000.000")).toEqual({ amount: 1000000, currency: "EUR" });
    expect(parseAmount("£5m in the aggregate")).toEqual({ amount: 5000000, currency: "GBP" });
    expect(parseAmount("USD 250k")).toEqual({ amount: 250000, currency: "USD" });
  });
});

describe("sentence-level evidence", () => {
  it("points at the sentence, not the whole paragraph, and ignores monthly figures next to a total", () => {
    const t = extractTerms("Vendor: Acme Test Ltd\nThe monthly charge is EUR 1,150, giving a total of EUR 27,600 over the term. Payment is due within 30 days of invoice.");
    expect(t.amount.value).toEqual({ amount: 27600, currency: "EUR" });
    expect(t.amount.snippet).toBe("The monthly charge is EUR 1,150, giving a total of EUR 27,600 over the term.");
    expect(t.paymentTermsDays.snippet).toBe("Payment is due within 30 days of invoice.");
  });

  it("converts notice given in months and prefers the figure attached to the notice", () => {
    const t = extractTerms("Vendor: Acme Test Ltd\nThis agreement shall automatically renew for 12 months unless either party serves at least 6 months' written notice.");
    expect(t.noticeDays.value).toBe(180);
  });

  it("uses the general cap when unlimited liability is only a carve-out", () => {
    const t = extractTerms("Liability: unlimited for personal injury caused by negligence; all other liability is capped at USD 30,000.");
    expect(t.liabilityCap.value).toEqual({ amount: 30000, currency: "USD" });
  });
});

describe("groundTerms (LLM output guard)", () => {
  const units = [
    { text: "Vendor: Acme Test Ltd", page: 1 },
    { text: "Total: EUR 5,000.00", page: 2 },
  ];

  it("drops values whose snippet is not verbatim in the document and records the page of the ones that are", () => {
    const t = groundTerms(
      {
        vendor: { value: "Acme Test Ltd", snippet: "Vendor: Acme Test Ltd" },
        amount: { value: { amount: 9999, currency: "EUR" }, snippet: "Total: EUR 9,999.00" },
      },
      units,
    );
    expect(t.vendor).toEqual({ value: "Acme Test Ltd", snippet: "Vendor: Acme Test Ltd", page: 1 });
    expect(t.amount).toEqual({ value: null, snippet: null, page: null });
  });

  it("drops values of the wrong type", () => {
    const t = groundTerms({ amount: { value: "5000", snippet: "Total: EUR 5,000.00" } }, units);
    expect(t.amount.value).toBeNull();
  });
});
