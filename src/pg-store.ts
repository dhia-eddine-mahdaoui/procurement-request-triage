import pg from "pg";
import type { StoredDocument } from "./ingest.js";
import { DECIDABLE, DECISION_STATUS, StoreError, type DecisionInput, type ListFilter, type Store } from "./store.js";
import type { AuditEvent, PurchaseRequest, RequestSummary, RiskFlag } from "./types.js";

interface RequestRow {
  id: string;
  title: string;
  source_name: string;
  source_type: "pdf" | "text";
  extractor: string;
  status: PurchaseRequest["status"];
  route: PurchaseRequest["evaluation"]["route"];
  policy_version: string;
  risk_level: PurchaseRequest["evaluation"]["riskLevel"];
  pages: PurchaseRequest["pages"];
  terms: PurchaseRequest["terms"];
  created_at: Date;
  updated_at: Date;
}

interface EventRow {
  id: string;
  request_id: string;
  at: Date;
  reviewer: string;
  action: AuditEvent["action"];
  from_status: AuditEvent["fromStatus"];
  to_status: AuditEvent["toStatus"];
  comment: string | null;
}

const toEvent = (r: EventRow): AuditEvent => ({
  id: r.id,
  requestId: r.request_id,
  at: r.at.toISOString(),
  reviewer: r.reviewer,
  action: r.action,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  comment: r.comment,
});

const SUMMARY_COLS = "id, title, source_name, source_type, extractor, status, route, risk_level, policy_version, terms, created_at, updated_at";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
}

export class PgStore implements Store {
  constructor(private readonly pool: pg.Pool) {}

  private async flagsFor(ids: string[]): Promise<Map<string, RiskFlag[]>> {
    const map = new Map<string, RiskFlag[]>();
    if (ids.length === 0) return map;
    const { rows } = await this.pool.query<{ request_id: string } & Record<string, string>>(
      "SELECT request_id, rule_id, severity, route, message FROM risk_flags WHERE request_id = ANY($1) ORDER BY id",
      [ids],
    );
    for (const r of rows) {
      const list = map.get(r.request_id) ?? [];
      list.push({ ruleId: r.rule_id, severity: r.severity as RiskFlag["severity"], route: r.route as RiskFlag["route"], message: r.message });
      map.set(r.request_id, list);
    }
    return map;
  }

  private summary(r: RequestRow, flags: RiskFlag[], hasDocument: boolean): RequestSummary {
    return {
      id: r.id,
      title: r.title,
      sourceName: r.source_name,
      sourceType: r.source_type,
      hasDocument,
      extractor: r.extractor,
      terms: r.terms,
      evaluation: { policyVersion: r.policy_version, flags, route: r.route, riskLevel: r.risk_level },
      status: r.status,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  async list(filter: ListFilter = {}): Promise<RequestSummary[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) where.push(`status = $${params.push(filter.status)}`);
    if (filter.route) where.push(`route = $${params.push(filter.route)}`);
    if (filter.q) where.push(`(title ILIKE $${params.push(`%${filter.q.replace(/[%_\\]/g, "\\$&")}%`)} OR source_name ILIKE $${params.length})`);
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT ${SUMMARY_COLS} FROM requests ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, id`,
      params,
    );
    const flags = await this.flagsFor(rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, flags.get(r.id) ?? [], true));
  }

  async get(id: string): Promise<PurchaseRequest | null> {
    const { rows } = await this.pool.query<RequestRow>(`SELECT ${SUMMARY_COLS}, pages FROM requests WHERE id = $1`, [id]);
    if (rows.length === 0) return null;
    const flags = await this.flagsFor([id]);
    return { ...this.summary(rows[0], flags.get(id) ?? [], true), pages: rows[0].pages };
  }

  async insert(request: PurchaseRequest, document: StoredDocument): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `INSERT INTO requests (id, title, source_name, source_type, extractor, status, route, risk_level, policy_version, pages, terms, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) ON CONFLICT (id) DO NOTHING`,
        [
          request.id,
          request.title,
          request.sourceName,
          request.sourceType,
          request.extractor,
          request.status,
          request.evaluation.route,
          request.evaluation.riskLevel,
          request.evaluation.policyVersion,
          JSON.stringify(request.pages),
          JSON.stringify(request.terms),
          request.createdAt,
        ],
      );
      if (res.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "INSERT INTO documents (request_id, file_name, content_type, size_bytes, content) VALUES ($1,$2,$3,$4,$5)",
        [request.id, document.fileName, document.contentType, document.bytes.length, Buffer.from(document.bytes)],
      );
      for (const f of request.evaluation.flags) {
        await client.query("INSERT INTO risk_flags (request_id, rule_id, severity, route, message) VALUES ($1,$2,$3,$4,$5)", [
          request.id,
          f.ruleId,
          f.severity,
          f.route,
          f.message,
        ]);
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async decide(id: string, input: DecisionInput): Promise<{ request: PurchaseRequest; event: AuditEvent }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Row lock: two reviewers deciding at the same time are serialised, the second one sees the new status.
      const cur = await client.query<{ status: PurchaseRequest["status"] }>("SELECT status FROM requests WHERE id = $1 FOR UPDATE", [id]);
      if (cur.rowCount === 0) throw new StoreError("not_found", "Request not found");
      const from = cur.rows[0].status;
      if (!DECIDABLE.includes(from)) throw new StoreError("conflict", `Request is already ${from}`);
      const to = DECISION_STATUS[input.decision];
      await client.query("UPDATE requests SET status = $2, updated_at = now() WHERE id = $1", [id, to]);
      const ev = await client.query<EventRow>(
        `INSERT INTO audit_events (request_id, reviewer, action, from_status, to_status, comment)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, request_id, at, reviewer, action, from_status, to_status, comment`,
        [id, input.reviewer, input.decision, from, to, input.comment],
      );
      await client.query("COMMIT");
      const request = await this.get(id);
      return { request: request!, event: toEvent(ev.rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async events(requestId?: string): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT id, request_id, at, reviewer, action, from_status, to_status, comment FROM audit_events
       ${requestId ? "WHERE request_id = $1" : ""} ORDER BY seq DESC`,
      requestId ? [requestId] : [],
    );
    return rows.map(toEvent);
  }

  async document(id: string): Promise<StoredDocument | null> {
    const { rows } = await this.pool.query<{ file_name: string; content_type: string; content: Buffer }>(
      "SELECT file_name, content_type, content FROM documents WHERE request_id = $1",
      [id],
    );
    if (rows.length === 0) return null;
    return { fileName: rows[0].file_name, contentType: rows[0].content_type, bytes: new Uint8Array(rows[0].content) };
  }

  async count(): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>("SELECT count(*) AS n FROM requests");
    return Number(rows[0].n);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
