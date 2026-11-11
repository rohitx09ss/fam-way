import "../css/webhooks.css";
import { shell, api, head, icon, esc, when, copyText, confirmBox, modal, toast } from "../core.js";

const page = shell("webhooks");
const L = { filter: "all", page: 1 };
let secret = "", revealed = false;

page.innerHTML = `${head("Webhooks", "Get an HTTP POST the moment a customer payment is verified.", `<button class="btn btn-primary" id="add">${icon("plus")} Add endpoint</button>`)}
<div class="webhook-tabs"><button class="tab-btn active" data-t="ep">${icon("send", 16)}<span>Endpoints</span><span class="tab-count" id="cEp">0</span></button>
  <button class="tab-btn" data-t="logs">${icon("list", 16)}<span>Delivery logs</span><span class="tab-count" id="cLog">0</span></button></div>
<div class="tab-pane active" id="pane-ep">
  <div class="webhook-info-banner"><div>${icon("shield-check", 16)} <span>Every request is signed. Header <code>X-Signature: sha256=…</code> is an HMAC-SHA256 of the raw body using your signing secret.</span></div></div>
  <div class="card"><div class="card-title">${icon("lock", 18)} <span>Signing secret</span></div>
    <div class="row" style="margin-top:10px"><span class="mono" id="sec">••••••••••••••••••••</span>
    <button class="btn btn-secondary btn-sm" id="reveal">${icon("eye")} Reveal</button><button class="btn btn-secondary btn-sm" id="copySec">${icon("copy")} Copy</button></div></div>
  <div id="eps"></div>
</div>
<div class="tab-pane" id="pane-logs"><div class="card">
  <div class="log-filters" id="flt"><button class="log-filter-btn active" data-f="all">All <span class="count-badge" id="nAll">0</span></button>
    <button class="log-filter-btn" data-f="success">Success <span class="count-badge" id="nOk">0</span></button><button class="log-filter-btn" data-f="failed">Failed <span class="count-badge" id="nBad">0</span></button></div>
  <div class="table-responsive"><table class="tx-table"><thead><tr><th>Time</th><th>Endpoint</th><th>Event</th><th>Status</th><th>Attempts</th><th></th></tr></thead><tbody id="logs"></tbody></table></div>
  <div class="pagination-bar"><span class="pagination-info" id="pinfo"></span><div class="pagination-nav"><button class="pagination-btn" id="pp">Prev</button><button class="pagination-btn" id="pn">Next</button></div></div>
</div></div>`;
const $ = (id) => document.getElementById(id);
let logCache = [];

document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x === b));
  $("pane-ep").classList.toggle("active", b.dataset.t === "ep"); $("pane-logs").classList.toggle("active", b.dataset.t === "logs");
  if (b.dataset.t === "logs") loadLogs();
}));

async function loadEps() {
  const r = await api("/merchant/webhooks");
  secret = r.secret; $("cEp").textContent = r.endpoints.length;
  $("eps").innerHTML = r.endpoints.length ? r.endpoints.map((e) => `<div class="endpoint-card"><div class="endpoint-header"><div class="endpoint-title-group"><span class="endpoint-name">${esc(e.name)}</span><span class="status-badge status-success">Active</span></div>
    <div class="endpoint-actions"><button class="btn btn-secondary btn-sm" data-test="${e.id}">${icon("send", 14)} Send test</button><button class="btn btn-danger btn-sm" data-del="${e.id}" data-name="${esc(e.name)}">${icon("trash-2", 14)} Delete</button></div></div>
    <div class="endpoint-url-box"><span class="endpoint-url-text">${esc(e.url)}</span></div></div>`).join("")
    : `<div class="card"><div class="card-title">${icon("send", 18)} <span>No endpoints yet</span></div><div class="card-sub">Add your server URL (HTTPS recommended) to be notified on every verified payment.</div></div>`;
}

