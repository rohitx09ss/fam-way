import "../css/integrations.css";
import { shell, api, head, icon, esc, when, toast, confirmBox } from "../core.js";

const page = shell("integrations");
page.innerHTML = `${head("Integrations", "Connect your FamPay Gmail so payments are detected and marked paid automatically.")}
<div class="integration-tabs row" style="gap:20px;border-bottom:1px solid var(--color-hairline);margin-bottom:20px">
  <button class="tab-btn active" data-t="setup">Gmail &amp; FamPay</button><button class="tab-btn" data-t="guide">Setup instructions</button></div>
<div class="tab-pane active" id="p-setup"><form class="card" id="f" style="max-width:620px">
  <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div class="card-title">${icon("mail", 18)} <span>Automated payment verification</span></div><span class="imap-pill" id="pill"><i></i><span>…</span></span></div>
  <div class="card-sub">We read FamPay's payment alert emails from your inbox over IMAP. Only mail from FamPay's official sender with a valid signature is used.</div>
  <label class="form-label" style="margin-top:14px">Store name</label><input class="form-input" id="store" maxlength="120" />
  <label class="form-label" style="margin-top:12px">FamPay UPI ID</label><input class="form-input" id="upi" placeholder="yourname@fam" />
  <label class="form-label" style="margin-top:12px">FamPay-linked Gmail address</label><input class="form-input" id="gmail" type="email" />
  <label class="form-label" style="margin-top:12px">Google app password (16 characters)</label><input class="form-input" id="pw" type="password" autocomplete="new-password" />
  <p class="muted small" id="pwHint" style="margin:6px 0 0">Needs IMAP enabled in Gmail. Stored encrypted and never shown again.</p>
  <label class="row" style="margin-top:14px;gap:10px;font-weight:500"><input type="checkbox" id="on" style="width:auto" /> Watch this inbox for payments</label>
  <div class="muted small" id="last" style="margin-top:8px"></div><div id="msg" class="err-text"></div>
  <div class="row" style="margin-top:16px"><button class="btn btn-primary" id="save">Save &amp; connect</button><button type="button" class="btn btn-secondary" id="test">Test inbox connection</button></div>
</form></div>
<div class="tab-pane" id="p-guide"><div class="card" style="max-width:700px"><div class="card-title">${icon("book-open", 18)} <span>How to get your Google app password</span></div>
  <div class="steps">
    <div class="step"><b class="n">1</b><div><b>Turn on 2-step verification</b><div class="muted">Google account → Security → 2-Step Verification.</div></div></div>
    <div class="step"><b class="n">2</b><div><b>Enable IMAP in Gmail</b><div class="muted">Gmail Settings → Forwarding and POP/IMAP → Enable IMAP → Save.</div></div></div>
    <div class="step"><b class="n">3</b><div><b>Create an app password</b><div class="muted">Open myaccount.google.com/apppasswords, name it anything and copy the 16-character code.</div></div></div>
    <div class="step"><b class="n">4</b><div><b>Paste it here</b><div class="muted">Enter your Gmail, app password and FamPay UPI ID, turn on monitoring and press Save &amp; connect.</div></div></div>
  </div></div></div>`;
const $ = (id) => document.getElementById(id);

document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x === b));
  $("p-setup").classList.toggle("active", b.dataset.t === "setup"); $("p-guide").classList.toggle("active", b.dataset.t === "guide");
}));

function fill(s) {
  $("store").value = s.store_name || ""; $("upi").value = s.upi_id || ""; $("gmail").value = s.gmail_address || ""; $("on").checked = !!s.is_enabled;
  $("pw").placeholder = s.has_app_password ? "Saved. Type to replace it" : "xxxx xxxx xxxx xxxx";
  const pill = $("pill");
  if (!s.has_app_password || !s.is_enabled) { pill.className = "imap-pill"; pill.lastElementChild.textContent = "Not connected"; }
  else if (s.last_error) { pill.className = "imap-pill bad"; pill.lastElementChild.textContent = "Error"; }
  else { pill.className = "imap-pill ok"; pill.lastElementChild.textContent = "Connected"; }
  $("last").textContent = s.last_poll_at ? `Last checked ${when(s.last_poll_at)}${s.last_error ? " · " + s.last_error : ""}` : "";
}
const show = (t, ok) => { $("msg").className = ok ? "ok-text" : "err-text"; $("msg").textContent = t; };

$("f").addEventListener("submit", async (e) => {
  e.preventDefault(); $("save").disabled = true; show("", true);
  try {
    const s = await api("/merchant/settings", { method: "PUT", body: { store_name: $("store").value.trim(), upi_id: $("upi").value.trim(),
      gmail_address: $("gmail").value.trim(), app_password: $("pw").value.trim() || undefined, imap_host: "imap.gmail.com", is_enabled: $("on").checked } });
    $("pw").value = ""; fill(s); show("Saved.", true);
  } catch (ex) { show(ex.message, false); } finally { $("save").disabled = false; }
});
$("test").addEventListener("click", async () => {
  $("test").disabled = true; show("Testing…", true);
  try { const r = await api("/merchant/settings/test-imap", { method: "POST" }); show(r.message, r.ok); } catch (ex) { show(ex.message, false); } finally { $("test").disabled = false; }
});

api("/merchant/settings").then(fill).catch((e) => toast(e.message, true));
