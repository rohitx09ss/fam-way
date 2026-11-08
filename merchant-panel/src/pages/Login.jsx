import { useState } from "react";
import { api } from "../api";

export default function Login({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ email: "", password: "", store_name: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const body = mode === "login" ? { email: f.email, password: f.password } : f;
      onAuth(await api(mode === "login" ? "/auth/merchant/login" : "/auth/merchant/register", { method: "POST", body }));
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-art">
        <h1>Collect UPI payments with a QR that expires on time.</h1>
        <p>Each QR carries a fixed amount and a five-minute window. Payments are matched to the right QR, never guessed.</p>
      </div>
      <form className="login-form" onSubmit={submit}>
        <h2>{mode === "login" ? "Sign in to your store" : "Create your account"}</h2>
        {mode === "register" && (<><label>Store name</label><input value={f.store_name} onChange={set("store_name")} /></>)}
        <label>Email</label><input type="email" required value={f.email} onChange={set("email")} autoComplete="email" />
        <label>Password</label>
        <input type="password" required minLength={mode === "login" ? 1 : 8} value={f.password} onChange={set("password")}
               autoComplete={mode === "login" ? "current-password" : "new-password"} />
        {err && <p className="err">{err}</p>}
        <div className="row">
          <button className="btn" disabled={busy}>{busy ? "Connecting…" : mode === "login" ? "Sign in" : "Create account"}</button>
          <button type="button" className="link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }}>
            {mode === "login" ? "I need an account" : "I already have an account"}
          </button>
        </div>
        {busy && <p className="hint">The server may take up to 30 seconds to wake up after being idle.</p>}
      </form>
    </div>
  );
}
