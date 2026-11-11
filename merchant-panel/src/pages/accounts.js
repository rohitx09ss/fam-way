import "../css/integrations.css";
import { shell, api, head, icon, esc, when, modal, confirmBox, toast } from "../core.js";

const page = shell("accounts");
page.innerHTML = `${head("Multi-Accounts", "Connect up to 5 FamPay wallets and switch the receiving account in one click.",
  `<button class="btn btn-primary" id="add">${icon("plus")} Add account (<span id="cnt">1</span>/5)</button>`)}
<div id="list"></div>
<p class="muted small" style="max-width:640px">New QR codes and payment links pay into the <b>active</b> account. Every connected inbox keeps being watched, so a payment for a QR that is already on screen is still detected after you switch.</p>`;
const $ = (id) => document.getElementById(id);
let state = null;

function pill(a) {
  if (!a.has_app_password || !a.is_enabled) return `<span class="imap-pill"><i></i><span>Not connected</span></span>`;
  if (a.last_error) return `<span class="imap-pill bad" title="${esc(a.last_error)}"><i></i><span>Inbox error</span></span>`;
  return `<span class="imap-pill ok"><i></i><span>${a.last_poll_at ? "Connected · " + when(a.last_poll_at) : "Connected"}</span></span>`;
}

function card(a) {
  const primary = a.id === "primary";
  return `<div class="card" style="max-width:760px;${a.is_active ? "border-color:#86efac" : ""}">
    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
      <div class="row"><b style="font-size:15px">${esc(a.label)}</b>${a.is_active ? `<span class="status-badge status-success">${icon("radio", 12)} Active — receiving now</span>` : `<span class="status-badge status-expired">Standby</span>`}</div>${pill(a)}</div>
    <dl class="kv" style="margin:12px 0"><dt>FamPay UPI ID</dt><dd>${esc(a.upi_id || "—")}</dd><dt>Linked Gmail</dt><dd>${esc(a.gmail_address || "—")}</dd></dl>
    <div class="row">
      ${a.is_active ? "" : `<button class="btn btn-primary btn-sm" data-act="activate" data-id="${a.id}">Make active</button>`}
      ${primary ? `<a class="btn btn-secondary btn-sm" href="/integrations.html">Edit in Integrations</a>`
        : `<button class="btn btn-secondary btn-sm" data-act="edit" data-id="${a.id}">Edit</button>
           <button class="btn btn-secondary btn-sm" data-act="test" data-id="${a.id}">Test inbox</button>
           ${a.has_app_password && a.is_enabled ? `<button class="btn btn-secondary btn-sm" data-act="disconnect" data-id="${a.id}">Disconnect</button>` : ""}
           <button class="btn btn-danger btn-sm" data-act="remove" data-id="${a.id}" data-name="${esc(a.label)}">${icon("trash-2", 14)} Remove</button>`}
    </div></div>`;
}

async function load() {
  state = await api("/merchant/accounts");
  const all = [state.primary, ...state.standby];
  $("cnt").textContent = all.length;
  $("add").disabled = all.length >= state.max;
  // active account first
  all.sort((x, y) => Number(y.is_active) - Number(x.is_active));
  $("list").innerHTML = all.map(card).join("");
}

function form(a) {
  const edit = !!a;
  modal({ title: edit ? "Edit account" : "Add FamPay account",
    body: `<p class="muted small" style="margin-top:0">Use a <b>different</b> wallet and Gmail from your primary account. Only mail from FamPay's official sender is read.</p>
      <label class="form-label">Label / nickname</label><input class="form-input" id="al" maxlength="60" value="${esc(a?.label === "Standby account" ? "" : a?.label || "")}" placeholder="e.g. Backup wallet" />
      <label class="form-label" style="margin-top:12px">FamPay UPI ID</label><input class="form-input" id="au" value="${esc(a?.upi_id || "")}" placeholder="name@fam" />
      <label class="form-label" style="margin-top:12px">Linked Gmail</label><input class="form-input" id="ag" type="email" value="${esc(a?.gmail_address || "")}" />
      <label class="form-label" style="margin-top:12px">Google app password</label><input class="form-input" id="ap" type="password" autocomplete="new-password" placeholder="${edit ? "Leave blank to keep the saved one" : "16-character code"}" />
      <div class="err-text" id="ae"></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn btn-primary" id="as">${edit ? "Save changes" : "Connect &amp; save"}</button>`,
    onMount: (el, close) => el.querySelector("#as").addEventListener("click", async (ev) => {
      ev.target.disabled = true; el.querySelector("#ae").textContent = "";
      const body = { label: el.querySelector("#al").value.trim(), upi_id: el.querySelector("#au").value.trim(), gmail_address: el.querySelector("#ag").value.trim(), app_password: el.querySelector("#ap").value.trim() || undefined };
      try { await api(edit ? `/merchant/accounts/${a.id}` : "/merchant/accounts", { method: edit ? "PUT" : "POST", body }); close(); toast(edit ? "Saved" : "Account added"); load(); }
      catch (e) { el.querySelector("#ae").textContent = e.message; ev.target.disabled = false; }
    }) });
}

$("add").addEventListener("click", () => form(null));
$("list").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const id = b.dataset.id, act = b.dataset.act, acc = state.standby.find((x) => String(x.id) === id);
  try {
    if (act === "activate") { await api(`/merchant/accounts/${id}/activate`, { method: "POST" }); toast("Receiving account switched"); load(); }
    if (act === "edit") form(acc);
    if (act === "test") { b.disabled = true; const r = await api(`/merchant/accounts/${id}/test`, { method: "POST" }); toast(r.message, !r.ok); b.disabled = false; }
    if (act === "disconnect" && await confirmBox({ title: "Disconnect inbox?", danger: true, confirmText: "Disconnect", text: "The saved app password is removed and automatic detection pauses for this account until you reconnect it." })) {
      await api(`/merchant/accounts/${id}/disconnect`, { method: "POST" }); load(); }
    if (act === "remove" && await confirmBox({ title: "Remove account?", danger: true, confirmText: "Remove", text: `Remove <b>${b.dataset.name}</b>? It will no longer receive payments. Past transactions stay in your history.` })) {
      await api(`/merchant/accounts/${id}`, { method: "DELETE" }); toast("Removed"); load(); }
  } catch (ex) { toast(ex.message, true); b.disabled = false; }
});

load().catch((e) => toast(e.message, true));
