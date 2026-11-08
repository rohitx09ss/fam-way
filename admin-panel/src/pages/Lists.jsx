import { useEffect, useState } from "react";
import { Badge, Table, money, when } from "../components";

const CFG = {
  payments: {
    title: "All payments", note: "Every QR request across merchants.", path: "/admin/payments", empty: "No payment requests yet.",
    cols: [
      { key: "created_at", title: "Created", render: (r) => when(r.created_at) },
      { key: "merchant_id", title: "Merchant", num: true },
      { key: "amount", title: "Amount", num: true, render: (r) => money(r.amount) },
      { key: "reference", title: "Reference", render: (r) => <span className="ref">{r.reference}</span> },
      { key: "payer_name", title: "Paid by", render: (r) => r.payer_name || "—" },
      { key: "transaction_id", title: "Transaction ID", render: (r) => <span className="ref">{r.transaction_id || "—"}</span> },
      { key: "expires_at", title: "Expires", render: (r) => when(r.expires_at) },
      { key: "status", title: "Status", render: (r) => <Badge value={r.status} label={r.display_status} /> },
    ],
  },
  emails: {
    title: "Email events", note: "Every payment email the workers processed, and what happened to it.", path: "/admin/events", empty: "No payment emails processed yet.",
    cols: [
      { key: "created_at", title: "Received", render: (r) => when(r.created_at) },
      { key: "merchant_id", title: "Merchant", num: true },
      { key: "amount", title: "Amount", num: true, render: (r) => money(r.amount) },
      { key: "payer_name", title: "Paid by", render: (r) => r.payer_name || "—" },
      { key: "transaction_id", title: "Transaction ID", render: (r) => <span className="ref">{r.transaction_id || "—"}</span> },
      { key: "auth_ok", title: "Sender check", render: (r) => (r.auth_ok ? "Passed" : "Failed") },
      { key: "outcome", title: "Outcome", render: (r) => <Badge value={r.outcome} /> },
      { key: "detail", title: "Detail", render: (r) => <span className="ref">{r.detail}</span> },
    ],
  },
  audit: {
    title: "Audit log", note: "Who did what, and when.", path: "/admin/audit", empty: "Nothing logged yet.",
    cols: [
      { key: "created_at", title: "When", render: (r) => when(r.created_at) },
      { key: "actor", title: "Actor" },
      { key: "action", title: "Action" },
      { key: "entity", title: "Entity", render: (r) => <span className="ref">{r.entity}</span> },
      { key: "detail", title: "Detail", render: (r) => <span className="ref">{r.detail}</span> },
    ],
  },
};

export default function Lists({ kind, call }) {
  const c = CFG[kind];
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const load = () => call(c.path).then(setRows).catch(() => {});
    load(); const t = setInterval(load, 8000); return () => clearInterval(t);
  }, [call, c.path]);
  return (
    <>
      <div className="page-head"><h1>{c.title}</h1><p>{c.note}</p></div>
      <div className="panel">{rows ? <Table rows={rows} cols={c.cols} empty={c.empty} /> : <p className="empty">Loading…</p>}</div>
    </>
  );
}
