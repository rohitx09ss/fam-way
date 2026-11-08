import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Table, when } from "../components";

export default function Merchants({ call }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState({ email: "", password: "", store_name: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => call("/admin/merchants").then(setRows).catch(() => {}), [call]);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault(); setBusy(true); setErr("");
    try { await call("/admin/merchants", { method: "POST", body: f }); setF({ email: "", password: "", store_name: "" }); load(); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  async function patch(id, body) { try { await call(`/admin/merchants/${id}`, { method: "PATCH", body }); load(); } catch (ex) { setErr(ex.message); } }
  const reset = (r) => { const pw = window.prompt(`New password for ${r.email} (min 8 characters)`); if (pw) patch(r.id, { new_password: pw }); };

  return (
    <>
      <div className="page-head"><h1>Merchants</h1><p>Create accounts and switch stores on or off. Merchants add their own UPI and Gmail details.</p></div>
      <div className="split">
        <div className="panel">
          <Table rows={rows} empty="No merchants yet. Create the first one."
            cols={[
              { key: "email", title: "Merchant", render: (r) => <><b>{r.store_name || r.email}</b><div className="ref">{r.email}</div></> },
              { key: "upi_id", title: "UPI ID" },
              { key: "monitoring", title: "Inbox", render: (r) => r.last_error ? <span className="err">{r.last_error.slice(0, 40)}</span> : r.monitoring ? `Checked ${when(r.last_poll_at)}` : "Off" },
              { key: "payments", title: "QRs", num: true },
              { key: "is_active", title: "Account", render: (r) => (
                <span className="row" style={{ margin: 0, gap: 8 }}>
                  <button className={`btn ${r.is_active ? "danger" : ""}`} style={{ padding: "4px 10px" }} onClick={() => patch(r.id, { is_active: !r.is_active })}>
                    {r.is_active ? "Disable" : "Enable"}
                  </button>
                  <button className="link" onClick={() => reset(r)}>Reset password</button>
                </span>) },
            ]} />
        </div>
        <form className="panel" onSubmit={create}>
          <h2>New merchant</h2>
          <label>Store name</label><input value={f.store_name} onChange={(e) => setF({ ...f, store_name: e.target.value })} />
          <label>Email</label><input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <label>Temporary password</label><input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          {err && <p className="err">{err}</p>}
          <div className="row"><button className="btn" disabled={busy}><Plus size={16} /> Create merchant</button></div>
        </form>
      </div>
    </>
  );
}
