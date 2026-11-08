import { useCallback, useState } from "react";
import { Inbox, LayoutDashboard, LogOut, Settings as Cog } from "lucide-react";
import { api } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Review from "./pages/Review";

const KEY = "merchant_auth";
const NAV = [
  ["dashboard", "Payments", LayoutDashboard],
  ["review", "Email review", Inbox],
  ["settings", "Settings", Cog],
];

export default function App() {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  });
  const [page, setPage] = useState("dashboard");

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
        <div className="brand">Merchant panel<small>{auth.email}</small></div>
        {NAV.map(([id, label, Icon]) => (
          <button key={id} className={`nav ${page === id ? "on" : ""}`} onClick={() => setPage(id)}>
            <Icon size={18} strokeWidth={1.8} /> {label}
          </button>
        ))}
        <button className="nav out" onClick={logout}><LogOut size={18} strokeWidth={1.8} /> Sign out</button>
      </aside>
      <main className="main">
        {page === "dashboard" && <Dashboard call={call} />}
        {page === "review" && <Review call={call} />}
        {page === "settings" && <Settings call={call} />}
      </main>
    </div>
  );
}
