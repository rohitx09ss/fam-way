import { useState } from "react";
import { api } from "../api";

export default function Login({ onAuth }) {
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { onAuth(await api("/auth/admin/login", { method: "POST", body: f })); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <div className="login-art">
        <h1>Run the gateway behind every merchant.</h1>
        <p>Add merchants, watch payment flow across all stores, and read the audit trail.</p>
      </div>
      <form className="login-form" onSubmit={submit}>
        <h2>Admin sign in</h2>
        <label>Email</label>
        <input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" />
        <label>Password</label>
        <input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" />
        {err && <p className="err">{err}</p>}
        <div className="row"><button className="btn" disabled={busy}>{busy ? "Connecting…" : "Sign in"}</button></div>
        {busy && <p className="hint">The server may take up to 30 seconds to wake up after being idle.</p>}
      </form>
    </div>
  );
}
