import { useEffect, useState } from "react";
import type { AuditEvent } from "../../../src/types";
import { api } from "../api";
import { ACTION_LABEL, fmtDate, STATUS_LABEL } from "../ui";

export function AuditEntries({ events, showRequest }: { events: AuditEvent[]; showRequest?: boolean }) {
  if (events.length === 0) return <p className="muted">No decisions recorded yet.</p>;
  return (
    <ol className="audit">
      {events.map((e) => (
        <li key={e.id}>
          <div className="audit-line">
            <strong>{e.reviewer}</strong> {ACTION_LABEL[e.action].toLowerCase()}
            {showRequest && (
              <>
                {" "}
                <a href={`#/requests/${encodeURIComponent(e.requestId)}`}>{e.requestId}</a>
              </>
            )}
            <span className="muted small"> · {fmtDate(e.at)}</span>
          </div>
          <div className="small muted">
            {STATUS_LABEL[e.fromStatus]} to {STATUS_LABEL[e.toStatus]}
          </div>
          {e.comment && <blockquote>{e.comment}</blockquote>}
        </li>
      ))}
    </ol>
  );
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  useEffect(() => {
    void api.listAudit().then(setEvents);
  }, []);
  return (
    <>
      <div className="page-head">
        <h1>Audit log</h1>
        <p className="muted">Every decision, newest first, with reviewer and comment.</p>
      </div>
      <div className="card pad">{events ? <AuditEntries events={events} showRequest /> : <p className="muted">Loading...</p>}</div>
    </>
  );
}
