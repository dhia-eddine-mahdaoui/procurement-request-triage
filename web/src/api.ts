import type { AuditEvent, Decision, PurchaseRequest, RequestStatus, RequestSummary, Route } from "../../src/types";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface RequestDetail {
  request: PurchaseRequest;
  events: AuditEvent[];
}

export interface Filters {
  status?: RequestStatus | "";
  route?: Route | "";
  q?: string;
}

export function documentUrl(id: string): string {
  return `/api/requests/${encodeURIComponent(id)}/document`;
}

/** Reads a File as base64 without the data-URL prefix. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export const api = {
  listRequests: (f: Filters = {}) => {
    const p = new URLSearchParams();
    if (f.status) p.set("status", f.status);
    if (f.route) p.set("route", f.route);
    if (f.q?.trim()) p.set("q", f.q.trim());
    const qs = p.toString();
    return call<RequestSummary[]>(`/api/requests${qs ? `?${qs}` : ""}`);
  },
  listAudit: () => call<AuditEvent[]>("/api/audit"),
  getRequest: (id: string) => call<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`),
  decide: (id: string, decision: Decision, reviewer: string, comment: string) =>
    call<{ request: PurchaseRequest; event: AuditEvent }>(`/api/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, reviewer, comment }),
    }),
  uploadFile: async (file: File) =>
    call<PurchaseRequest>("/api/requests", { method: "POST", body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file) }) }),
  createFromText: (text: string, fileName: string) =>
    call<PurchaseRequest>("/api/requests", { method: "POST", body: JSON.stringify({ text, fileName }) }),
};
