import "../css/transactions.css";
import { shell, api, head, icon, esc, money, when, statusBadge, modal, toast } from "../core.js";

const page = shell("transactions");
const S = { status: "all", range: "all", q: "", page: 1, limit: 10 };
const TABS = [["all", "All"], ["created", "Created"], ["captured", "Captured"], ["expired", "Expired"], ["failed", "Failed"]];
const RANGES = [["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["lastmonth", "Last month"]];

page.innerHTML = `${head("Transactions", "View and manage all your payments.")}
<div class="stat-grid unequal" id="sum"></div>
<div class="card" id="split"></div>
<div class="card" style="padding:0;overflow:hidden">
  <div class="card-header-filters" style="border-bottom:1px solid var(--color-hairline)">
    <div id="tabs" style="display:flex;gap:6px;flex-wrap:wrap">${TABS.map(([k, l]) => `<button class="rzp-tab ${k === "all" ? "active" : ""}" data-s="${k}">${l}</button>`).join("")}</div>
    <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
      <select class="form-input" id="range" style="width:auto;padding:6px 10px">${RANGES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <select class="form-input" id="limit" style="width:auto;padding:6px 10px"><option value="10">10 items</option><option value="25">25 items</option><option value="50">50 items</option></select>
      <div class="search-box">${icon("search", 14)}<input id="q" placeholder="Search reference, UTR, name" /></div>
    </div>
  </div>
  <div class="table-responsive"><table class="tx-table"><thead><tr><th>Reference</th><th>UTR / Txn ID</th><th>Customer</th><th>Created</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody id="rows"></tbody></table></div>
  <div class="pagination-controls"><span class="muted small" id="info"></span><div class="row"><button class="pagination-btn" id="prev">Prev</button><button class="pagination-btn" id="next">Next</button></div></div>
</div>`;

const $ = (id) => document.getElementById(id);
let cache = [];

function box(label, value, ic, color) {
  return `<div class="stat-card"><div class="stat-card-top"><span class="stat-card-label">${label}</span><span class="stat-card-icon ${color}">${icon(ic, 20)}</span></div><div class="stat-card-value">${value}</div></div>`;
}

async function load() {
  const qs = new URLSearchParams({ status: S.status, range: S.range, q: S.q, page: S.page, limit: S.limit });
  const r = await api("/merchant/transactions?" + qs);
  S.page = r.page; cache = r.items;
  const m = r.summary;
  $("sum").innerHTML = box("Collected", money(m.collected), "indian-rupee", "green") + box("Pending", m.pending, "clock", "orange")
    + box("Expired", m.expired, "clock", "blue") + box("Failed", m.failed, "x-circle", "red");
  const pct = m.captured > 0 ? 100 : 0;
  $("split").innerHTML = `<div class="card-title">${icon("indian-rupee", 18)} <span>Split by payment method</span></div>
    <div class="row" style="margin-top:12px;justify-content:space-between"><b>UPI</b><span class="tnum">${money(m.collected)} · ${m.captured} captured · ${pct}%</span></div>
    <div class="bar" style="margin-top:8px;height:8px;background:var(--color-hairline);border-radius:9px;overflow:hidden"><i style="display:block;height:100%;width:${pct}%;background:var(--blue-600)"></i></div>
    <p class="muted small" style="margin:8px 0 0">All payments are collected by UPI, 100% settled straight to your own account.</p>`;
  $("rows").innerHTML = r.items.length ? r.items.map((p) => `<tr>
    <td class="tnum"><code>${esc(p.reference)}</code></td>
    <td class="tnum">${esc(p.utr || p.transaction_id || "—")}</td>
    <td>${esc(p.payer_name || p.customer_name || "—")}</td>
    <td class="tnum">${when(p.created_at)}</td><td class="tnum">${money(p.amount)}</td><td>${statusBadge(p)}</td>
    <td><button class="btn btn-secondary btn-sm" data-id="${p.id}">Details</button></td></tr>`).join("")
    : `<tr><td colspan="7" class="empty-block">No transactions match your filters.</td></tr>`;
  $("info").textContent = `Page ${r.page} of ${r.pages} · ${r.total} records`;
  $("prev").disabled = r.page <= 1; $("next").disabled = r.page >= r.pages;
}

function details(p) {
  const canDecide = p.status === "PAYMENT_DETECTED";
  const m = modal({ title: "Transaction details",
    body: `<dl class="kv"><dt>Reference</dt><dd class="mono">${esc(p.reference)}</dd><dt>Amount</dt><dd>${money(p.amount)}</dd><dt>Status</dt><dd>${statusBadge(p)}</dd>
      <dt>Paid by</dt><dd>${esc(p.payer_name || "—")}</dd><dt>Customer</dt><dd>${esc(p.customer_name || "—")}</dd>
      <dt>Transaction ID</dt><dd class="mono">${esc(p.transaction_id || "—")}</dd><dt>UTR</dt><dd class="mono">${esc(p.utr || "—")}</dd>
      <dt>Created</dt><dd>${when(p.created_at)}</dd><dt>QR expires</dt><dd>${when(p.expires_at)}</dd><dt>Verified</dt><dd>${when(p.verified_at)}</dd>
      <dt>Note</dt><dd>${esc(p.verification_note || "—")}</dd></dl>
      ${canDecide ? `<p class="muted small" style="margin-top:12px">This payment was detected from an email but not confirmed. Check your bank app, then decide.</p>` : ""}`,
    footer: canDecide ? `<button class="btn btn-danger" data-act="reject">Not received</button><button class="btn btn-primary" data-act="confirm">Mark as verified</button>`
      : `<button class="btn btn-secondary" data-close>Close</button>`,
    onMount: (el, close) => el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await api(`/merchant/payments/${p.id}/${b.dataset.act}`, { method: "POST" }); toast("Updated"); close(); load(); }
      catch (e) { toast(e.message, true); b.disabled = false; }
    })) });
  return m;
}

$("tabs").addEventListener("click", (e) => { const b = e.target.closest(".rzp-tab"); if (!b) return; S.status = b.dataset.s; S.page = 1;
  document.querySelectorAll("#tabs .rzp-tab").forEach((x) => x.classList.toggle("active", x === b)); load().catch((x) => toast(x.message, true)); });
$("range").addEventListener("change", (e) => { S.range = e.target.value; S.page = 1; load(); });
$("limit").addEventListener("change", (e) => { S.limit = Number(e.target.value); S.page = 1; load(); });
let t; $("q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; S.page = 1; load(); }, 300); });
$("prev").addEventListener("click", () => { S.page--; load(); });
$("next").addEventListener("click", () => { S.page++; load(); });
$("rows").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) details(cache.find((p) => p.id === Number(b.dataset.id))); });

load().catch((e) => toast(e.message, true));
setInterval(() => document.hidden || load().catch(() => {}), 10000);
