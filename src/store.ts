import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { AuditEvent, PurchaseRequest } from "./types.js";

interface StoreState {
  requests: PurchaseRequest[];
  events: AuditEvent[];
}

/**
 * JSON-file persistence (zero setup). Sits behind a small interface so a Postgres
 * implementation can replace it without touching the API or the policy engine.
 */
export class FileStore {
  private state: StoreState;

  constructor(private readonly file: string) {
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as StoreState)
      : { requests: [], events: [] };
  }

  listRequests(): PurchaseRequest[] {
    return [...this.state.requests];
  }

  getRequest(id: string): PurchaseRequest | null {
    return this.state.requests.find((r) => r.id === id) ?? null;
  }

  saveRequest(request: PurchaseRequest): void {
    const i = this.state.requests.findIndex((r) => r.id === request.id);
    if (i >= 0) this.state.requests[i] = request;
    else this.state.requests.push(request);
    this.persist();
  }

  appendEvent(event: Omit<AuditEvent, "id" | "at">): AuditEvent {
    const full: AuditEvent = { ...event, id: randomUUID(), at: new Date().toISOString() };
    this.state.events.push(full);
    this.persist();
    return full;
  }

  listEvents(requestId?: string): AuditEvent[] {
    const events = requestId ? this.state.events.filter((e) => e.requestId === requestId) : this.state.events;
    return [...events].reverse();
  }

  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }
}
