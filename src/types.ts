export type Severity = "low" | "medium" | "high";
export type Route = "requester" | "procurement" | "finance" | "legal";
export type RequestStatus = "pending" | "approved" | "rejected" | "changes_requested";
export type Decision = "approve" | "reject" | "request_changes";

export interface Amount {
  amount: number;
  currency: string;
}

/** An extracted value plus the verbatim source passage and page it came from (null when not found). */
export interface Evidence<T> {
  value: T | null;
  snippet: string | null;
  page: number | null;
}

/** One paragraph-level unit of a parsed document. */
export interface DocUnit {
  text: string;
  page: number;
}

export interface DocPage {
  page: number;
  paragraphs: string[];
}

export type SourceType = "pdf" | "text";

export interface ExtractedTerms {
  vendor: Evidence<string>;
  amount: Evidence<Amount>;
  termMonths: Evidence<number>;
  autoRenew: Evidence<boolean>;
  noticeDays: Evidence<number>;
  liabilityCap: Evidence<Amount | "unlimited">;
  dpaPresent: Evidence<boolean>;
  paymentTermsDays: Evidence<number>;
}

export type TermKey = keyof ExtractedTerms;

export interface RiskFlag {
  ruleId: string;
  severity: Severity;
  route: Route;
  message: string;
}

export interface PolicyEvaluation {
  policyVersion: string;
  flags: RiskFlag[];
  route: Route;
  riskLevel: Severity | "none";
}

export interface PurchaseRequest {
  id: string;
  title: string;
  sourceName: string;
  sourceType: SourceType;
  hasDocument: boolean;
  pages: DocPage[];
  extractor: string;
  terms: ExtractedTerms;
  evaluation: PolicyEvaluation;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
}

export type RequestSummary = Omit<PurchaseRequest, "pages">;

export interface AuditEvent {
  id: string;
  requestId: string;
  at: string;
  reviewer: string;
  action: Decision;
  fromStatus: RequestStatus;
  toStatus: RequestStatus;
  comment: string | null;
}

export type Check =
  | { type: "amount_gt_eur"; threshold: number }
  | { type: "auto_renew_notice_below"; days: number }
  | { type: "dpa_not_confirmed" }
  | { type: "liability_cap_missing" }
  | { type: "liability_unlimited" }
  | { type: "missing_fields"; fields: TermKey[] };

export interface PolicyRule {
  id: string;
  severity: Severity;
  route: Route;
  check: Check;
  message: string;
}

export interface Policy {
  version: string;
  baseCurrency: string;
  fxToBase: Record<string, number>;
  routeOrder: Route[];
  defaultRoute: Route;
  rules: PolicyRule[];
}
