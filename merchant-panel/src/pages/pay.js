import { api, esc, icon, money, BRAND } from "../core.js";

const last = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const slug = last && !last.endsWith(".html") ? last : new URLSearchParams(location.search).get("id") || "";
document.body.innerHTML = `<div class="co"><div class="co-info" id="info"></div><div class="co-card" id="card"><p class="muted">Loading…</p></div></div>`;
const $ = (id) => document.getElementById(id);
let data = null, offset = 0, timer = null;

function renderInfo(d) {
  $("info").innerHTML = `<div class="muted small">Pay to</div><div style="font-size:20px;font-weight:600">${esc(d.store_name)}</div>
    <div class="amt" style="margin-top:14px">${money(d.amount)}</div>${d.customer_name ? `<div class="muted">For ${esc(d.customer_name)}</div>` : ""}
    ${d.support_link ? `<a href="${esc(d.support_link)}" rel="noopener" style="margin-top:12px;font-weight:600">Need help? Contact the merchant →</a>` : ""}
    <div class="muted small" style="margin-top:auto">Secured checkout · ${esc(BRAND)}</div>`;
}

function render(d) {
  data = d; renderInfo(d);
  const p = d.payment, card = $("card");
  clearInterval(timer);
  if (d.status === "PAID") {
    card.innerHTML = `<div class="notice ok">${icon("check-circle-2", 18)} Payment received. Thank you!</div>${d.redirect_url ? `<a class="btn btn-primary" href="${esc(d.redirect_url)}">Return to merchant</a>` : ""}`;
    if (d.redirect_url) setTimeout(() => { location.href = d.redirect_url; }, 4000);
    return;
  }
  if (d.status === "PENDING_VERIFICATION") { card.innerHTML = `<div class="notice">We received your payment and are confirming it. This page updates automatically.</div>`; poll(); return; }
  if (d.status === "REVIEW") { card.innerHTML = `<div class="notice bad">Your payment needs a manual check by the merchant. Please contact them with this reference: <b>${esc(p?.reference || "")}</b>.</div>`; return; }
  if (d.status === "EXPIRED") { card.innerHTML = `<div class="notice bad">This payment link has expired. Please ask the merchant for a new one.</div>`; return; }
  if (!p || !p.live) {
    card.innerHTML = `<div class="notice">${p ? "This QR expired." : "Ready to pay?"}</div><button class="btn btn-primary" id="newqr">${p ? "Show a new QR" : "Show QR"}</button><p class="err-text" id="e"></p>`;
    $("newqr").addEventListener("click", start); return;
  }
  offset = new Date(p.server_time).getTime() - Date.now();
  const total = new Date(p.expires_at) - new Date(p.created_at);
  card.innerHTML = `<div class="muted small">Scan with any UPI app and pay exactly ${money(d.amount)}</div><img class="qr" alt="UPI QR code" src="${p.qr_data_url}" />
    <div class="co-timer" id="t">--:--</div><div class="bar"><i id="b"></i></div>
    <a class="btn btn-primary" href="${esc(p.upi_uri)}" style="width:100%">Open UPI app</a>
    <p class="muted small">Keep this page open. It updates when your payment is confirmed.</p>`;
  const tick = () => { const left = Math.max(0, new Date(p.expires_at) - (Date.now() + offset)); const s = Math.ceil(left / 1000);
    $("t").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; $("b").style.width = Math.min(100, (left / total) * 100) + "%"; if (left <= 0) load(); };
  tick(); timer = setInterval(tick, 500); poll();
}

let pollId;
function poll() { clearInterval(pollId); pollId = setInterval(async () => { try { const d = await api(`/public/links/${encodeURIComponent(slug)}`, { auth: false });
  if (d.status !== data.status || d.payment?.status !== data.payment?.status) render(d); } catch {} }, 3000); }

async function load() { try { render(await api(`/public/links/${encodeURIComponent(slug)}`, { auth: false })); } catch (e) { $("card").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; } }
async function start() { try { render(await api(`/public/links/${encodeURIComponent(slug)}/session`, { method: "POST", auth: false })); } catch (e) { $("card").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; } }

(async () => {
  try {
    const d = await api(`/public/links/${encodeURIComponent(slug)}`, { auth: false });
    if (d.status === "ACTIVE" && !(d.payment && d.payment.live)) await start(); else render(d);
  } catch (e) { $("card").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; }
})();
