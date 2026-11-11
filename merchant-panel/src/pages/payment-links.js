import "../css/payment-links.css";
import { shell, api, head, icon, esc, money, when, copyText, toast } from "../core.js";

const page = shell("links");
page.innerHTML = `${head("Payment Links", "Create checkout links to share with your customers.")}
<div class="card">
  <div class="card-title">${icon("link-2", 18)} <span>Generate payment link</span></div>
  <div class="card-sub">Each time a customer opens the link they get a fresh 5-minute QR for the amount.</div>
  <form class="generate-link-form" id="f">
    <div class="input-currency-box"><span class="currency-sym">₹</span><input class="form-input" id="amt" type="number" min="1" max="100000" step="0.01" required placeholder="Amount (e.g. 499)" inputmode="decimal" /></div>
    <input class="form-input" id="cust" maxlength="100" placeholder="Customer name (optional)" />
    <select class="form-input" id="exp"><option value="1m">1 min</option><option value="5m">5 mins</option><option value="30m">30 mins</option><option value="1h">1 hour</option><option value="2h">2 hours</option><option value="24h" selected>1 day</option></select>
    <button class="btn btn-primary" id="go">${icon("plus")} Generate</button>
  </form>
  <div class="err-text" id="err"></div>
  <div id="made" style="display:none;margin-top:14px" class="row"><span class="mono" id="madeUrl"></span>
    <button class="btn btn-secondary btn-sm" id="madeCopy">${icon("copy")} Copy</button><a class="btn btn-primary btn-sm" id="madeOpen" target="_blank" rel="noopener">${icon("external-link")} Open</a></div>
</div>
<div class="card">
  <div class="card-title">${icon("list", 18)} <span>My payment links</span></div>
  <div class="table-responsive"><table class="tx-table"><thead><tr><th>Link</th><th>Amount</th><th>Status</th><th>Created</th><th>Expires</th><th>Actions</th></tr></thead><tbody id="rows"></tbody></table></div>
</div>`;

const $ = (id) => document.getElementById(id);
const ST = {
  ACTIVE: ["status-pending", "Active"], PAID: ["status-success", "Paid"], EXPIRED: ["status-expired", "Expired"],
  PENDING_VERIFICATION: ["status-pending", "Verifying"], REVIEW: ["status-failed", "Needs review"],
};

async function load() {
  const rows = await api("/merchant/links");
  $("rows").innerHTML = rows.length ? rows.map((l) => { const [c, t] = ST[l.status] || ["status-expired", l.status];
    return `<tr><td><b>${esc(l.slug)}</b>${l.customer_name ? `<div class="muted small">${esc(l.customer_name)}</div>` : ""}<div class="muted small mono">${esc(l.url)}</div></td>
    <td class="tnum">${money(l.amount)}</td><td><span class="status-badge ${c}">${t}</span></td><td class="tnum">${when(l.created_at)}</td><td class="tnum">${when(l.expires_at)}</td>
    <td><div class="row"><button class="btn btn-secondary btn-sm" data-copy="${esc(l.url)}">${icon("copy")} Copy</button><a class="btn btn-secondary btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${icon("external-link")} Open</a></div></td></tr>`; }).join("")
    : `<tr><td colspan="6" class="empty-block">No payment links yet.</td></tr>`;
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault(); $("go").disabled = true; $("err").textContent = "";
  try {
    const l = await api("/merchant/links", { method: "POST", body: { amount: Number($("amt").value), customer_name: $("cust").value.trim() || null, expiry: $("exp").value } });
    $("made").style.display = "flex"; $("madeUrl").textContent = l.url; $("madeOpen").href = l.url;
    $("madeCopy").onclick = () => copyText(l.url, "Link copied");
    $("amt").value = ""; $("cust").value = ""; load();
  } catch (ex) { $("err").textContent = ex.message; } finally { $("go").disabled = false; }
});
$("rows").addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) copyText(b.dataset.copy, "Link copied"); });

load().catch((e) => toast(e.message, true));
setInterval(() => document.hidden || load().catch(() => {}), 8000);