async function loadLogs() {
  const r = await api(`/merchant/webhook-deliveries?filter=${L.filter}&page=${L.page}`);
  logCache = r.items; L.page = r.page;
  $("cLog").textContent = r.counts.all; $("nAll").textContent = r.counts.all; $("nOk").textContent = r.counts.success; $("nBad").textContent = r.counts.failed;
  const st = (d) => d.status === "SUCCESS" ? ["status-success", "Delivered"] : d.status === "FAILED" ? ["status-failed", "Failed"] : ["status-pending", d.attempts ? "Retrying" : "Queued"];
  $("logs").innerHTML = r.items.length ? r.items.map((d) => { const [c, t] = st(d);
    return `<tr><td class="tnum">${when(d.created_at)}</td><td>${esc(d.endpoint)}</td><td><code>${esc(d.event)}</code></td><td><span class="status-badge ${c}">${t}${d.response_code ? " · " + d.response_code : ""}</span></td>
    <td class="tnum">${d.attempts}</td><td><button class="btn btn-secondary btn-sm" data-log="${d.id}">Inspect</button></td></tr>`; }).join("")
    : `<tr><td colspan="6" class="empty-block">No deliveries yet. They appear when a payment is verified.</td></tr>`;
  $("pinfo").textContent = `Page ${r.page} of ${r.pages}`; $("pp").disabled = r.page <= 1; $("pn").disabled = r.page >= r.pages;
}

$("add").addEventListener("click", () => modal({ title: "Add webhook endpoint",
  body: `<label class="form-label">Name</label><input class="form-input" id="wn" maxlength="80" placeholder="e.g. Store backend" />
    <label class="form-label" style="margin-top:12px">Destination URL</label><input class="form-input" id="wu" type="url" placeholder="https://yourdomain.com/api/webhook" />
    <p class="muted small">Must be a public address. Private and internal addresses are blocked.</p><div class="err-text" id="we"></div>`,
  footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="ws">Save endpoint</button>`,
  onMount: (el, close) => el.querySelector("#ws").addEventListener("click", async (ev) => {
    ev.target.disabled = true; el.querySelector("#we").textContent = "";
    try { await api("/merchant/webhooks", { method: "POST", body: { name: el.querySelector("#wn").value.trim(), url: el.querySelector("#wu").value.trim() } }); close(); toast("Endpoint added"); loadEps(); }
    catch (e) { el.querySelector("#we").textContent = e.message; ev.target.disabled = false; }
  }) }));

$("eps").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-test]"), d = e.target.closest("[data-del]");
  if (t) { try { await api(`/merchant/webhooks/${t.dataset.test}/test`, { method: "POST" }); toast("Test event queued. Check Delivery logs in a few seconds."); } catch (x) { toast(x.message, true); } }
  if (d && await confirmBox({ title: "Delete endpoint?", danger: true, confirmText: "Delete", text: `Stop sending webhooks to <b>${d.dataset.name}</b>? Its delivery history is deleted too.` })) {
    try { await api(`/merchant/webhooks/${d.dataset.del}`, { method: "DELETE" }); toast("Deleted"); loadEps(); } catch (x) { toast(x.message, true); } }
});
$("reveal").addEventListener("click", () => { revealed = !revealed; $("sec").textContent = revealed ? secret : "••••••••••••••••••••"; $("reveal").lastChild.textContent = revealed ? " Hide" : " Reveal"; });
$("copySec").addEventListener("click", () => copyText(secret, "Signing secret copied"));
$("flt").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; L.filter = b.dataset.f; L.page = 1;
  document.querySelectorAll("#flt .log-filter-btn").forEach((x) => x.classList.toggle("active", x === b)); loadLogs(); });
$("pp").addEventListener("click", () => { L.page--; loadLogs(); }); $("pn").addEventListener("click", () => { L.page++; loadLogs(); });
$("logs").addEventListener("click", (e) => { const b = e.target.closest("[data-log]"); if (!b) return; const d = logCache.find((x) => x.id === Number(b.dataset.log));
  let pretty = d.payload; try { pretty = JSON.stringify(JSON.parse(d.payload), null, 2); } catch {}
  modal({ title: "Delivery details", body: `<p class="muted small" style="margin-top:0">${esc(d.endpoint)} · ${esc(d.event)} · ${when(d.created_at)}</p><b>Sent payload</b><pre>${esc(pretty)}</pre><b style="display:block;margin-top:12px">Server response ${d.response_code || ""}</b><pre>${esc(d.response_body || "(none)")}</pre>`,
    footer: `<button class="btn btn-secondary" data-close>Close</button>` }); });

loadEps().catch((e) => toast(e.message, true));
api("/merchant/webhook-deliveries").then((r) => { $("cLog").textContent = r.counts.all; }).catch(() => {});
