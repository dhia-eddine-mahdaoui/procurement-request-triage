import { useEffect, useState } from "react";
import { AuditPage } from "./pages/AuditPage";
import { DetailPage } from "./pages/DetailPage";
import { IntakePage } from "./pages/IntakePage";
import { ListPage } from "./pages/ListPage";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function go(path: string): void {
  window.location.hash = path;
}

export default function App() {
  const route = useHashRoute();
  const detail = /^\/requests\/(.+)$/.exec(route);
  const section = detail || route === "/" ? "requests" : route === "/new" ? "new" : route === "/audit" ? "audit" : "requests";

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>
            Procurement triage
            <small>Quote intake, policy checks and approvals</small>
          </span>
        </a>
        <nav className="nav" aria-label="Main">
          <a href="#/" className={section === "requests" ? "active" : ""}>
            Requests
          </a>
          <a href="#/audit" className={section === "audit" ? "active" : ""}>
            Audit log
          </a>
          <a href="#/new" className={section === "new" ? "cta active" : "cta"}>
            + New request
          </a>
        </nav>
      </header>
      <main className="main">
        {detail ? <DetailPage id={decodeURIComponent(detail[1])} /> : route === "/new" ? <IntakePage /> : route === "/audit" ? <AuditPage /> : <ListPage />}
      </main>
    </div>
  );
}
