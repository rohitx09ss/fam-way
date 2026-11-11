import { icons } from "./icons.js";
import "./css/base.css";
import "./app.css";

import { API, BRAND, getToken, getUser, setSession, logout, api } from "./api.js";
export { API, BRAND, getToken, getUser, setSession, logout, api };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const icon = (name, size = 16) =>
  `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;

export const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(Number(n) || 0);
export const when = (iso) => iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
export const day = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";

export function toast(msg, isErr = false) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " err" : "");
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export async function copyText(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch {} ta.remove();
  }
  toast(label);
}

/** Modal. Returns { el, close }. `body`/`footer` are HTML strings. */
export function modal({ title, body = "", footer = "", onMount }) {
  const back = document.createElement("div");
  back.className = "mdl-backdrop";
  back.innerHTML = `<div class="mdl-box" role="dialog" aria-modal="true"><div class="mdl-head"><h3>${esc(title)}</h3>
    <button class="btn btn-secondary btn-sm" data-close aria-label="Close">${icon("x")}</button></div>
    <div class="mdl-body">${body}</div><div class="mdl-foot">${footer}</div></div>`;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  document.body.appendChild(back);
  if (onMount) onMount(back, close);
  return { el: back, close };
}

export function confirmBox({ title, text, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const m = modal({ title, body: `<p style="margin:0">${text}</p>`,
      footer: `<button class="btn btn-secondary" data-close>Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>`,
      onMount: (el) => {
        el.querySelector("[data-ok]").addEventListener("click", () => { resolve(true); el.remove(); });
        el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) resolve(false); });
      } });
    return m;
  });
}

// ---- payment alerts: sound + browser notification while a dashboard tab is open ----
export const soundOn = () => localStorage.getItem("pg_sound") === "1";
export function setSound(on) {
  localStorage.setItem("pg_sound", on ? "1" : "0");
  if (on) {
    localStorage.setItem("pg_alert_since", new Date().toISOString());
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }
}
export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175, 1568].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.17;
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t); o.stop(t + 0.17);
    });
  } catch {}
}
export function announce(item) {
  const text = `${money(item.amount)} received${item.payer_name ? " from " + item.payer_name : ""}`;
  beep(); toast(text);
  if ("Notification" in window && Notification.permission === "granted") { try { new Notification("Payment received", { body: text }); } catch {} }
}
let alertsStarted = false;
function startAlerts() {
  if (alertsStarted) return; alertsStarted = true;
  setInterval(async () => {
    if (!soundOn()) return;
    try {
      const r = await api("/merchant/alerts?since=" + encodeURIComponent(localStorage.getItem("pg_alert_since") || new Date().toISOString()));
      r.items.forEach(announce);
      localStorage.setItem("pg_alert_since", r.items.length ? r.items[r.items.length - 1].verified_at : r.now);
    } catch {}
  }, 8000);
}

export function statusBadge(p) {
  const map = {
    VERIFIED: ["status-success", "Captured", "check-circle-2"], WAITING_FOR_PAYMENT: ["status-pending", "Created", "clock"],
    CREATED: ["status-pending", "Created", "clock"], PAYMENT_DETECTED: ["status-pending", "Verification pending", "clock"],
    VERIFYING: ["status-pending", "Verifying", "clock"], EXPIRED: ["status-expired", "Expired", "clock"],
    FAILED: ["status-failed", "Failed", "x-circle"], REVIEW_REQUIRED: ["status-failed", "Needs review", "alert-circle"],
  };
  const [cls, label, ic] = map[p.status] || ["status-expired", p.status, "info"];
  return `<span class="status-badge ${cls}">${icon(ic, 12)} ${label}</span>`;
}

/** Single-series area chart as inline SVG. */
export function areaChart(el, labels, values, { color = "#2563eb", fmt = (v) => v } = {}) {
  const W = 800, H = 300, L = 52, R = 14, T = 14, B = 30;
  const max = Math.max(1, ...values), top = max * 1.15;
  const x = (i) => L + (labels.length <= 1 ? 0 : (i * (W - L - R)) / (labels.length - 1));
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = top * f, yy = y(v);
    return `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#e2e8f0"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${fmt(Math.round(v))}</text>`; }).join("");
  const step = Math.ceil(labels.length / 7);
  const xl = labels.map((l, i) => (i % step === 0 || i === labels.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#94a3b8">${esc(l)}</text>` : "").join("");
  const dots = values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"><title>${esc(labels[i])}: ${fmt(v)}</title></circle>`).join("");
  const area = pts.length ? `<polygon points="${L},${y(0)} ${pts.join(" ")} ${x(values.length - 1)},${y(0)}" fill="${color}" fill-opacity=".09"/>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${grid}${xl}${area}<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${dots}</svg>`;
}

const NAV = [
  ["dashboard", "index.html", "Dashboard", "layout-dashboard"], ["transactions", "transactions.html", "Transactions", "receipt"],
  ["links", "payment-links.html", "Payment Links", "link-2"], ["keys", "api-keys.html", "API Keys", "key-round"],
  ["webhooks", "webhooks.html", "Webhooks", "send"],
];
const NAV2 = [
  ["integrations", "integrations.html", "Integrations", "plug-zap"], ["accounts", "accounts.html", "Multi-Accounts", "wallet"], ["docs", "docs.html", "API Docs", "book-open"],
  ["profile", "profile.html", "Profile", "user-circle"],
];

/** Renders the app shell (sidebar, mobile header) and returns the content container. */
export function shell(active) {
  if (!getToken()) { location.href = "/login.html"; throw new Error("redirect"); }
  const u = getUser();
  const item = ([k, href, label, ic]) => `<a class="sidebar-item ${k === active ? "active" : ""}" href="/${href}">${icon(ic)} ${label}</a>`;
  document.body.innerHTML = `
  <div class="dashboard-layout">
    <div class="mobile-header">
      <a class="brand-row" href="/index.html"><span class="brand-mark">${icon("zap", 17)}</span>${esc(BRAND)}</a>
      <button class="mobile-menu-btn" id="openSidebar" aria-label="Open menu">${icon("menu", 22)}</button>
    </div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header" style="padding:20px 16px 8px"><div style="display:flex;justify-content:space-between;align-items:center">
        <a class="brand-row" href="/index.html"><span class="brand-mark">${icon("zap", 17)}</span>${esc(BRAND)}</a>
        <button class="mobile-menu-btn" id="closeSidebar" aria-label="Close menu" style="display:none">${icon("x", 20)}</button></div></div>
      <nav class="sidebar-nav"><div class="sidebar-section-label">Main</div>${NAV.map(item).join("")}
        <div class="sidebar-section-label">Settings</div>${NAV2.map(item).join("")}</nav>
      <div class="sidebar-footer">
        <a class="sidebar-user-card" href="/profile.html"><div style="overflow:hidden;min-width:0;flex:1">
          <div class="sidebar-user-name" id="sbName" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.name || u.store_name || "Merchant")}</div>
          <div class="sidebar-user-role" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.email || "")}</div></div></a>
        <div class="sidebar-mid-pill" id="midPill" title="Click to copy Merchant ID" style="cursor:pointer"><span class="sidebar-mid-label"><span class="sidebar-mid-dot"></span>MID: <code id="midText">${esc(u.merchant_id || "—")}</code></span><span class="sidebar-mid-copy-btn">${icon("copy", 12)}</span></div>
        <a class="sidebar-logout" href="#" id="logoutBtn">${icon("log-out", 15)} Sign out</a>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebarOverlay"></div>
    <main class="main-content"><div class="wrap" id="page"></div></main>
  </div>`;
  const sb = document.getElementById("sidebar");
  const setOpen = (on) => { sb.classList.toggle("open", on); document.body.style.overflow = on ? "hidden" : ""; };
  document.getElementById("openSidebar").addEventListener("click", () => setOpen(true));
  document.getElementById("closeSidebar").addEventListener("click", () => setOpen(false));
  document.getElementById("sidebarOverlay").addEventListener("click", () => setOpen(false));
  sb.querySelectorAll("a.sidebar-item").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  const syncClose = () => { document.getElementById("closeSidebar").style.display = window.innerWidth <= 960 ? "flex" : "none"; if (window.innerWidth > 960) setOpen(false); };
  window.addEventListener("resize", syncClose); syncClose();
  document.getElementById("logoutBtn").addEventListener("click", (e) => { e.preventDefault(); logout(); });
  document.getElementById("midPill").addEventListener("click", () => copyText(getUser().merchant_id || "", "Merchant ID copied"));
  startAlerts();
  // refresh profile in the background (name / MID)
  api("/merchant/me").then((me) => {
    setSession(getToken(), { ...getUser(), ...me });
    document.getElementById("sbName").textContent = me.name || me.store_name || "Merchant";
    document.getElementById("midText").textContent = me.merchant_id;
  }).catch(() => {});
  return document.getElementById("page");
}

export const head = (title, sub, actions = "") =>
  `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="row">${actions}</div></div>`;
