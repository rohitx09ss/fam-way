import { useEffect, useRef, useState } from "react";

export const money = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

export const when = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

const TONE = {
  CREATED: "info", WAITING_FOR_PAYMENT: "info", PAYMENT_DETECTED: "warn", VERIFYING: "warn",
  VERIFIED: "ok", EXPIRED: "mute", FAILED: "bad", REVIEW_REQUIRED: "bad",
  MATCHED: "ok", MANUALLY_ASSIGNED: "ok", DUPLICATE: "mute", REJECTED: "bad", MISMATCH: "bad",
  AMBIGUOUS: "warn", LATE: "warn", UNMATCHED: "mute", REVIEW: "warn",
};
const EVENT_LABEL = {
  MATCHED: "Matched", MANUALLY_ASSIGNED: "Assigned by you", DUPLICATE: "Duplicate", REJECTED: "Failed email check",
  MISMATCH: "Wrong amount", AMBIGUOUS: "Could be several QRs", LATE: "Paid after expiry", UNMATCHED: "No matching QR",
  REVIEW: "Needs review",
};

export function Badge({ value, label }) {
  return <span className={`badge ${TONE[value] || "mute"}`}>{label || EVENT_LABEL[value] || value}</span>;
}

/** Visual countdown only. The server decides expiry; this just mirrors server time. */
export function useRemaining(expiresAt, serverTime) {
  const offset = useRef(0);
  const calc = () => Math.max(0, new Date(expiresAt).getTime() - (Date.now() + offset.current));
  const [left, setLeft] = useState(() => calc());
  useEffect(() => {
    offset.current = new Date(serverTime).getTime() - Date.now();
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 500);
    return () => clearInterval(t);
  }, [expiresAt, serverTime]);
  return left;
}

export const clock = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function Table({ cols, rows, empty, onRow }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? "num" : ""}>{c.title}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? "clickable" : ""}>
              {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : r[c.key] ?? "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
