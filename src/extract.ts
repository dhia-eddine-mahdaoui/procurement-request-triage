import { parseText } from "./document.js";
import type { Amount, DocUnit, Evidence, ExtractedTerms } from "./types.js";

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const NUM = String.raw`\d(?:[\d.,]*\d)?`;
const AMOUNT_RE = new RegExp(String.raw`(€|£|\$|\b(?:EUR|USD|GBP)\b)\s?(${NUM})|(${NUM})\s?\b(EUR|USD|GBP)\b`, "i");

/** Reads "24,000.00" (UK/US) and "18.500,00" or "1.000.000" (continental) alike. */
export function parseNumber(raw: string): number {
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? /,/g : /\./g;
    return Number(raw.replace(thousands, "").replace(decimal, "."));
  }
  const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
  if (!sep) return Number(raw);
  const groups = raw.split(sep);
  const lastLen = groups[groups.length - 1].length;
  // Several separators, or exactly three digits after a lone one, are thousands separators ("1.000.000", "24,000").
  if (groups.length > 2 || lastLen === 3) return Number(groups.join(""));
  return Number(groups.join("."));
}

/** Parses the first currency amount on a line, e.g. "EUR 24,000.00", "EUR 18.500,00" or "9,900 USD". */
export function parseAmount(line: string): Amount | null {
  const m = AMOUNT_RE.exec(line);
  if (!m) return null;
  const rawCurrency = (m[1] ?? m[4] ?? "").toUpperCase();
  const digits = m[2] ?? m[3];
  if (!digits) return null;
  // "£5m", "$250k", "EUR 2 million": magnitude suffix right after the number.
  const suffix = /^\s?(m|k|bn|million|thousand|billion)\b/i.exec(line.slice(m.index + m[0].length))?.[1].toLowerCase();
  const scale = suffix === "m" || suffix === "million" ? 1e6 : suffix === "k" || suffix === "thousand" ? 1e3 : suffix ? 1e9 : 1;
  return { amount: parseNumber(digits) * scale, currency: CURRENCY_SYMBOLS[rawCurrency] ?? rawCurrency };
}

const none = <T>(): Evidence<T> => ({ value: null, snippet: null, page: null });

const found = <T>(value: T | null, u: DocUnit | undefined): Evidence<T> =>
  u ? { value, snippet: u.text, page: u.page } : none<T>();

/** Sentence boundary: after a full stop or semicolon and before a capital, except after common abbreviations. */
const SENTENCE_SPLIT = /(?<!\b(?:Inc|Ltd|Co|Corp|LLC|No|approx|incl|excl))(?<=[.;])\s+(?=[A-Z])/;

/** Splits paragraphs into sentences so a snippet points at the exact sentence, keeping the page number. */
export function toSegments(units: DocUnit[]): DocUnit[] {
  return units.flatMap((u) =>
    u.text
      .split(SENTENCE_SPLIT)
      .map((text) => ({ text: text.trim(), page: u.page }))
      .filter((s) => s.text.length > 0),
  );
}

/** Returns the value and source of the first segment for which `pred` yields a non-null result. */
function firstMatch<T>(ls: DocUnit[], pred: (line: string) => T | null): Evidence<T> {
  for (const l of ls) {
    const value = pred(l.text);
    if (value !== null) return { value, snippet: l.text, page: l.page };
  }
  return none<T>();
}

const AMOUNT_LABEL = /total|contract value|subscription|annual|price|fees?|charges?|cost/i;
const AMOUNT_EXCLUDE = /liabil|\bcap\b|capped|penalt|\blate\b|discount|monthly|per month|per seat|set-?up|one-off|deposit|insur/i;

function extractVendor(ls: DocUnit[]): Evidence<string> {
  return firstMatch(ls, (l) => {
    const labelled = /^(?:vendor|supplier|provider|contractor|service provider)\s*:\s*(.+)$/i.exec(l);
    if (labelled) return labelled[1].trim();
    // "issued by Acme Ltd (the "Supplier")" / "between Acme Ltd (the Supplier) and ..."
    const defined = /(?:issued by|between|from)\s+(.+?)\s+\((?:the\s+)?["“]?(?:supplier|vendor|provider|contractor)\b/i.exec(l);
    return defined ? defined[1].trim() : null;
  });
}

function extractAmount(ls: DocUnit[]): Evidence<Amount> {
  // For "... giving a total of EUR 27,600" only the part from the keyword on is read, so a monthly figure
  // earlier in the sentence is ignored; elsewhere a sentence mentioning excluded words (monthly, set-up, cap...) is skipped.
  const read = (l: DocUnit): Amount | null => {
    if (!AMOUNT_LABEL.test(l.text)) return null;
    const key = /total|contract value/i.exec(l.text);
    if (!key) return AMOUNT_EXCLUDE.test(l.text) ? null : parseAmount(l.text);
    const tail = l.text.slice(key.index);
    const m = AMOUNT_RE.exec(tail);
    if (!m) return null;
    return AMOUNT_EXCLUDE.test(tail.slice(0, m.index + m[0].length)) ? null : parseAmount(tail);
  };
  const withTotal = ls.find((l) => /total|contract value/i.test(l.text) && read(l) !== null);
  const line = withTotal ?? ls.find((l) => read(l) !== null);
  return found(line ? read(line) : null, line);
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18 };

function extractTerm(ls: DocUnit[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/\bterm\b|\bperiod\b|duration/i.test(l) || /renew|notice|liabil|payment/i.test(l)) return null;
    const m = /(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen)\b)\)?[\s-]?(months?|years?)\b/i.exec(l);
    if (!m) return null;
    const n = /^\d/.test(m[1]) ? Number(m[1]) : (WORDS[m[1].toLowerCase()] ?? NaN);
    if (Number.isNaN(n)) return null;
    return /year/i.test(m[2]) ? n * 12 : n;
  });
}

