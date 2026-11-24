import { randomUUID } from "node:crypto";
import { buildRequest, type StoredDocument } from "./ingest.js";
import type { ExtractionProvider } from "./provider.js";
import { StoreError, type ListFilter, type Store } from "./store.js";
import type { AuditEvent, Decision, Policy, PurchaseRequest, RequestStatus, RequestSummary, Route } from "./types.js";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const STATUSES: RequestStatus[] = ["pending", "approved", "rejected", "changes_requested"];
const ROUTES: Route[] = ["requester", "procurement", "finance", "legal"];
const DECISIONS: Decision[] = ["approve", "reject", "request_changes"];

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceDeps {
  store: Store;
  policy: Policy;
  provider: ExtractionProvider;
}

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new ServiceError(400, `${field} is required`);
  if (value.length > max) throw new ServiceError(400, `${field} is too long (max ${max} characters)`);
  return value.trim();
}

export interface CreateInput {
  fileName?: unknown;
  contentBase64?: unknown;
  text?: unknown;
}

/**
 * Transport-independent application layer. The Node HTTP server, the API Gateway Lambda
 * and the S3-triggered Lambda all call this same class.
 */
export class TriageService {
  constructor(private readonly deps: ServiceDeps) {}

  health() {
    return { ok: true, extractor: this.deps.provider.name, policyVersion: this.deps.policy.version };
  }

  listRequests(query: { status?: string; route?: string; q?: string }): Promise<RequestSummary[]> {
    const filter: ListFilter = {};
    if (query.status) {
      if (!STATUSES.includes(query.status as RequestStatus)) throw new ServiceError(400, "Unknown status filter");
      filter.status = query.status as RequestStatus;
    }
    if (query.route) {
      if (!ROUTES.includes(query.route as Route)) throw new ServiceError(400, "Unknown route filter");
      filter.route = query.route as Route;
    }
    if (query.q?.trim()) filter.q = query.q.trim().slice(0, 100);
    return this.deps.store.list(filter);
  }

  async getRequest(id: string): Promise<{ request: PurchaseRequest; events: AuditEvent[] }> {
    const request = await this.deps.store.get(id);
    if (!request) throw new ServiceError(404, "Request not found");
    return { request, events: await this.deps.store.events(id) };
  }

  /** Ingests an uploaded PDF (base64) or pasted text, extracts terms, evaluates policy and stores a pending request. */
  async createRequest(input: CreateInput): Promise<PurchaseRequest> {
    let bytes: Uint8Array;
    let fileName: string;
    if (typeof input.contentBase64 === "string") {
      fileName = typeof input.fileName === "string" && input.fileName.trim() ? input.fileName.trim().slice(0, 120) : "upload.pdf";
      if (!/^[A-Za-z0-9+/=\s]*$/.test(input.contentBase64)) throw new ServiceError(400, "contentBase64 is not valid base64");
      bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
    } else {
      const text = requireString(input.text, "text or contentBase64", 200_000);
      fileName = typeof input.fileName === "string" && input.fileName.trim() ? input.fileName.trim().slice(0, 120) : "pasted-quote.txt";
      bytes = new TextEncoder().encode(text);
    }
    return this.ingest(fileName, bytes);
  }

  async ingest(fileName: string, bytes: Uint8Array, id = `req-${randomUUID().slice(0, 8)}`): Promise<PurchaseRequest> {
    if (bytes.length === 0) throw new ServiceError(400, "The file is empty");
    if (bytes.length > MAX_UPLOAD_BYTES) throw new ServiceError(413, `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    let built;
    try {
      built = await buildRequest({ id, sourceName: fileName, bytes }, this.deps.provider, this.deps.policy);
    } catch (err) {
      throw new ServiceError(422, err instanceof Error ? err.message : "The document could not be read");
    }
    const inserted = await this.deps.store.insert(built.request, built.document);
    if (!inserted) throw new ServiceError(409, "A request with this id already exists");
    return built.request;
  }

  async decide(id: string, body: Record<string, unknown>) {
    const decision = body.decision;
    if (typeof decision !== "string" || !DECISIONS.includes(decision as Decision)) {
      throw new ServiceError(400, "decision must be approve, reject or request_changes");
    }
    const reviewer = requireString(body.reviewer, "reviewer", 80);
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 2000) : "";
    if (decision !== "approve" && comment.length === 0) {
      throw new ServiceError(400, "A comment is required when rejecting or requesting changes");
    }
    try {
      return await this.deps.store.decide(id, { decision: decision as Decision, reviewer, comment: comment || null });
    } catch (err) {
      if (err instanceof StoreError) throw new ServiceError(err.code === "not_found" ? 404 : 409, err.message);
      throw err;
    }
  }

  audit(): Promise<AuditEvent[]> {
    return this.deps.store.events();
  }

  async document(id: string): Promise<StoredDocument> {
    const doc = await this.deps.store.document(id);
    if (!doc) throw new ServiceError(404, "Document not found");
    return doc;
  }
}
