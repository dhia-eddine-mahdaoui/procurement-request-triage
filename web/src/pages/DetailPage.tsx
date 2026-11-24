import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Decision, PurchaseRequest, TermKey } from "../../../src/types";
import { TERM_LABELS, formatTerm } from "../../../src/format";
import { api, documentUrl, type RequestDetail } from "../api";
import { AuditEntries } from "./AuditPage";
import { Card, fmtDate, RiskBadge, ROUTE_LABEL, RouteBadge, StatusBadge } from "../ui";

const TERM_ORDER: TermKey[] = ["vendor", "amount", "termMonths", "autoRenew", "noticeDays", "liabilityCap", "dpaPresent", "paymentTermsDays"];

interface Range {
  start: number;
  end: number;
  keys: TermKey[];
}

/** Finds each term's snippet in a paragraph of its page and merges terms that share the same sentence. */
function rangesFor(paragraph: string, page: number, req: PurchaseRequest): Range[] {
  const found: Range[] = [];
  for (const key of TERM_ORDER) {
    const ev = req.terms[key];
    if (!ev.snippet || ev.page !== page) continue;
    const start = paragraph.indexOf(ev.snippet);
    if (start < 0) continue;
    const end = start + ev.snippet.length;
    const same = found.find((r) => r.start === start && r.end === end);
    if (same) same.keys.push(key);
    else found.push({ start, end, keys: [key] });
  }
  return found.filter((r, i) => !found.some((o, j) => j < i && r.start < o.end && o.start < r.end)).sort((a, b) => a.start - b.start);
}

function Paragraph({ text, page, req, active, onPick }: { text: string; page: number; req: PurchaseRequest; active: TermKey | null; onPick: (k: TermKey) => void }) {
  const ranges = rangesFor(text, page, req);
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach((r, i) => {
    if (r.start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, r.start)}</Fragment>);
    const on = active !== null && r.keys.includes(active);
    parts.push(
      <mark
        key={`m${i}`}
        data-terms={r.keys.join(" ")}
        className={on ? "hl on" : "hl"}
        title={r.keys.map((k) => TERM_LABELS[k]).join(", ")}
        onClick={() => onPick(r.keys[0])}
      >
        {text.slice(r.start, r.end)}
        <span className="hl-tag">{r.keys.map((k) => TERM_LABELS[k]).join(" · ")}</span>
      </mark>,
    );
    at = r.end;
  });
  if (at < text.length) parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <p>{parts}</p>;
}

export function DetailPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<TermKey | null>(null);
  const source = useRef<HTMLDivElement>(null);

  const load = () =>
    api
      .getRequest(id)
      .then((d) => (setDetail(d), setError(null)))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    setDetail(null);
    void load();
  }, [id]);

  useEffect(() => {
    if (!active) return;
    // Scroll only the source panel, never the whole page.
    const box = source.current;
    const el = box?.querySelector<HTMLElement>(".hl.on");
    if (box && el) {
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTo({ top: top - box.clientHeight / 2, behavior: "smooth" });
    }
  }, [active]);

  if (error) return <div className="banner error">{error}</div>;
  if (!detail) return <p className="muted">Loading...</p>;
  const { request: r, events } = detail;

  return (
    <>
      <a className="back" href="#/">
        Back to requests
      </a>
      <div className="detail-head">
        <div>
          <h1>{r.title}</h1>
          <p className="muted">
            {r.sourceName} · received {fmtDate(r.createdAt)} · {r.pages.length} page{r.pages.length === 1 ? "" : "s"} · read by the {r.extractor} extractor
          </p>
        </div>
        <div className="head-badges">
          <StatusBadge status={r.status} />
          <RiskBadge level={r.evaluation.riskLevel} />
        </div>
      </div>

      <div className="detail-grid">
        <div className="col">
          <Card title="Extracted terms" aside={<span className="muted small">Click a row to see its source</span>}>
            <table className="terms">
              <tbody>
                {TERM_ORDER.map((k) => {
                  const ev = r.terms[k];
                  const missing = ev.value === null;
                  return (
                    <tr
                      key={k}
                      className={active === k ? "on" : ""}
                      onClick={() => ev.snippet && setActive(k)}
                      tabIndex={ev.snippet ? 0 : -1}
                      onKeyDown={(e) => e.key === "Enter" && ev.snippet && setActive(k)}
                    >
                      <th scope="row">{TERM_LABELS[k]}</th>
                      <td className={missing ? "missing" : "val"}>{formatTerm(k, ev.value)}</td>
                      <td className="src">{ev.page !== null ? <span className="pg">p.{ev.page}</span> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card title="Policy check" aside={<RouteBadge route={r.evaluation.route} />}>
            <div className="pad">
              <p className="route-line">
                Routed to <strong>{ROUTE_LABEL[r.evaluation.route]}</strong>
                <span className="muted small"> · policy {r.evaluation.policyVersion}</span>
              </p>
              {r.evaluation.flags.length === 0 ? (
                <p className="muted">No policy rules triggered.</p>
              ) : (
                <ul className="flags">
                  {r.evaluation.flags.map((f) => (
                    <li key={f.ruleId} className={`flag sev-${f.severity}`}>
                      <div>
                        <span className={`dot sev-${f.severity}`} aria-hidden="true" />
                        <code>{f.ruleId}</code>
                        <span className="muted small"> · {f.severity} · needs {f.route}</span>
                      </div>
                      <p>{f.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <DecisionCard request={r} onDone={() => void load()} />

          <Card title="Decision history">
            <div className="pad">
              <AuditEntries events={events} />
            </div>
          </Card>
        </div>

        <div className="col">
          <Card title="Source document" aside={<a className="small" href={documentUrl(r.id)} target="_blank" rel="noreferrer">Open original</a>}>
            <div className="source" ref={source}>
              {r.pages.map((p) => (
                <div className="page" key={p.page}>
                  <div className="page-label">Page {p.page}</div>
                  {p.paragraphs.map((text, i) => (
                    <Paragraph key={i} text={text} page={p.page} req={r} active={active} onPick={setActive} />
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function DecisionCard({ request, onDone }: { request: PurchaseRequest; onDone: () => void }) {
  const [reviewer, setReviewer] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decidable = request.status === "pending" || request.status === "changes_requested";
  const mustComment = useMemo(() => (d: Decision) => d !== "approve", []);

  const decide = async (d: Decision) => {
    setError(null);
    if (!reviewer.trim()) return setError("Enter your name so the decision can be attributed.");
    if (mustComment(d) && !comment.trim()) return setError("A comment is required when rejecting or requesting changes.");
    setBusy(true);
    try {
      await api.decide(request.id, d, reviewer, comment);
      setComment("");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Decision">
      <div className="pad">
        {!decidable ? (
          <p className="muted">
            This request is <strong>{request.status}</strong>; no further decision is possible.
          </p>
        ) : (
          <>
            <p className="muted small">
              Route: {ROUTE_LABEL[request.evaluation.route]}. Comments are required to reject or request changes.
            </p>
            <label>
              Reviewer
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" maxLength={80} />
            </label>
            <label>
              Comment
              <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reason for the decision" maxLength={2000} />
            </label>
            {error && <div className="banner error">{error}</div>}
            <div className="actions">
              <button className="btn approve" disabled={busy} onClick={() => void decide("approve")}>
                Approve
              </button>
              <button className="btn changes" disabled={busy} onClick={() => void decide("request_changes")}>
                Request changes
              </button>
              <button className="btn reject" disabled={busy} onClick={() => void decide("reject")}>
                Reject
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
