import { useCallback, useEffect, useState } from "react";
import { Check, QrCode, X } from "lucide-react";
import { Badge, Table, clock, money, useRemaining, when } from "../components";

const DONE = ["VERIFIED", "EXPIRED", "FAILED"];

function QrPanel({ p, onDecide, busy }) {
  const left = useRemaining(p.expires_at, p.server_time);
  const total = new Date(p.expires_at) - new Date(p.created_at);
  const waiting = p.status === "WAITING_FOR_PAYMENT" || p.status === "CREATED";
  const live = waiting && left > 0;
  return (
    <div className="panel qr">
      <div className="amount">{money(p.amount)}</div>
      <p className="ref">Reference {p.reference}</p>
      {p.payer_name && <p className="payer">Paid by <b>{p.payer_name}</b></p>}
      {live && <img className="qr-img" alt={`UPI QR for ${money(p.amount)}`} src={p.qr_data_url} />}
      {live && (<>
        <div className="timer">{clock(left)}</div>
        <div className="bar"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
        <p className="hint">Scan with any UPI app. Pay exactly this amount before the timer ends.</p>
      </>)}
      {!live && p.status === "WAITING_FOR_PAYMENT" && <p className="notice">Time is up. Checking the server…</p>}
      {p.status === "PAYMENT_DETECTED" && (<>
        <p className="notice">{p.display_status}</p>
        <p className="hint">An email alert arrived (txn {p.transaction_id}), but no bank source has confirmed it. Check your bank app or statement, then decide.</p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => onDecide(p, "confirm")}><Check size={16} /> Mark as verified</button>
          <button className="btn danger" disabled={busy} onClick={() => onDecide(p, "reject")}><X size={16} /> Not received</button>
        </div>
      </>)}
      {p.status === "VERIFYING" && <p className="notice">Verifying with your bank source…</p>}
      {p.status === "VERIFIED" && <p className="notice ok">Payment verified. {p.verification_note}</p>}
      {p.status === "EXPIRED" && <p className="notice bad">This QR expired. Create a new one.</p>}
      {p.status === "FAILED" && <p className="notice bad">{p.verification_note || "Verification failed."}</p>}
      {p.status === "REVIEW_REQUIRED" && <p className="notice bad">A payment arrived after expiry. Open Email review to resolve it.</p>}
    </div>
  );
}

export default function Dashboard({ call }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(null);
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([call("/merchant/stats"), call("/merchant/payments")]);
    setStats(s); setRows(r);
  }, [call]);

  useEffect(() => {
    load().catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!active || DONE.includes(active.status)) return;
    const t = setInterval(async () => {
      try { setActive(await call(`/merchant/payments/${active.id}`)); } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, [active?.id, active?.status, call]);

  async function create(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      setActive(await call("/merchant/payments", { method: "POST", body: { amount: Number(amount) } }));
      setAmount(""); load().catch(() => {});
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  async function decide(p, action) {
    setBusy(true);
    try { await call(`/merchant/payments/${p.id}/${action}`, { method: "POST" }); setActive(await call(`/merchant/payments/${p.id}`)); load(); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  const s = stats || {};
  return (
    <>
      <div className="page-head"><h1>Payments</h1><p>Create a QR, watch it get paid, and review every request.</p></div>
      <div className="stats">
        <div className="stat big"><span>Verified</span><b>{money(s.verified_amount)}</b><span>{s.verified ?? 0} payments</span></div>
        <div className="stat"><span>Waiting</span><b>{s.pending ?? 0}</b></div>
        <div className="stat"><span>Detected, unconfirmed</span><b>{s.detected ?? 0}</b></div>
        <div className="stat"><span>Expired / failed</span><b>{(s.expired ?? 0) + (s.failed ?? 0)}</b></div>
      </div>
      <div className="cols">
        <div>
          <form className="panel" onSubmit={create}>
            <h2>New QR</h2>
            <label htmlFor="amt">Amount (INR)</label>
            <input id="amt" type="number" min="1" max="100000" step="0.01" required inputMode="decimal"
                   value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" />
            {err && <p className="err">{err}</p>}
            <div className="row"><button className="btn" disabled={busy}><QrCode size={16} /> Generate QR</button></div>
          </form>
          {active && <div style={{ marginTop: 18 }}><QrPanel p={active} onDecide={decide} busy={busy} /></div>}
        </div>
        <div className="panel">
          <h2>History</h2>
          <Table rows={rows} empty="No payment requests yet. Generate your first QR."
            onRow={async (r) => setActive(await call(`/merchant/payments/${r.id}`))}
            cols={[
              { key: "created_at", title: "Created", render: (r) => when(r.created_at) },
              { key: "amount", title: "Amount", num: true, render: (r) => money(r.amount) },
              { key: "reference", title: "Reference", render: (r) => <span className="ref">{r.reference}</span> },
              { key: "payer_name", title: "Paid by", render: (r) => r.payer_name || "—" },
              { key: "transaction_id", title: "Transaction ID", render: (r) => <span className="ref">{r.transaction_id || "—"}</span> },
              { key: "expires_at", title: "Expires", render: (r) => when(r.expires_at) },
              { key: "status", title: "Status", render: (r) => <Badge value={r.status} label={r.display_status} /> },
            ]} />
        </div>
      </div>
    </>
  );
}
