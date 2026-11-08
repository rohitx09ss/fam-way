import { useEffect, useState } from "react";
import { when } from "../components";

export default function Settings({ call }) {
  const [f, setF] = useState(null);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState({ t: "", ok: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => { call("/merchant/settings").then(setF).catch((e) => setMsg({ t: e.message, ok: false })); }, [call]);
  if (!f) return <p className="empty">{msg.t || "Loading…"}</p>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault(); setBusy(true); setMsg({ t: "", ok: true });
    try {
      const body = { ...f, app_password: pw || undefined };
      setF(await call("/merchant/settings", { method: "PUT", body })); setPw("");
      setMsg({ t: "Settings saved.", ok: true });
    } catch (ex) { setMsg({ t: ex.message, ok: false }); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { const r = await call("/merchant/settings/test-imap", { method: "POST" }); setMsg({ t: r.message, ok: r.ok }); }
    catch (ex) { setMsg({ t: ex.message, ok: false }); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><h1>Settings</h1><p>Where payments go, and which inbox we watch for payment alerts.</p></div>
      <form className="panel" style={{ maxWidth: 560 }} onSubmit={save}>
        <h2>Store</h2>
        <label>Store name</label><input value={f.store_name} onChange={set("store_name")} />
        <label>UPI ID</label><input value={f.upi_id} onChange={set("upi_id")} placeholder="name@bank" />
        <h2 style={{ marginTop: 28 }}>Payment alert inbox</h2>
        <label>Gmail address</label><input type="email" value={f.gmail_address} onChange={set("gmail_address")} />
        <label>Gmail app password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password"
               placeholder={f.has_app_password ? "Saved. Type to replace it" : "16-character app password"} />
        <p className="hint">Create it in your Google account under App passwords (needs 2-step verification). It is stored encrypted and never shown again.</p>
        <p className="hint">Only emails from FamPay's official sender address, with a valid sender signature, are used. Everything else is ignored.</p>
        <label>IMAP server</label><input value={f.imap_host} onChange={set("imap_host")} />
        <label className="check"><input type="checkbox" checked={f.is_enabled} onChange={set("is_enabled")} /> Watch this inbox for payments</label>
        {f.last_poll_at && <p className="hint">Last checked {when(f.last_poll_at)}{f.last_error ? ` · ${f.last_error}` : ""}</p>}
        {msg.t && <p className={msg.ok ? "okmsg" : "err"}>{msg.t}</p>}
        <div className="row">
          <button className="btn" disabled={busy}>Save settings</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={test}>Test inbox connection</button>
        </div>
      </form>
    </>
  );
}
