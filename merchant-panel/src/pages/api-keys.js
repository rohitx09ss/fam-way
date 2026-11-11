import "../css/api-keys.css";
import { shell, api, head, icon, esc, when, day, copyText, confirmBox, modal, toast, areaChart } from "../core.js";

const page = shell("keys");
let days = 7;
page.innerHTML = `${head("API Keys", "Secret credentials for your backend integrations.", `<a class="btn btn-secondary" href="/docs.html">${icon("book-open")} API documentation</a>`)}
<div class="apikeys-wrap">
  <div class="key-info-banner"><div>${icon("info", 16)} <span>Authenticate requests with header <code>Authorization: Bearer &lt;KEY&gt;</code>.</span></div></div>
  <div id="keys"></div>
  <div class="card" style="margin-top:20px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center">
      <div><div class="card-title">${icon("activity", 18)} <span>API request traffic</span></div><div class="card-sub">Daily requests made with your key.</div></div>
      <div class="row" id="tr"><button class="traffic-time-btn active" data-d="7">7 days</button><button class="traffic-time-btn" data-d="14">14 days</button><button class="traffic-time-btn" data-d="30">30 days</button></div>
    </div>
    <div class="row" style="gap:28px;margin-top:14px"><div><div class="muted small">Period requests</div><b id="tTotal">0</b></div><div><div class="muted small">Daily average</div><b id="tAvg">0</b></div><div><div class="muted small">Peak day</div><b id="tPeak">0</b></div></div>
    <div class="chart-box" id="chart"></div>
  </div>
</div>`;
const $ = (id) => document.getElementById(id);

function showNewKey(key) {
  modal({ title: "Your new API key",
    body: `<p style="margin-top:0">Copy it now. For security it is <b>shown only once</b> and cannot be viewed again.</p><div class="key-secret-box"><span class="key-secret-text mono">${esc(key)}</span></div>`,
    footer: `<button class="btn btn-primary" data-copy>${icon("copy")} Copy key</button><button class="btn btn-secondary" data-close>Done</button>`,
    onMount: (el) => el.querySelector("[data-copy]").addEventListener("click", () => copyText(key, "API key copied")) });
}

async function roll(hasKey) {
  if (hasKey && !(await confirmBox({ title: "Roll API key?", danger: true, confirmText: "Yes, roll key",
    text: "Servers using the current key will be rejected immediately until you update them with the new key." }))) return;
  try { const r = await api("/merchant/api-keys/roll", { method: "POST" }); showNewKey(r.key); loadKeys(); }
  catch (e) { toast(e.message, true); }
}

async function loadKeys() {
  const keys = await api("/merchant/api-keys");
  $("keys").innerHTML = keys.length ? keys.map((k) => `<div class="key-card"><div class="key-card-header">
      <div class="key-title-group"><span class="key-name">${icon("key-round", 16)} ${esc(k.name)}</span><span class="status-badge status-success">${icon("check-circle-2", 12)} Active</span>
        <span class="status-badge status-counter">${k.request_count} requests</span><span class="status-badge status-lastused">${k.last_used_at ? "Last used " + day(k.last_used_at) : "Never used"}</span>
        <span class="key-created-date">· Created ${day(k.created_at)}</span></div>
      <div class="key-header-actions"><button class="btn btn-danger btn-sm" data-roll>${icon("refresh-cw", 14)} <span>Roll key</span></button></div></div>
      <div class="key-secret-box"><span class="key-secret-text mono">${esc(k.masked)}</span><span class="key-type-pill">Server secret</span></div></div>`).join("")
    : `<div class="card"><div class="card-title">${icon("key-round", 18)} <span>No API key yet</span></div><div class="card-sub">Generate a key to create orders from your own website or app.</div>
       <div style="margin-top:14px"><button class="btn btn-primary" data-roll>${icon("plus")} Generate API key</button></div></div>`;
  $("keys").querySelectorAll("[data-roll]").forEach((b) => b.addEventListener("click", () => roll(keys.length > 0)));
}

async function loadUsage() {
  const u = await api(`/merchant/api-usage?days=${days}`);
  $("tTotal").textContent = u.total; $("tAvg").textContent = u.average; $("tPeak").textContent = u.peak;
  areaChart($("chart"), u.series.map((s) => new Date(s.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })), u.series.map((s) => s.count), { color: "#9333ea" });
}
$("tr").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (!b) return; days = Number(b.dataset.d);
  document.querySelectorAll("#tr .traffic-time-btn").forEach((x) => x.classList.toggle("active", x === b)); loadUsage(); });

loadKeys().catch((e) => toast(e.message, true));
loadUsage().catch(() => {});
