// Design 3: single card with a progress bar and a confetti success screen.
import { BRAND } from "../api.js";
import { isMobile, mmss } from "../checkout.js";

const $ = (id) => document.getElementById(id);
const money = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function confetti() {
  const canvas = $("confetti-canvas"), ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = ["#10b981", "#4f46e5", "#0ea5e9", "#f59e0b", "#34d399", "#818cf8"];
  const ox = canvas.width / 2, oy = canvas.height * 0.36;
  const parts = Array.from({ length: 68 }, () => { const a = Math.random() * Math.PI * 2, s = 5 + Math.random() * 11;
    return { x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, size: 5 + Math.random() * 5, color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360, vr: (Math.random() - 0.5) * 14, alpha: 1, rect: Math.random() > 0.4 }; });
  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height); let live = 0;
    for (const p of parts) {
      if (p.alpha <= 0.02) continue; live++;
      p.x += p.vx; p.y += p.vy; p.vy += 0.32; p.vx *= 0.97; p.rot += p.vr; p.alpha -= 0.013;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha); ctx.translate(p.x, p.y); ctx.rotate((p.rot * Math.PI) / 180); ctx.fillStyle = p.color;
      if (p.rect) ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6); else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (live) requestAnimationFrame(frame); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}

export function makeCard() {
  let newQr = () => {}, redirectTimer = null, paidShown = false;
  const notice = (text, bad = true) => { $("qr-view").classList.add("hidden"); const n = $("noticeMsg"); n.hidden = false; n.className = "state-msg" + (bad ? " bad" : ""); n.textContent = text; };

  async function save(d, p) {
    const c = document.createElement("canvas"); c.width = 600; c.height = 700; const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, 600, 700);
    const img = new Image(); img.src = p.qr_data_url; await img.decode();
    x.imageSmoothingEnabled = false; x.drawImage(img, 80, 64, 440, 440);
    x.textAlign = "center"; x.fillStyle = "#0f172a"; x.font = "700 28px Inter, sans-serif"; x.fillText(d.store_name, 300, 560);
    x.fillStyle = "#4f46e5"; x.font = "700 26px Inter, sans-serif"; x.fillText(`Pay ${money(d.amount)}`, 300, 602);
    x.fillStyle = "#64748b"; x.font = "600 16px Inter, sans-serif"; x.fillText(`SCAN WITH ANY UPI APP • ${d.slug}`, 300, 640);
    const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `${d.slug}-QR.png`; a.click();
    const btn = $("save-qr-btn"); btn.classList.add("saved"); $("save-qr-text").textContent = "QR Saved!";
    setTimeout(() => { btn.classList.remove("saved"); $("save-qr-text").textContent = "Save QR"; }, 2000);
  }

  return {
    onNewQr(fn) { newQr = fn; $("btn-refresh-qr").addEventListener("click", () => newQr()); },
    init(d) {
      document.title = `Pay ${d.store_name}`;
      const av = $("store-avatar");
      if (d.logo) { av.innerHTML = `<img alt="" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">`; av.firstChild.src = d.logo; }
      else av.textContent = (d.store_name.match(/[A-Za-z0-9]/g) || ["M"]).slice(0, 2).join("").toUpperCase();
      $("store-name").textContent = d.store_name; $("order-id").textContent = `Order ${d.slug}`; $("amount-display").textContent = money(d.amount);
      $("brandFoot").textContent = BRAND;
      if (d.support_link) { const a = $("supportLink"); a.href = d.support_link; a.hidden = false; }
    },
    qr(d, p) {
      $("noticeMsg").hidden = true; $("qr-view").classList.remove("hidden"); $("expired-overlay").classList.remove("visible");
      $("qr-render-target").innerHTML = `<img alt="Scan to pay ${d.store_name.replace(/"/g, "")}">`; $("qr-render-target").firstChild.src = p.qr_data_url;
      $("expiry-date-text").textContent = new Date(p.expires_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      for (const el of [$("timer-pill"), $("progress-fill")]) el.classList.remove("warning", "danger");
      $("save-qr-btn").onclick = () => save(d, p);
      const u = $("upiBtn"); if (isMobile && p.upi_uri) { u.href = p.upi_uri; u.hidden = false; }
    },
    tick(left, total) {
      $("countdown-text").textContent = mmss(left);
      $("progress-fill").style.width = Math.max(0, (left / total) * 100) + "%";
      const warn = left <= 60000, danger = left <= 15000;
      for (const el of [$("timer-pill"), $("progress-fill")]) { el.classList.toggle("warning", warn && !danger); el.classList.toggle("danger", danger); }
    },
    qrExpired() { $("noticeMsg").hidden = true; $("qr-view").classList.remove("hidden"); $("expired-overlay").classList.add("visible"); $("countdown-text").textContent = "00:00"; },
    pending() { notice("We received your payment and are confirming it. This page updates automatically.", false); },
    review(d) { notice(`Your payment needs a manual check by the merchant. Please contact them with reference ${d.payment?.reference || ""}.`); },
    linkExpired() { notice("This payment link has expired. Please ask the merchant for a new one."); },
    paid(d) {
      if (paidShown) return; paidShown = true;
      $("noticeMsg").hidden = true;
      $("success-store-name").textContent = d.store_name; $("success-amount").textContent = money(d.amount);
      $("success-txn-id").textContent = d.paid?.ref || "—"; $("success-order-id").textContent = d.slug;
      $("success-time").textContent = new Date(d.paid?.paid_at || Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const box = document.querySelector(".redirect-box");
      if (d.redirect_url) $("redirect-label").textContent = "Redirecting back to store…"; else if (box) box.style.display = "none";
      $("qr-view").classList.add("is-leaving");
      setTimeout(() => {
        $("qr-view").classList.add("hidden"); $("qr-view").classList.remove("is-leaving");
        const sv = $("success-view"); sv.classList.remove("hidden"); void sv.offsetWidth; sv.classList.add("active");
        confetti();
        if (d.redirect_url) { clearTimeout(redirectTimer); redirectTimer = setTimeout(() => { location.href = d.redirect_url; }, 4700); }
      }, 260);
    },
    error(text) { notice(text); },
  };
}
