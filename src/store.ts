import { randomUUID } from "node:crypto";
import type { StoredDocument } from "./ingest.js";
import type { AuditEvent, Decision, PurchaseRequest, RequestStatus, RequestSummary, Route } from "./types.js";

export class StoreError extends Error {
  constructor(
    readonly code: "not_found" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export interface ListFilter {
  status?: RequestStatus;
  route?: Route;
  q?: string;
}

export interface DecisionInput {
  decision: Decision;
  reviewer: string;
  comment: string | null;
}

export const DECISION_STATUS: Record<Decision, RequestStatus> = {
  approve: "approved",
  reject: "rejected",
  request_changes: "changes_requested",
};

/** A request can be decided while it is pending or after the requester was asked for changes. */
export const DECIDABLE: RequestStatus[] = ["pending", "changes_requested"];

/**
 * Persistence port. `PgStore` is the real implementation; `MemoryStore` is used by unit tests and
 * the zero-setup demo mode. Both run the same contract tests (tests/store.contract.ts).
 */
export interface Store {
  list(filter?: ListFilter): Promise<RequestSummary[]>;
  get(id: string): Promise<PurchaseRequest | null>;
  /** Inserts a request and its source document. Returns false when the id already exists. */
  insert(request: PurchaseRequest, document: StoredDocument): Promise<boolean>;
  /** Atomically checks the current status, updates it and appends the audit event. */
  decide(id: string, input: DecisionInput): Promise<{ request: PurchaseRequest; event: AuditEvent }>;
  events(requestId?: string): Promise<AuditEvent[]>;
  document(id: string): Promise<StoredDocument | null>;
  count(): Promise<number>;
  close(): Promise<void>;
}

export function toSummary(r: PurchaseRequest): RequestSummary {
  const { pages: _pages, ...rest } = r;
  return rest;
}

export function matchesFilter(r: RequestSummary, f: ListFilter): boolean {
  if (f.status && r.status !== f.status) return false;
  if (f.route && r.evaluation.route !== f.route) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!`${r.title} ${r.sourceName}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

export class MemoryStore implements Store {
  private requests = new Map<string, PurchaseRequest>();
  private documents = new Map<string, StoredDocument>();
  private audit: AuditEvent[] = [];

  async list(filter: ListFilter = {}): Promise<RequestSummary[]> {
    return [...this.requests.values()]
      .map((r) => toSummary(structuredClone(r)))
      .filter((r) => matchesFilter(r, filter))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<PurchaseRequest | null> {
    const r = this.requests.get(id);
    return r ? structuredClone(r) : null;
  }

  async insert(request: PurchaseRequest, document: StoredDocument): Promise<boolean> {
    if (this.requests.has(request.id)) return false;
    this.requests.set(request.id, structuredClone(request));
    this.documents.set(request.id, document);
    return true;
  }

  async decide(id: string, input: DecisionInput): Promise<{ request: PurchaseRequest; event: AuditEvent }> {
    const r = this.requests.get(id);
    if (!r) throw new StoreError("not_found", "Request not found");
    if (!DECIDABLE.includes(r.status)) throw new StoreError("conflict", `Request is already ${r.status}`);
    const at = new Date().toISOString();
    const event: AuditEvent = {
      id: randomUUID(),
      requestId: id,
      at,
      reviewer: input.reviewer,
      action: input.decision,
      fromStatus: r.status,
      toStatus: DECISION_STATUS[input.decision],
      comment: input.comment,
    };
    r.status = event.toStatus;
    r.updatedAt = at;
    this.audit.push(event);
    return { request: structuredClone(r), event };
  }

  async events(requestId?: string): Promise<AuditEvent[]> {
    const list = requestId ? this.audit.filter((e) => e.requestId === requestId) : this.audit;
    return [...list].reverse();
  }

  async document(id: string): Promise<StoredDocument | null> {
    return this.documents.get(id) ?? null;
  }

  async count(): Promise<number> {
    return this.requests.size;
  }

  async close(): Promise<void> {}
}
