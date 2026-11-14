import { useCallback, useState } from "react";
import { LayoutDashboard, LogOut, Mail, ScrollText, Users, Wallet } from "lucide-react";
import { api } from "./api";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Merchants from "./pages/Merchants";
import Lists from "./pages/Lists";

const KEY = "admin_auth";
const NAV = [
  ["overview", "Overview", LayoutDashboard],
  ["merchants", "Merchants", Users],
  ["payments", "All payments", Wallet],
  ["emails", "Email events", Mail],
  ["audit", "Audit log", ScrollText],
];

export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  });
  const [page, setPage] = useState("overview");
  const logout = useCallback(() => { localStorage.removeItem(KEY); setAuth(null); }, []);
  const call = useCallback(
    (path, opts = {}) =>
      api(path, { ...opts, token: auth?.access_token }).catch((e) => {
        if (e.status === 401 || e.status === 403) logout();
        throw e;
      }),
    [auth, logout]
  );

  if (!auth) return <Login onAuth={(a) => { localStorage.setItem(KEY, JSON.stringify(a)); setAuth(a); }} />;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src="/fpay-logo.png" alt="F PAY" style={{ height: 32, width: "auto", display: "block" }} /><small>Admin · {auth.email}</small></div>
        {NAV.map(([id, label, Icon]) => (
          <button key={id} className={`nav ${page === id ? "on" : ""}`} onClick={() => setPage(id)}>
            <Icon size={18} strokeWidth={1.8} /> {label}
          </button>
        ))}
        <button className="nav out" onClick={logout}><LogOut size={18} strokeWidth={1.8} /> Sign out</button>
      </aside>
      <main className="main">
        {page === "overview" && <Overview call={call} />}
        {page === "merchants" && <Merchants call={call} />}
        {["payments", "emails", "audit"].includes(page) && <Lists key={page} kind={page} call={call} />}
      </main>
    </div>
  );
}
