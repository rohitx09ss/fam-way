import { useCallback, useEffect, useState } from "react";
import { Badge, money, when } from "../components";

const OPEN_FOR_ASSIGN = ["WAITING_FOR_PAYMENT", "CREATED", "EXPIRED", "REVIEW_REQUIRED"];

function Assign({ ev, candidates, onDone, call }) {
  const [pid, setPid] = useState(ev.payment_id || "");
  const [err, setErr] = useState("");
  const opts = candidates.filter((p) => p.amount === ev.amount && !p.transaction_id && OPEN_FOR_ASSIGN.includes(p.status));
  async function go() {
    try { await call(`/merchant/events/${ev.id}/assign`, { method: "POST", body: { payment_id: Number(pid) } }); onDone(); }
    catch (e) { setErr(e.message); }
  }
  if (!opts.length) return <p className="hint">No open request with {money(ev.amount)} to assign this to.</p>;
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <select style={{ maxWidth: 300 }} value={pid} onChange={(e) => setPid(e.target.value)}>
        <option value="">Choose the QR this payment belongs to</option>
        {opts.map((p) => <option key={p.id} value={p.id}>{p.reference} · {when(p.created_at)}</option>)}
      </select>
      <button className="btn" disabled={!pid} onClick={go}>Assign payment</button>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

export default function Review({ call }) {
  const [events, setEvents] = useState([]);
  const [pays, setPays] = useState([]);
  const load = useCallback(async () => {
    const [e, p] = await Promise.all([call("/merchant/events"), call("/merchant/payments")]);
    setEvents(e); setPays(p);
  }, [call]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const need = events.filter((e) => e.reviewable);
  const rest = events.filter((e) => !e.reviewable);
  return (
    <>
      <div className="page-head"><h1>Email review</h1><p>Payment emails we could not safely match on our own. Nothing here is counted until you assign it.</p></div>
      <div className="panel">
        <h2>Needs your decision</h2>
        {!need.length && <p className="empty">Nothing to review.</p>}
        {need.map((e) => (
          <div key={e.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="row" style={{ marginTop: 0 }}>
              <b>{money(e.amount)}</b>{e.payer_name && <span>from {e.payer_name}</span>}<Badge value={e.outcome} /><span className="ref">txn {e.transaction_id} · {when(e.txn_time)}</span>
            </div>
            <p className="hint">{e.detail}</p>
            <Assign ev={e} candidates={pays} call={call} onDone={load} />
          </div>
        ))}
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Recent email activity</h2>
        {!rest.length && <p className="empty">No payment emails processed yet.</p>}
        {rest.map((e) => (
          <div key={e.id} className="row" style={{ marginTop: 0, padding: "9px 0", borderBottom: "1px solid var(--line)" }}>
            <b>{money(e.amount)}</b>{e.payer_name && <span>{e.payer_name}</span>}<Badge value={e.outcome} /><span className="ref">{when(e.created_at)} · {e.detail}</span>
          </div>
        ))}
      </div>
    </>
  );
}
