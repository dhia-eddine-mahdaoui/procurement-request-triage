import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { looksLikePdf, parsePdf, parseText } from "../src/document.js";
import { extractFromUnits } from "../src/extract.js";
import { SAMPLES_DIR } from "../src/paths.js";
import { renderPdf } from "../scripts/render-pdf.js";

const samplePdf = (name: string) => new Uint8Array(readFileSync(join(SAMPLES_DIR, name)));

describe("PDF parsing", () => {
  it("recognises PDF bytes and extracts text per page", async () => {
    const bytes = samplePdf("01-velora-order-form.pdf");
    expect(looksLikePdf(bytes)).toBe(true);
    const doc = await parsePdf(bytes);
    expect(doc.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(doc.pages[0].paragraphs[0]).toBe("ORDER FORM - SUBSCRIPTION (SYNTHETIC EXAMPLE)");
    expect(doc.pages[0].paragraphs).toContain("Vendor: Velora Analytics Ltd");
  });

  it("joins a wrapped line back into one paragraph", async () => {
    const doc = await parsePdf(samplePdf("01-velora-order-form.pdf"));
    const all = doc.units.map((u) => u.text);
    expect(all).toContain(
      "Auto-renewal: This Order Form shall automatically renew for successive 12-month periods unless notice of non-renewal is given.",
    );
  });

  it("keeps page numbers on extracted evidence", async () => {
    const t = extractFromUnits((await parsePdf(samplePdf("01-velora-order-form.pdf"))).units);
    expect(t.vendor.page).toBe(1);
    expect(t.liabilityCap.page).toBe(2);
    expect(t.liabilityCap.snippet).toBe("Liability: Supplier's aggregate liability is capped at EUR 48,000.");
    expect(t.dpaPresent.page).toBe(2);
  });

  it("round-trips a generated one-page document", async () => {
    const pdf = await renderPdf("QUOTE", ["Supplier: Round Trip Ltd", "Total price: EUR 1,000."]);
    const doc = await parsePdf(new Uint8Array(pdf));
    expect(doc.pages).toHaveLength(1);
    expect(extractFromUnits(doc.units).amount.value).toEqual({ amount: 1000, currency: "EUR" });
  });

  it("rejects a PDF without extractable text and non-PDF binary input", async () => {
    const blank = await renderPdf("", []);
    await expect(parsePdf(new Uint8Array(blank))).rejects.toThrow(/No extractable text/);
    expect(looksLikePdf(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false);
  });
});

describe("text parsing", () => {
  it("makes one paragraph per line and a page per form feed", () => {
    const doc = parseText("A\n\nB\fC");
    expect(doc.pages).toEqual([
      { page: 1, paragraphs: ["A", "B"] },
      { page: 2, paragraphs: ["C"] },
    ]);
  });
});
