import { shell, api, head, icon, esc, day, toast, modal, setSession, getToken, getUser, soundOn, setSound, announce } from "../core.js";

const page = shell("profile");
page.innerHTML = `${head("Profile", "Your account details, branding, password and alerts.")}
<div class="grid-2">
  <div>
    <form class="card" id="pf"><div class="card-title">${icon("user-circle", 18)} <span>Personal details</span></div>
      <dl class="kv" style="margin:12px 0"><dt>Merchant ID</dt><dd class="mono" id="mid">—</dd><dt>Email</dt><dd id="em">—</dd><dt>Member since</dt><dd id="since">—</dd></dl>
      <label class="form-label">Full name</label><input class="form-input" id="name" maxlength="120" />
      <label class="form-label" style="margin-top:12px">Phone number</label><input class="form-input" id="phone" maxlength="20" inputmode="tel" />
      <label class="form-label" style="margin-top:12px">Store name</label><input class="form-input" id="store" maxlength="120" />
      <label class="form-label" style="margin-top:12px">Support / contact link</label><input class="form-input" id="support" maxlength="300" placeholder="https://wa.me/91XXXXXXXXXX  or  mailto:help@shop.com" />
      <p class="muted small" style="margin:6px 0 0">Shown to customers on your checkout page as "Need help?".</p>
      <div id="pm" class="err-text"></div><div class="row" style="margin-top:14px"><button class="btn btn-primary">Save changes</button></div></form>

    <div class="card"><div class="card-title">${icon("image", 18)} <span>QR branding</span></div>
      <p class="muted small">Your logo is placed in the centre of every QR code customers scan. Square images work best; it is cropped to a square automatically.</p>
      <div class="row" style="gap:16px"><img id="av" alt="" style="width:72px;height:72px;border-radius:12px;border:1px solid var(--color-hairline);object-fit:cover;display:none" />
        <div class="row"><label class="btn btn-secondary btn-sm" style="cursor:pointer">${icon("upload", 14)} Choose image<input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label>
        <button class="btn btn-secondary btn-sm" id="avDel" style="display:none">Remove</button></div></div><div id="avm" class="err-text"></div></div>
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
let me = null;

function fill(m) {
  me = m;
  $("mid").textContent = m.merchant_id; $("em").textContent = m.email; $("since").textContent = day(m.created_at);
  $("name").value = m.name; $("phone").value = m.phone; $("store").value = m.store_name; $("support").value = m.support_link;
  $("av").style.display = m.avatar ? "block" : "none"; if (m.avatar) $("av").src = m.avatar; $("avDel").style.display = m.avatar ? "inline-flex" : "none";
}
api("/merchant/me").then(fill).catch((e) => toast(e.message, true));
const remember = (m) => setSession(getToken(), { ...getUser(), ...m, avatar: undefined });

$("pf").addEventListener("submit", async (e) => { e.preventDefault();
  try { const m = await api("/merchant/profile", { method: "PUT", body: { name: $("name").value, phone: $("phone").value, store_name: $("store").value, support_link: $("support").value } });
    remember(m); fill(m); $("pm").className = "ok-text"; $("pm").textContent = "Saved."; }
  catch (ex) { $("pm").className = "err-text"; $("pm").textContent = ex.message; } });

$("wf").addEventListener("submit", async (e) => { e.preventDefault();
  try { await api("/merchant/password", { method: "POST", body: { current_password: $("cur").value, new_password: $("nw").value } });
    $("cur").value = ""; $("nw").value = ""; $("wm").className = "ok-text"; $("wm").textContent = "Password updated."; }
  catch (ex) { $("wm").className = "err-text"; $("wm").textContent = ex.message; } });

$("file").addEventListener("change", () => {
  const f = $("file").files[0]; if (!f) return; $("avm").textContent = "";
  if (f.size > 2_000_000) { $("avm").textContent = "Image is too large (max 2 MB)"; return; }
  const r = new FileReader();
  r.onload = async () => { try { const m = await api("/merchant/avatar", { method: "POST", body: { image: r.result } }); fill(m); toast("Logo saved"); } catch (ex) { $("avm").textContent = ex.message; } };
  r.readAsDataURL(f);
});
$("avDel").addEventListener("click", async () => { try { fill(await api("/merchant/avatar", { method: "DELETE" })); } catch (ex) { toast(ex.message, true); } });

$("snd").checked = soundOn();
$("snd").addEventListener("change", () => setSound($("snd").checked));
$("testSnd").addEventListener("click", () => announce({ amount: 1, payer_name: "Test payer" }));
