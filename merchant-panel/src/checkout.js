// Shared checkout controller: loads the link, starts/reuses a QR session, polls for the result and
// tells the active design ("theme") what to show. Time is always the server's; the countdown is cosmetic.
import { api } from "./api.js";

export const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function slugFromUrl() {
  const q = new URLSearchParams(location.search).get("id");
  if (q) return q;
  const last = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
  return last.endsWith(".html") ? "" : last;
}

async function preview(theme) {
  const params = new URLSearchParams(location.search);
  const logo = params.get("logo") || "none";
  let qr = "";
  try { qr = (await api(`/public/sample-qr?logo=${encodeURIComponent(logo)}`, { auth: false })).qr; } catch {}
  const now = Date.now();
  const d = { slug: "pl_PREVIEW", store_name: "Your Store", amount: 499, customer_name: null, status: "ACTIVE", redirect_url: null,
    support_link: null, logo: null, paid: { ref: "••••4821", paid_at: new Date().toISOString() },
    payment: { reference: "PAYPREVIEW01", status: "WAITING_FOR_PAYMENT", live: true, qr_data_url: qr,
      upi_uri: "upi://pay?pa=demo@fam&pn=Preview&am=499.00&cu=INR", created_at: new Date(now).toISOString(),
      expires_at: new Date(now + 300000).toISOString(), server_time: new Date(now).toISOString() } };
  theme.init(d);
  let timer;
  const showQr = () => { clearInterval(timer); theme.qr(d, d.payment); const t0 = Date.now();
    timer = setInterval(() => theme.tick(Math.max(0, 300000 - (Date.now() - t0)), 300000), 500); };
  const showPaid = () => { clearInterval(timer); theme.paid({ ...d, status: "PAID" }); };
  document.body.insertAdjacentHTML("beforeend", `<div class="preview-bar"><span>Preview</span><button class="on" id="pvQr">Payment page</button><button id="pvPaid">Success screen</button></div>`);
  const mark = (id) => { document.querySelectorAll(".preview-bar button").forEach((b) => b.classList.toggle("on", b.id === id)); };
  document.getElementById("pvQr").onclick = () => { mark("pvQr"); location.reload(); };
  document.getElementById("pvPaid").onclick = () => { mark("pvPaid"); showPaid(); };
  showQr();
}

export async function runCheckout(theme) {
  if (new URLSearchParams(location.search).get("preview")) return preview(theme);
  const slug = slugFromUrl();
  if (!slug) return theme.error("Payment link not found.");
  const enc = encodeURIComponent(slug);
  let view = null, shown = "", timer = null, poller = null, offset = 0;

  const getView = () => api(`/public/links/${enc}`, { auth: false });
  const startSession = () => api(`/public/links/${enc}/session`, { method: "POST", auth: false });

  theme.onNewQr(async () => { try { render(await startSession()); } catch (e) { theme.error(e.message); } });

  function render(d) {
    const first = !view;
    view = d;
    if (first) theme.init(d);
    const p = d.payment;
    const key = [d.status, p?.status, p?.reference, p?.live ? 1 : 0].join(":");
    if (key === shown) return;
    shown = key;
    clearInterval(timer);
    if (d.status === "PAID") { clearInterval(poller); return theme.paid(d); }
    if (d.status === "EXPIRED") { clearInterval(poller); return theme.linkExpired(d); }
    if (d.status === "PENDING_VERIFICATION") return theme.pending(d);
    if (d.status === "REVIEW") return theme.review(d);
    if (!p || !p.live) return theme.qrExpired(d, !!p);
    offset = new Date(p.server_time).getTime() - Date.now();
    const total = new Date(p.expires_at) - new Date(p.created_at);
    theme.qr(d, p);
    const tick = () => {
      const left = Math.max(0, new Date(p.expires_at) - (Date.now() + offset));
      theme.tick(left, total);
      if (left <= 0) { clearInterval(timer); refresh(); }
    };
    tick();
    timer = setInterval(tick, 500);
  }

  async function refresh() { try { render(await getView()); } catch {} }

  try {
    let d = await getView();
    if (d.status === "ACTIVE" && !(d.payment && d.payment.live)) d = await startSession();
    render(d);
    poller = setInterval(refresh, 3000);
  } catch (e) {
    theme.error(e.message);
  }
}
