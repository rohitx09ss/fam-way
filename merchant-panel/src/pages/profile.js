import { shell, api, head, icon, esc, day, toast, setSession, getToken, getUser, soundOn, setSound, announce } from "../core.js";

const page = shell("profile");

const art = {
  1: `<svg viewBox="0 0 120 150"><rect x="8" y="8" width="104" height="134" rx="12" fill="#e8f0fb"/><rect x="18" y="18" width="40" height="8" rx="3" fill="#94a3b8"/><rect x="18" y="32" width="56" height="12" rx="3" fill="#0f172a"/><rect x="18" y="52" width="84" height="64" rx="8" fill="#fff"/><rect x="40" y="62" width="40" height="40" rx="4" fill="#0f172a"/><rect x="18" y="122" width="84" height="6" rx="3" fill="#cbd5e1"/></svg>`,
  2: `<svg viewBox="0 0 120 150"><rect x="8" y="8" width="104" height="134" rx="12" fill="#e8f0fb"/><rect x="18" y="18" width="40" height="8" rx="3" fill="#94a3b8"/><rect x="18" y="32" width="56" height="12" rx="3" fill="#0f172a"/><rect x="18" y="52" width="84" height="64" rx="8" fill="#fff"/><g fill="#0f172a"><circle cx="48" cy="72" r="4"/><circle cx="60" cy="72" r="4"/><circle cx="72" cy="72" r="4"/><circle cx="48" cy="84" r="4"/><circle cx="72" cy="84" r="4"/><circle cx="48" cy="96" r="4"/><circle cx="60" cy="96" r="4"/><circle cx="72" cy="96" r="4"/></g><circle cx="60" cy="84" r="7" fill="#2563eb"/><rect x="18" y="122" width="84" height="6" rx="3" fill="#cbd5e1"/></svg>`,
  3: `<svg viewBox="0 0 120 150"><rect x="8" y="8" width="104" height="134" rx="14" fill="#fff" stroke="#e2e8f0"/><circle cx="26" cy="26" r="9" fill="#4f46e5"/><rect x="40" y="20" width="44" height="7" rx="3" fill="#0f172a"/><rect x="40" y="31" width="30" height="5" rx="2" fill="#94a3b8"/><rect x="30" y="48" width="60" height="60" rx="8" fill="#f1f5f9"/><rect x="40" y="58" width="40" height="40" rx="4" fill="#0f172a"/><rect x="18" y="120" width="84" height="6" rx="3" fill="#e2e8f0"/><rect x="18" y="120" width="52" height="6" rx="3" fill="#10b981"/></svg>`,
};
const THEMES = [[1, "Classic frame", "Blue frame with order details"], [2, "Rounded QR", "Rounded-dot styled QR"], [3, "Card + confetti", "Clean card, timer bar, confetti"]];

page.innerHTML = `${head("Profile", "Your account, checkout page and alerts.")}
<div class="grid-2">
  <div>
    <form class="card" id="pf"><div class="card-title">${icon("user-circle", 18)} <span>Personal details</span></div>
      <dl class="kv" style="margin:12px 0"><dt>Merchant ID</dt><dd class="mono" id="mid">—</dd><dt>Email</dt><dd id="em">—</dd><dt>Member since</dt><dd id="since">—</dd></dl>
      <label class="form-label">Full name</label><input class="form-input" id="name" maxlength="120" />
      <label class="form-label" style="margin-top:12px">Phone number</label><input class="form-input" id="phone" maxlength="20" inputmode="tel" />
      <label class="form-label" style="margin-top:12px">Store name</label><input class="form-input" id="store" maxlength="120" />
      <label class="form-label" style="margin-top:12px">WhatsApp number (customer support)</label><input class="form-input" id="wa" maxlength="20" inputmode="tel" placeholder="+91 98765 43210" />
      <p class="muted small" style="margin:6px 0 0">Customers see a "Need help? WhatsApp the merchant" button on your checkout page. Enter the number with country code (10-digit numbers are treated as India +91).</p>
      <div id="pm" class="err-text"></div><div class="row" style="margin-top:14px"><button class="btn btn-primary">Save changes</button></div></form>

    <div class="card"><div class="card-title">${icon("layout-dashboard", 18)} <span>Checkout page design</span></div>
      <p class="muted small" style="margin:4px 0 0">What your customers see when they open a payment link. Applies to all your links.</p>
      <div class="theme-grid" id="themes">${THEMES.map(([n, name, sub]) => `<div><button type="button" class="tile" data-t="${n}">${art[n]}<span class="nm">${name}</span><small>${sub}</small></button>
        <a class="small" data-prev="${n}" target="_blank" rel="noopener" href="#" style="display:block;margin:6px 2px 0;font-weight:600">Preview →</a></div>`).join("")}</div>
      <div id="tm" class="ok-text"></div></div>

    <div class="card"><div class="card-title">${icon("image", 18)} <span>QR centre logo</span></div>
      <p class="muted small" style="margin:4px 0 0">Shown in the middle of your QR codes. Keep it simple so the QR stays easy to scan.</p>
      <div class="row" style="align-items:flex-start;gap:18px;margin-top:6px"><div style="flex:1;min-width:240px"><div class="tile-grid" id="logos"></div>
        <div class="row"><label class="btn btn-secondary btn-sm" style="cursor:pointer">${icon("upload", 14)} Upload your own<input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label></div></div>
        <div><img class="qr-prev" id="qrPrev" alt="QR preview" /><div class="muted small" style="margin-top:4px">Preview</div></div></div>
      <div id="lm" class="err-text"></div></div>
  </div>
  <div>
    <form class="card" id="wf"><div class="card-title">${icon("lock", 18)} <span>Change password</span></div>
      <label class="form-label" style="margin-top:12px">Current password</label><input class="form-input" id="cur" type="password" autocomplete="current-password" required />
      <label class="form-label" style="margin-top:12px">New password</label><input class="form-input" id="nw" type="password" minlength="8" autocomplete="new-password" required />
      <div id="wm" class="err-text"></div><div class="row" style="margin-top:14px"><button class="btn btn-primary">Update password</button></div></form>

    <div class="card"><div class="card-title">${icon("bell", 18)} <span>Payment alerts</span></div>
      <p class="muted small">Play a sound (and show a browser notification) whenever a payment is confirmed while a dashboard tab is open on this device.</p>
      <label class="row" style="gap:10px;font-weight:500"><input type="checkbox" id="snd" style="width:auto" /> Instant payment alerts on this device</label>
      <div class="row" style="margin-top:12px"><button class="btn btn-secondary btn-sm" id="testSnd">Send test alert</button></div></div>
  </div>
</div>`;
const $ = (id) => document.getElementById(id);
let me = null, opts = null;

