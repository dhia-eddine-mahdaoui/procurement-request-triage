import type { AuditEvent, Decision, PurchaseRequest } from "../../src/types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

export interface RequestDetail {
  request: PurchaseRequest;
  events: AuditEvent[];
}

export const api = {
  listRequests: () => call<PurchaseRequest[]>("/api/requests"),
  listAudit: () => call<AuditEvent[]>("/api/audit"),
  getRequest: (id: string) => call<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`),
  decide: (id: string, decision: Decision, reviewer: string, comment: string) =>
    call<{ request: PurchaseRequest; event: AuditEvent }>(`/api/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, reviewer, comment }),
    }),
  createRequest: (text: string, sourceName: string) =>
    call<PurchaseRequest>("/api/requests", { method: "POST", body: JSON.stringify({ text, sourceName }) }),
};
