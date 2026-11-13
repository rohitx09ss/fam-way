// Designs 1 and 2: the blue gateway frame with a details list. Design 2 renders a rounded-dot QR in the browser.
import { BRAND } from "../api.js";
import { isMobile, mmss } from "../checkout.js";

const $ = (id) => document.getElementById(id);
const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });

export function makeClassic({ styled = false } = {}) {
  let newQr = () => {}, styledQr = null, current = null, redirectTimer = null;

  const sections = (qr, success) => { $("qrSection").style.display = qr ? "flex" : "none"; $("successSection").style.display = success ? "flex" : "none"; };
  const status = (text, verified = false) => { set("statusText", text); $("statusBadge").classList.toggle("verified", verified); };
  const label = (text) => { $("expiryRow").querySelector(".detail-label").textContent = text; };
  const msg = (html, bad = false, withButton = false) => {
    sections(false, false);
    const m = $("stateMsg"); m.hidden = false; m.className = "state-msg" + (bad ? " bad" : "");
    m.innerHTML = `<div></div>${withButton ? '<button type="button" id="newQrBtn">Show a new QR</button>' : ""}`;
    m.firstChild.textContent = html;
    if (withButton) $("newQrBtn").addEventListener("click", () => newQr());
  };

  async function drawStyled(d, p) {
    const box = $("qrcode");
    box.innerHTML = `<img id="qrImg" alt="UPI QR code" src="${p.qr_data_url}">`;   // scannable fallback first
    try {
      if (!window.QRCodeStyling) await loadScript("https://cdn.jsdelivr.net/npm/qr-code-styling@1.5.0/lib/qr-code-styling.js");
      const opts = { width: 420, height: 420, type: "canvas", data: p.upi_uri, margin: 10,
        qrOptions: { typeNumber: 0, mode: "Byte", errorCorrectionLevel: "H" },
        imageOptions: { hideBackgroundDots: true, imageSize: 0.26, margin: 6 },
        dotsOptions: { color: "#0f172a", type: "rounded" }, backgroundOptions: { color: "#ffffff" },
        cornersSquareOptions: { color: "#1d4ed8", type: "extra-rounded" }, cornersDotOptions: { color: "#0f172a", type: "dot" } };
      if (d.logo) opts.image = d.logo;
      styledQr = new window.QRCodeStyling(opts);
      box.innerHTML = "";
      styledQr.append(box);
    } catch { styledQr = null; }
  }

  return {
    onNewQr(fn) { newQr = fn; },
    init(d) {
      document.title = `Pay ${d.store_name}`;
      set("brandName", d.store_name); set("orderAmount", d.amount.toFixed(2)); set("merchantName", d.store_name);
      set("orderId", d.slug); set("payeeName", d.store_name); set("brandFoot", BRAND);
      if (d.support_link) { const a = $("supportLink"); a.href = d.support_link; a.hidden = false; }
    },
    qr(d, p) {
      current = { d, p };
      $("stateMsg").hidden = true; sections(true, false);
      if (styled) drawStyled(d, p); else $("qrImg").src = p.qr_data_url;
      set("gatewayId", p.reference); label("Expires In"); status("Waiting for payment…");
      $("saveQr").onclick = () => {
        if (styledQr) return styledQr.download({ name: `${d.slug}_QR`, extension: "png" });
        const a = document.createElement("a"); a.href = p.qr_data_url; a.download = `${d.slug}_QR.png`; a.click();
      };
      const u = $("upiBtn"); if (isMobile && p.upi_uri) { u.href = p.upi_uri; u.hidden = false; }
    },
    tick(left) { const el = $("countdownTimer"); el.textContent = "Expires in " + mmss(left); el.style.color = left < 30000 ? "#ef4444" : ""; },
    qrExpired(d, had) { msg(had ? "This QR has expired." : "Ready to pay?", true, true); status("QR expired"); set("countdownTimer", "Expired"); },
    pending() { msg("We received your payment and are confirming it. This page updates automatically."); status("Verifying payment…"); set("countdownTimer", "—"); },
    review(d) { msg(`Your payment needs a manual check by the merchant. Please contact them with reference ${d.payment?.reference || ""}.`, true); status("Needs review"); },
    linkExpired() { msg("This payment link has expired. Please ask the merchant for a new one.", true); status("Expired"); set("countdownTimer", "Expired"); },
    paid(d) {
      $("stateMsg").hidden = true; sections(false, true);
      set("paidAmountText", d.amount.toFixed(2)); set("utrNumber", d.paid?.ref || "—"); status("Payment Completed", true); label("Paid At");
      set("countdownTimer", new Date(d.paid?.paid_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      if (d.redirect_url) {
        const a = document.createElement("a"); a.className = "return-btn"; a.href = d.redirect_url; a.textContent = "Return to merchant";
        document.querySelector(".success-banner").appendChild(a);
        clearTimeout(redirectTimer); redirectTimer = setTimeout(() => { location.href = d.redirect_url; }, 4500);
      }
    },
    error(text) { msg(text, true); },
  };
}
