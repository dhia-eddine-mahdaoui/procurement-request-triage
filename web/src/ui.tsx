import type { ReactNode } from "react";
import type { RequestStatus, Route, Severity } from "../../src/types";

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};

export const ROUTE_LABEL: Record<Route, string> = {
  requester: "Back to requester",
  procurement: "Procurement",
  finance: "Finance",
  legal: "Legal",
};

export const ACTION_LABEL = { approve: "Approved", reject: "Rejected", request_changes: "Requested changes" } as const;

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function RouteBadge({ route }: { route: Route }) {
  return <span className={`badge route-${route}`}>{ROUTE_LABEL[route]}</span>;
}

export function RiskBadge({ level }: { level: Severity | "none" }) {
  return <span className={`badge risk-${level}`}>{level === "none" ? "No flags" : `${level} risk`}</span>;
}

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
