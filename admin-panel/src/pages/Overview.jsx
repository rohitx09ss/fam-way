import { useEffect, useState } from "react";
import { Badge, money } from "../components";

export default function Overview({ call }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    const load = () => call("/admin/stats").then(setS).catch(() => {});
    load(); const t = setInterval(load, 8000); return () => clearInterval(t);
  }, [call]);
  if (!s) return <p className="empty">Loading…</p>;
  const p = s.payments_by_status || {};
  const n = (k) => p[k] || 0;
  return (
    <>
      <div className="page-head"><h1>Overview</h1><p>All merchants, all payment requests.</p></div>
      <div className="stats">
        <div className="stat big"><span>Verified volume</span><b>{money(s.verified_amount)}</b><span>{n("VERIFIED")} payments</span></div>
        <div className="stat"><span>Merchants</span><b>{s.active_merchants}/{s.merchants}</b><span>active</span></div>
        <div className="stat"><span>QR requests</span><b>{s.total_payments}</b></div>
        <div className="stat"><span>Need attention</span><b>{n("PAYMENT_DETECTED") + n("REVIEW_REQUIRED")}</b></div>
      </div>
      <div className="split">
        <div className="panel">
          <h2>Payments by status</h2>
          {Object.keys(p).length === 0 && <p className="empty">No payments yet.</p>}
          {Object.entries(p).map(([k, v]) => (
            <div key={k} className="row" style={{ marginTop: 0, padding: "9px 0", borderBottom: "1px solid var(--line)", justifyContent: "space-between" }}>
              <Badge value={k} label={k.replaceAll("_", " ").toLowerCase()} /><b>{v}</b>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>Email outcomes</h2>
          {Object.keys(s.events_by_outcome || {}).length === 0 && <p className="empty">No payment emails yet.</p>}
          {Object.entries(s.events_by_outcome || {}).map(([k, v]) => (
            <div key={k} className="row" style={{ marginTop: 0, padding: "9px 0", borderBottom: "1px solid var(--line)", justifyContent: "space-between" }}>
              <Badge value={k} /><b>{v}</b>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
