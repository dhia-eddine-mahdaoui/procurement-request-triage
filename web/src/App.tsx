import { useEffect, useState } from "react";
import type { AuditEvent, Decision, PurchaseRequest, RequestStatus, TermKey } from "../../src/types";
import { TERM_LABELS, formatTerm } from "../../src/format";
import { api, type RequestDetail } from "./api";

type Tab = "requests" | "audit";

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
};

const ROUTE_LABEL: Record<string, string> = {
  requester: "Requester (complete quote)",
  procurement: "Procurement",
  finance: "Finance approval",
  legal: "Legal review",
};

const TERM_ORDER: TermKey[] = [
  "vendor",
  "amount",
  "termMonths",
  "autoRenew",
  "noticeDays",
  "liabilityCap",
  "dpaPresent",
  "paymentTermsDays",
];

export default function App() {
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const [reqs, events] = await Promise.all([api.listRequests(), api.listAudit()]);
      setRequests(reqs);
      setAudit(events);
      setError(null);
      setSelectedId((cur) => (cur && reqs.some((r) => r.id === cur) ? cur : (reqs[0]?.id ?? null)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Purchase request triage</h1>
          <p className="muted">Extracted contract terms, policy flags and approval routing for vendor quotes.</p>
        </div>
        <nav className="tabs">
          <button className={tab === "requests" ? "tab active" : "tab"} onClick={() => setTab("requests")}>
            Requests ({requests.length})
          </button>
          <button className={tab === "audit" ? "tab active" : "tab"} onClick={() => setTab("audit")}>
            Audit log ({audit.length})
          </button>
        </nav>
      </header>

      {error && <div className="banner error">Cannot reach the API: {error}</div>}

      {tab === "requests" ? (
        <div className="layout">
          <aside className="list">
            <NewRequestForm onCreated={async (id) => { await reload(); setSelectedId(id); }} />
            {requests.map((r) => (
              <button
                key={r.id}
                className={`row ${r.id === selectedId ? "selected" : ""}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span className="row-title">{r.title}</span>
                <span className="row-meta">
                  <RiskBadge level={r.evaluation.riskLevel} /> {ROUTE_LABEL[r.evaluation.route]}
                </span>
                <span className={`status status-${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </button>
            ))}
            {requests.length === 0 && !error && <p className="muted">No requests yet.</p>}
          </aside>
          <main className="detail">
            {selectedId ? (
              <RequestView key={selectedId} id={selectedId} onChanged={reload} />
            ) : (
              <p className="muted">Select a request.</p>
            )}
          </main>
        </div>
      ) : (
        <AuditTable events={audit} requests={requests} />
      )}
    </div>
  );
}

function RiskBadge({ level }: { level: PurchaseRequest["evaluation"]["riskLevel"] }) {
  return <span className={`risk risk-${level}`}>risk: {level}</span>;
}

function NewRequestForm({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const created = await api.createRequest(text, "pasted-quote.txt");
      setText("");
      setOpen(false);
      await onCreated(created.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        + Triage pasted quote text
      </button>
    );
  }
  return (
    <div className="new-request">
      <textarea
        rows={6}
        placeholder="Paste vendor quote or contract text"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {err && <div className="banner error">{err}</div>}
      <div className="actions">
        <button onClick={submit} disabled={busy || text.trim().length === 0}>
          {busy ? "Extracting..." : "Extract and triage"}
        </button>
        <button className="secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function RequestView({ id, onChanged }: { id: string; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setDetail(await api.getRequest(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return <p className="muted">Loading...</p>;
  const { request, events } = detail;
  const { terms, evaluation } = request;

  return (
    <div className="request">
      <div className="request-head">
        <div>
          <h2>{request.title}</h2>
          <p className="muted">
            Source: {request.sourceName} · extractor: {request.extractor}
          </p>
        </div>
        <div className="badges">
          <span className={`status status-${request.status}`}>{STATUS_LABEL[request.status]}</span>
          <RiskBadge level={evaluation.riskLevel} />
        </div>
      </div>

      <section className="card">
        <h3>Approval route</h3>
        <p className="route">{ROUTE_LABEL[evaluation.route]}</p>
      </section>

      <section className="card">
        <h3>Risk flags</h3>
        {evaluation.flags.length === 0 ? (
          <p className="muted">No policy flags.</p>
        ) : (
          <ul className="flags">
            {evaluation.flags.map((f) => (
              <li key={f.ruleId} className={`flag flag-${f.severity}`}>
                <strong>{f.ruleId}</strong> ({f.severity}, routes to {f.route}): {f.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Extracted terms</h3>
        <table className="terms">
          <thead>
            <tr>
              <th>Term</th>
              <th>Value</th>
              <th>Source in document</th>
            </tr>
          </thead>
          <tbody>
            {TERM_ORDER.map((key) => {
              const ev = terms[key];
              const missing = ev.value === null;
              return (
                <tr key={key} className={missing ? "missing" : undefined}>
                  <td>{TERM_LABELS[key]}</td>
                  <td>{formatTerm(key, ev.value)}</td>
                  <td>{ev.snippet ? <q>{ev.snippet}</q> : <span className="muted">none</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <DecisionForm
        requestId={id}
        onDecided={async () => {
          await load();
          await onChanged();
        }}
      />

      <section className="card">
        <h3>Decision history</h3>
        {events.length === 0 ? (
          <p className="muted">No decisions yet.</p>
        ) : (
          <ul className="history">
            {events.map((e) => (
              <li key={e.id}>
                <code>{e.at}</code> {e.reviewer}: {e.action} ({e.fromStatus} to {e.toStatus})
                {e.comment && <div className="comment">{e.comment}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="card">
        <summary>Full document text</summary>
        <pre>{request.text}</pre>
      </details>
    </div>
  );
}

function DecisionForm({ requestId, onDecided }: { requestId: string; onDecided: () => Promise<void> }) {
  const [reviewer, setReviewer] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decide = async (decision: Decision) => {
    setErr(null);
    if (decision !== "approve" && comment.trim().length === 0) {
      setErr("A comment is required to reject or request changes.");
      return;
    }
    setBusy(true);
    try {
      await api.decide(requestId, decision, reviewer.trim(), comment.trim());
      setComment("");
      await onDecided();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h3>Decision</h3>
      <label>
        Reviewer name
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. Finance reviewer" />
      </label>
      <label>
        Comment <span className="muted">(required for reject and request changes)</span>
        <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      {err && <div className="banner error">{err}</div>}
      <div className="actions">
        <button disabled={busy || reviewer.trim() === ""} onClick={() => decide("approve")}>
          Approve
        </button>
        <button className="secondary" disabled={busy || reviewer.trim() === ""} onClick={() => decide("request_changes")}>
          Request changes
        </button>
        <button className="danger" disabled={busy || reviewer.trim() === ""} onClick={() => decide("reject")}>
          Reject
        </button>
      </div>
    </section>
  );
}

function AuditTable({ events, requests }: { events: AuditEvent[]; requests: PurchaseRequest[] }) {
  const titles = new Map(requests.map((r) => [r.id, r.title]));
  return (
    <section className="card">
      <h2>Audit log</h2>
      {events.length === 0 ? (
        <p className="muted">No decisions recorded yet.</p>
      ) : (
        <table className="terms">
          <thead>
            <tr>
              <th>When</th>
              <th>Request</th>
              <th>Reviewer</th>
              <th>Decision</th>
              <th>Status change</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.at).toLocaleString()}</td>
                <td>{titles.get(e.requestId) ?? e.requestId}</td>
                <td>{e.reviewer}</td>
                <td>{e.action}</td>
                <td>
                  {e.fromStatus} to {e.toStatus}
                </td>
                <td>{e.comment ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