function fillMe(m) {
  me = m;
  $("mid").textContent = m.merchant_id; $("em").textContent = m.email; $("since").textContent = day(m.created_at);
  $("name").value = m.name; $("phone").value = m.phone; $("store").value = m.store_name; $("wa").value = m.whatsapp ? "+" + m.whatsapp : "";
  document.querySelectorAll("#themes .tile").forEach((t) => t.classList.toggle("sel", Number(t.dataset.t) === m.checkout_theme));
  const logoParam = m.logo_choice.startsWith("preset:") ? m.logo_choice : "none";
  document.querySelectorAll("[data-prev]").forEach((a) => { a.href = `/pay-${a.dataset.prev}.html?preview=1&logo=${encodeURIComponent(logoParam)}`; });
}

function drawLogos() {
  const cur = me.logo_choice;
  const items = [{ id: "none", label: "No logo", img: null }, { id: "custom", label: "Your logo", img: opts.custom }, ...opts.presets.map((p) => ({ id: "preset:" + p.id, label: p.label, img: p.data_url }))];
  $("logos").innerHTML = items.map((i) => `<button type="button" class="tile ${cur === i.id ? "sel" : ""}" data-c="${esc(i.id)}" ${i.id === "custom" && !i.img ? "disabled" : ""}>
    ${i.img ? `<img alt="" src="${i.img}" />` : `<div style="height:52px;display:grid;place-items:center;color:var(--color-ink-mute);margin-bottom:6px">${icon(i.id === "none" ? "ban" : "upload", 22)}</div>`}<span class="nm">${esc(i.id === "custom" && !i.img ? "Upload to use" : i.label)}</span></button>`).join("");
  refreshPreview();
}
async function refreshPreview(choice) {
  try { $("qrPrev").src = (await api("/merchant/qr-preview?choice=" + encodeURIComponent(choice || me.logo_choice))).qr; } catch {}
}
async function loadAll() {
  fillMe(await api("/merchant/me"));
  opts = await api("/merchant/logo-options");
  drawLogos();
}
loadAll().catch((e) => toast(e.message, true));
const remember = (m) => setSession(getToken(), { ...getUser(), ...m, avatar: undefined });

$("pf").addEventListener("submit", async (e) => { e.preventDefault();
  try { const m = await api("/merchant/profile", { method: "PUT", body: { name: $("name").value, phone: $("phone").value, store_name: $("store").value, whatsapp: $("wa").value } });
    remember(m); fillMe(m); $("pm").className = "ok-text"; $("pm").textContent = "Saved."; }
  catch (ex) { $("pm").className = "err-text"; $("pm").textContent = ex.message; } });

$("themes").addEventListener("click", async (e) => {
  const t = e.target.closest(".tile"); if (!t) return;
  try { const m = await api("/merchant/checkout-theme", { method: "PUT", body: { theme: Number(t.dataset.t) } }); fillMe(m); $("tm").textContent = "Checkout design saved."; }
  catch (ex) { toast(ex.message, true); }
});

$("logos").addEventListener("click", async (e) => {
  const t = e.target.closest(".tile"); if (!t || t.disabled) return; $("lm").textContent = "";
  try { const m = await api("/merchant/logo-choice", { method: "PUT", body: { choice: t.dataset.c } }); fillMe(m); drawLogos(); }
  catch (ex) { $("lm").textContent = ex.message; }
});

$("file").addEventListener("change", () => {
  const f = $("file").files[0]; if (!f) return; $("lm").textContent = "";
  if (f.size > 2_000_000) { $("lm").textContent = "Image is too large (max 2 MB)"; return; }
  const r = new FileReader();
  r.onload = async () => { try { await api("/merchant/avatar", { method: "POST", body: { image: r.result } }); toast("Logo saved"); await loadAll(); } catch (ex) { $("lm").textContent = ex.message; } };
  r.readAsDataURL(f);
});

$("wf").addEventListener("submit", async (e) => { e.preventDefault();
  try { await api("/merchant/password", { method: "POST", body: { current_password: $("cur").value, new_password: $("nw").value } });
    $("cur").value = ""; $("nw").value = ""; $("wm").className = "ok-text"; $("wm").textContent = "Password updated."; }
  catch (ex) { $("wm").className = "err-text"; $("wm").textContent = ex.message; } });

$("snd").checked = soundOn();
$("snd").addEventListener("change", () => setSound($("snd").checked));
$("testSnd").addEventListener("click", () => announce({ amount: 1, payer_name: "Test payer" }));
