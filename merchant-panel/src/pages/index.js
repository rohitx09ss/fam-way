import "../css/index.css";
import { shell, api, head, icon, esc, money, when, statusBadge, areaChart, getUser } from "../core.js";

const page = shell("dashboard");
const h = new Date().getHours();
const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
const firstName = (getUser().name || getUser().store_name || "").split(" ")[0];

page.innerHTML = `
${head(`${greet}${firstName ? ", " + esc(firstName) : ""}`, "Here's what's happening with your payments.",
  `<span class="imap-pill" id="imap"><i></i><span>Checking inbox…</span></span>`)}
<div class="stat-grid unequal" id="stats"></div>
<div id="setup"></div>
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div><div class="card-title">${icon("trending-up", 18)} <span id="chartTitle">Revenue</span></div><div class="card-sub" id="chartSub">Last 7 days</div></div>
    <div class="row">
      <div class="chart-time-pills" id="range"><button class="time-pill active" data-d="7">7D</button><button class="time-pill" data-d="15">15D</button><button class="time-pill" data-d="30">30D</button></div>
      <button class="chart-toggle-btn active" id="tRev"><span class="dot rev-dot"></span>Revenue</button>
      <button class="chart-toggle-btn" id="tReq"><span class="dot req-dot"></span>Requests</button>
    </div>
  </div>
  <div class="chart-box" id="chart"></div>
</div>
<div class="card">
  <div style="display:flex;justify-content:space-between;align-items:center"><div><div class="card-title">${icon("receipt", 18)} <span>Recent transactions</span></div><div class="card-sub">Your latest payment requests</div></div>
  <a class="btn btn-secondary btn-sm" href="/transactions.html">View all</a></div>
  <div class="table-responsive"><table class="tx-table"><thead><tr><th>Reference</th><th>Customer</th><th>Created</th><th>Amount</th><th>Status</th></tr></thead><tbody id="recent"></tbody></table></div>
</div>`;

let days = 7, metric = "revenue", data = null;
const $ = (id) => document.getElementById(id);

function drawChart() {
  if (!data) return;
  const labels = data.series.map((s) => new Date(s.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  const vals = data.series.map((s) => s[metric]);
  $("chartTitle").textContent = metric === "revenue" ? "Revenue" : "Requests";
  $("chartSub").textContent = `Last ${days} days`;
  areaChart($("chart"), labels, vals, metric === "revenue"
    ? { color: "#2563eb", fmt: (v) => "₹" + Number(v).toLocaleString("en-IN") } : { color: "#9333ea", fmt: (v) => v });
}

function stat(label, value, ic, color) {
  return `<div class="stat-card"><div class="stat-card-top"><span class="stat-card-label">${label}</span><span class="stat-card-icon ${color}">${icon(ic, 20)}</span></div><div class="stat-card-value">${value}</div></div>`;
}

async function load() {
  const [ov, st] = await Promise.all([api(`/merchant/overview?days=${days}`), api("/merchant/settings")]);
  data = ov;
  $("stats").innerHTML = stat("Total revenue", money(ov.revenue), "indian-rupee", "blue") + stat("Total requests", ov.total, "activity", "purple")
    + stat("Successful", ov.successful, "check-circle-2", "green") + stat("Failed / pending", ov.other, "alert-circle", "orange");
  const pill = $("imap");
  if (!st.has_app_password || !st.is_enabled) { pill.className = "imap-pill warn"; pill.lastElementChild.textContent = "Inbox not connected"; }
  else if (st.last_error) { pill.className = "imap-pill bad"; pill.lastElementChild.textContent = "Inbox sync error"; pill.title = st.last_error; }
  else if (st.last_poll_at) { pill.className = "imap-pill ok"; pill.lastElementChild.textContent = "Inbox sync healthy · " + when(st.last_poll_at); }
  else { pill.className = "imap-pill warn"; pill.lastElementChild.textContent = "Waiting for first inbox check"; }
  const steps = [
    [!!st.upi_id, "Add your UPI ID", "Where customers' money lands.", "/integrations.html", "Open Integrations"],
    [st.has_app_password && st.is_enabled, "Connect your FamPay Gmail", "So payments are detected and marked paid automatically.", "/integrations.html", "Connect Gmail"],
    [ov.total > 0, "Create your first payment link", "Share it with a customer, or call the API from your site.", "/payment-links.html", "Create a link"],
  ];
  $("setup").innerHTML = steps.every((s) => s[0]) ? "" : `<div class="card"><div class="card-title">${icon("play-circle", 18)} <span>Quick setup</span></div>
    <div class="steps">${steps.map((s, i) => `<div class="step ${s[0] ? "done" : ""}"><b class="n">${s[0] ? "✓" : i + 1}</b><div><b>${s[1]}</b> <span class="muted">${s[2]}</span> ${s[0] ? "" : `<a href="${s[3]}" style="font-weight:600">${s[4]} →</a>`}</div></div>`).join("")}</div></div>`;
  $("recent").innerHTML = ov.recent.length ? ov.recent.map((p) => `<tr><td class="tnum"><code>${esc(p.reference)}</code></td>
    <td>${esc(p.payer_name || p.customer_name || "—")}</td><td class="tnum">${when(p.created_at)}</td><td class="tnum">${money(p.amount)}</td><td>${statusBadge(p)}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-block">No payments yet. Create a payment link to get started.</td></tr>`;
  drawChart();
}

$("range").addEventListener("click", (e) => {
  const b = e.target.closest(".time-pill"); if (!b) return;
  days = Number(b.dataset.d);
  document.querySelectorAll("#range .time-pill").forEach((x) => x.classList.toggle("active", x === b));
  load().catch(() => {});
});
$("tRev").addEventListener("click", () => { metric = "revenue"; $("tRev").classList.add("active"); $("tReq").classList.remove("active"); drawChart(); });
$("tReq").addEventListener("click", () => { metric = "requests"; $("tReq").classList.add("active"); $("tRev").classList.remove("active"); drawChart(); });

load().catch((e) => { page.insertAdjacentHTML("beforeend", `<p class="err-text">${esc(e.message)}</p>`); });
setInterval(() => document.hidden || load().catch(() => {}), 15000);
