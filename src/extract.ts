import type { Amount, Evidence, ExtractedTerms } from "./types.js";

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const AMOUNT_RE = /(€|£|\$|\b(?:EUR|USD|GBP)\b)\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?\b(EUR|USD|GBP)\b/i;

/** Parses the first currency amount on a line, e.g. "EUR 24,000.00" or "9,900 USD". */
export function parseAmount(line: string): Amount | null {
  const m = AMOUNT_RE.exec(line);
  if (!m) return null;
  const rawCurrency = (m[1] ?? m[4] ?? "").toUpperCase();
  const digits = m[2] ?? m[3];
  if (!digits) return null;
  return { amount: Number(digits.replace(/,/g, "")), currency: CURRENCY_SYMBOLS[rawCurrency] ?? rawCurrency };
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Returns the value and source line of the first line for which `pred` yields a non-null result. */
function firstMatch<T>(ls: string[], pred: (line: string) => T | null): Evidence<T> {
  for (const line of ls) {
    const value = pred(line);
    if (value !== null) return { value, snippet: line };
  }
  return { value: null, snippet: null };
}

const AMOUNT_LABEL = /total|contract value|subscription|annual|price|fees?/i;
const AMOUNT_EXCLUDE = /liabil|\bcap|penalt|\blate\b|discount|monthly|per month|set-?up|one-off|deposit/i;

function extractVendor(ls: string[]): Evidence<string> {
  return firstMatch(ls, (l) => {
    const m = /^(?:vendor|supplier|provider)\s*:\s*(.+)$/i.exec(l);
    return m ? m[1].trim() : null;
  });
}

function extractAmount(ls: string[]): Evidence<Amount> {
  const candidates = ls.filter((l) => AMOUNT_LABEL.test(l) && !AMOUNT_EXCLUDE.test(l) && parseAmount(l) !== null);
  const line = candidates.find((l) => /total|contract value/i.test(l)) ?? candidates[0];
  if (!line) return { value: null, snippet: null };
  return { value: parseAmount(line), snippet: line };
}

function extractTerm(ls: string[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/\bterm\b|contract period|duration/i.test(l) || /renew|notice|liabil/i.test(l)) return null;
    const m = /(\d+)[\s-]?(months?|years?)\b/i.exec(l);
    if (!m) return null;
    const n = Number(m[1]);
    return /year/i.test(m[2]) ? n * 12 : n;
  });
}

const AUTO_RE = /auto[\s-]?(?:matic(?:ally)?\s+)?renew|renews?\s+automatically/i;
const AUTO_NEG =
  /\b(?:no|not|without)\b[^.]*auto[\s-]?(?:matic(?:ally)?\s+)?renew|auto[\s-]?renew\w*\s*:?\s*(?:is\s+)?(?:not|disabled)|(?:shall|does) not (?:automatically )?renew/i;

function extractAutoRenew(ls: string[]): Evidence<boolean> {
  return firstMatch(ls, (l) => (AUTO_RE.test(l) ? !AUTO_NEG.test(l) : null));
}

function extractNotice(ls: string[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/notice|cancel|terminat|non-renewal/i.test(l) || /liabil/i.test(l)) return null;
    const m = /(\d+)\s*(?:calendar\s+|business\s+)?days?\b/i.exec(l);
    return m ? Number(m[1]) : null;
  });
}

function extractLiability(ls: string[]): Evidence<Amount | "unlimited"> {
  const liability = ls.filter((l) => /liabil/i.test(l));
  for (const l of liability) {
    if (/unlimited/i.test(l)) return { value: "unlimited", snippet: l };
  }
  for (const l of liability) {
    if (/\bcap|capped|shall not exceed|limited to|maximum|aggregate/i.test(l)) {
      const amount = parseAmount(l);
      if (amount) return { value: amount, snippet: l };
    }
  }
  // Liability is discussed but no quantified cap was found: keep the snippet for the reviewer.
  return { value: null, snippet: liability[0] ?? null };
}

const DPA_RE = /data processing (?:agreement|addendum)|\bDPA\b/i;
const DPA_NEG = /\b(?:no|not|without)\b/i;
const DPA_AFFIRM = /attached|included|incorporated|annexed|enclosed|appended|forms part/i;

function extractDpa(ls: string[]): Evidence<boolean> {
  const hits = ls.filter((l) => DPA_RE.test(l));
  for (const l of hits) {
    if (DPA_NEG.test(l)) return { value: false, snippet: l };
    if (DPA_AFFIRM.test(l)) return { value: true, snippet: l };
  }
  // Mentioned but not confirmed (e.g. "available on request"): unknown, snippet kept for review.
  return { value: null, snippet: hits[0] ?? null };
}

function extractPayment(ls: string[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/payment|invoice|payable|net\s*\d/i.test(l)) return null;
    const m = /net\s*(\d+)|within\s+(\d+)\s+days|(\d+)\s+days/i.exec(l);
    if (!m) return null;
    return Number(m[1] ?? m[2] ?? m[3]);
  });
}

/** Deterministic rule-based extraction. Every field carries the source line it was read from. */
export function extractTerms(text: string): ExtractedTerms {
  const ls = lines(text);
  return {
    vendor: extractVendor(ls),
    amount: extractAmount(ls),
    termMonths: extractTerm(ls),
    autoRenew: extractAutoRenew(ls),
    noticeDays: extractNotice(ls),
    liabilityCap: extractLiability(ls),
    dpaPresent: extractDpa(ls),
    paymentTermsDays: extractPayment(ls),
  };
}
