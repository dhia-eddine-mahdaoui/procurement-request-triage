import type { Amount, ExtractedTerms, TermKey } from "./types.js";

export const TERM_LABELS: Record<TermKey, string> = {
  vendor: "Vendor",
  amount: "Total value",
  termMonths: "Term",
  autoRenew: "Auto-renew",
  noticeDays: "Notice period",
  liabilityCap: "Liability cap",
  dpaPresent: "Data processing agreement",
  paymentTermsDays: "Payment terms",
};

export function formatAmount(a: Amount): string {
  return `${a.currency} ${a.amount.toLocaleString("en-US")}`;
}

/** Human-readable value for a term; `null` means the document did not state it. */
export function formatTerm(key: TermKey, value: unknown): string {
  if (value === null || value === undefined) return "not found";
  switch (key) {
    case "amount":
    case "liabilityCap":
      if (value === "unlimited") return "unlimited";
      return formatAmount(value as Amount);
    case "termMonths":
      return `${value} months`;
    case "autoRenew":
    case "dpaPresent":
      return value ? "yes" : "no";
    case "noticeDays":
      return `${value} days`;
    case "paymentTermsDays":
      return `net ${value}`;
    default:
      return String(value);
  }
}

export function summarizeTerms(terms: ExtractedTerms): string {
  return (Object.keys(TERM_LABELS) as TermKey[])
    .map((k) => `${TERM_LABELS[k]}: ${formatTerm(k, terms[k].value)}`)
    .join("; ");
}