const AUTO_RE = /auto[\s-]?(?:matic(?:ally)?\s+)?renew|renews?\s+automatically/i;
const AUTO_NEG =
  /\b(?:no|not|without)\b[^.]*auto[\s-]?(?:matic(?:ally)?\s+)?renew|auto[\s-]?renew\w*\s*:?\s*(?:is\s+)?(?:not|disabled)|(?:shall|does|will) not (?:automatically )?renew/i;

/** "renews for successive 12-month terms", "is renewed each year", "continues for further periods": renewal without the word "automatic". */
const RENEWS_RE = /\b(?:renews?|renewed|continues?|extends?)\b[^.;]*\b(?:successive|further periods?|each (?:year|term)|every (?:year|term)|annually|unless)\b/i;
/** Explicit statements that nothing renews on its own. */
const NO_RENEWAL_RE = /renewal requires|expires at the end|no (?:automatic )?renewal|(?:does not|will not) (?:contain|include|renew)/i;

function extractAutoRenew(ls: DocUnit[]): Evidence<boolean> {
  return firstMatch(ls, (l) => {
    if (AUTO_RE.test(l)) return !AUTO_NEG.test(l);
    if (NO_RENEWAL_RE.test(l)) return false;
    return RENEWS_RE.test(l) ? !AUTO_NEG.test(l) : null;
  });
}

function extractNotice(ls: DocUnit[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/notice|notify|cancel|terminat|non-renewal/i.test(l) || /liabil/i.test(l)) return null;
    const days = /(\d+)\s*(?:calendar\s+|business\s+)?days?\b/i.exec(l);
    if (days) return Number(days[1]);
    // "6 months' written notice" -> 180 days (30-day months); prefer the figure attached to the word notice.
    const months = /(\d+)\s*months?'?\s+(?:written\s+|prior\s+)?notice/i.exec(l) ?? /(\d+)\s*months?\b/i.exec(l);
    return months ? Number(months[1]) * 30 : null;
  });
}

function extractLiability(ls: DocUnit[]): Evidence<Amount | "unlimited"> {
  const liability = ls.filter((l) => /liabil/i.test(l.text));
  const UNLIMITED = /unlimited|no (?:limit|cap)\b|without (?:any )?(?:limit|cap)|uncapped/i;
  for (const l of liability) {
    // "unlimited for personal injury; all other liability is capped at X": X is the general cap.
    const carveOut = /\b(?:all )?other\b|otherwise|except|save for/i.test(l.text) && parseAmount(l.text);
    if (UNLIMITED.test(l.text) && !carveOut) return found("unlimited", l);
  }
  for (const l of liability) {
    if (/\bcap|capped|(?:shall|will) not exceed|\bexceed|limited to|maximum|aggregate/i.test(l.text)) {
      const amount = parseAmount(l.text);
      if (amount) return found(amount, l);
    }
  }
  // Liability is discussed but no quantified cap was found: keep the snippet for the reviewer.
  return found<Amount | "unlimited">(null, liability[0]);
}

const DPA_RE = /data processing (?:agreement|addendum)|\bDPA\b/i;
const DPA_NEG = /\b(?:no|not|without)\b/i;
const DPA_AFFIRM = /attached|included|incorporated|annexed|enclosed|appended|forms part/i;

function extractDpa(ls: DocUnit[]): Evidence<boolean> {
  const hits = ls.filter((l) => DPA_RE.test(l.text));
  for (const l of hits) {
    if (DPA_NEG.test(l.text)) return found(false, l);
    if (DPA_AFFIRM.test(l.text)) return found(true, l);
  }
  // Mentioned but not confirmed (e.g. "available on request"): unknown, snippet kept for review.
  return found<boolean>(null, hits[0]);
}

function extractPayment(ls: DocUnit[]): Evidence<number> {
  return firstMatch(ls, (l) => {
    if (!/payment|invoice|payable|net\s*\d/i.test(l)) return null;
    const m = /net\s*(\d+)|within\s+(\d+)\s+days|(\d+)\s+days/i.exec(l);
    if (!m) return null;
    return Number(m[1] ?? m[2] ?? m[3]);
  });
}

/** Deterministic rule-based extraction over document units. Every field carries its source sentence and page. */
export function extractFromUnits(units: DocUnit[]): ExtractedTerms {
  const ls = toSegments(units);
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

/** Convenience wrapper for plain text (one paragraph per line). */
export function extractTerms(text: string): ExtractedTerms {
  return extractFromUnits(parseText(text).units);
}
