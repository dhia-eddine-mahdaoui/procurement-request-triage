import { useRef, useState, type DragEvent } from "react";
import { api } from "../api";
import { Card } from "../ui";

const MAX_MB = 5;

export function IntakePage() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) return setError(`The file is larger than ${MAX_MB} MB.`);
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    pick(e.dataTransfer.files[0]);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = mode === "pdf" ? await api.uploadFile(file!) : await api.createFromText(text, "pasted-quote.txt");
      window.location.hash = `/requests/${encodeURIComponent(created.id)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === "pdf" ? file !== null : text.trim().length > 0;

  return (
    <>
      <div className="page-head">
        <h1>New request</h1>
        <p className="muted">Upload a vendor quote or contract. Terms are extracted with their source text, checked against policy and routed.</p>
      </div>

      <div className="narrow">
        <Card
          title="Vendor document"
          aside={
            <div className="seg" role="tablist" aria-label="Input type">
              <button role="tab" aria-selected={mode === "pdf"} className={mode === "pdf" ? "on" : ""} onClick={() => setMode("pdf")}>
                PDF
              </button>
              <button role="tab" aria-selected={mode === "text"} className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>
                Paste text
              </button>
            </div>
          }
        >
          <div className="pad">
            {mode === "pdf" ? (
              <div
                className={drag ? "drop over" : file ? "drop filled" : "drop"}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                onClick={() => input.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              >
                <input ref={input} type="file" accept="application/pdf,.pdf,.txt,text/plain" hidden onChange={(e) => pick(e.target.files?.[0])} />
                {file ? (
                  <>
                    <div className="file-icon">PDF</div>
                    <strong>{file.name}</strong>
                    <span className="muted small">{(file.size / 1024).toFixed(1)} KB. Click to choose another file.</span>
                  </>
                ) : (
                  <>
                    <div className="file-icon dim">PDF</div>
                    <strong>Drop a PDF here, or click to browse</strong>
                    <span className="muted small">Text-based PDFs up to {MAX_MB} MB. Scanned images are not supported yet.</span>
                  </>
                )}
              </div>
            ) : (
              <textarea
                rows={10}
                placeholder={"Supplier: Example Ltd\nTotal price: EUR 12,000\nTerm: 12 months\n..."}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Quote text"
              />
            )}

            {error && <div className="banner error">{error}</div>}

            <div className="actions">
              <button className="btn primary" disabled={!ready || busy} onClick={() => void submit()}>
                {busy ? "Reading document..." : "Extract and triage"}
              </button>
              <a className="btn ghost" href="#/">
                Cancel
              </a>
            </div>
          </div>
        </Card>
        <p className="muted small">
          Each extracted value keeps the sentence and page it came from. Missing terms stay empty rather than being guessed.
        </p>
      </div>
    </>
  );
}
