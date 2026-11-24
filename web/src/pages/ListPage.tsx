import { useEffect, useState } from "react";
import type { RequestStatus, RequestSummary, Route } from "../../../src/types";
import { formatTerm } from "../../../src/format";
import { api, type Filters } from "../api";
import { fmtDate, RiskBadge, RouteBadge, ROUTE_LABEL, StatusBadge, STATUS_LABEL } from "../ui";

const ROUTES: Route[] = ["procurement", "finance", "legal", "requester"];
const STATUSES: RequestStatus[] = ["pending", "changes_requested", "approved", "rejected"];

export function ListPage() {
  const [filters, setFilters] = useState<Filters>({});
  const [rows, setRows] = useState<RequestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .listRequests(filters)
        .then((r) => !cancelled && (setRows(r), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message));
    }, filters.q ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [filters]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <>
      <div className="page-head">
        <h1>Requests</h1>
        <p className="muted">Vendor quotes read from PDF, checked against policy and routed to the right approver.</p>
      </div>

      <div className="filters" role="search">
        <input
          type="search"
          placeholder="Search vendor or file name"
          aria-label="Search"
          value={filters.q ?? ""}
          onChange={(e) => set({ q: e.target.value })}
        />
        <div className="chips" role="group" aria-label="Filter by approver route">
          <button className={!filters.route ? "chip on" : "chip"} onClick={() => set({ route: "" })}>
            All routes
          </button>
          {ROUTES.map((r) => (
            <button key={r} className={filters.route === r ? "chip on" : "chip"} onClick={() => set({ route: filters.route === r ? "" : r })}>
              {ROUTE_LABEL[r]}
            </button>
          ))}
        </div>
        <select aria-label="Filter by status" value={filters.status ?? ""} onChange={(e) => set({ status: e.target.value as RequestStatus | "" })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="banner error">Cannot reach the API: {error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="num">Total value</th>
              <th>Approver route</th>
              <th>Risk</th>
              <th>Flags</th>
              <th>Status</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="row" onClick={() => (window.location.hash = `/requests/${encodeURIComponent(r.id)}`)}>
                <td>
                  <a className="vendor" href={`#/requests/${encodeURIComponent(r.id)}`} onClick={(e) => e.stopPropagation()}>
                    {r.title}
                  </a>
                  <div className="muted small">{r.sourceName}</div>
                </td>
                <td className="num">{r.terms.amount.value ? formatTerm("amount", r.terms.amount.value) : <span className="missing">not found</span>}</td>
                <td>
                  <RouteBadge route={r.evaluation.route} />
                </td>
                <td>
                  <RiskBadge level={r.evaluation.riskLevel} />
                </td>
                <td>{r.evaluation.flags.length}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="muted small">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No requests match these filters.
                </td>
              </tr>
            )}
            {!rows && !error && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows && <p className="muted small count">{rows.length} request{rows.length === 1 ? "" : "s"}</p>}
    </>
  );
}
