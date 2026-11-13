// /pay/<id> entry point: look up which checkout design the merchant picked and go there.
import { api } from "../api.js";

const last = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const slug = last && !last.endsWith(".html") ? last : new URLSearchParams(location.search).get("id") || "";
const say = (t) => { document.body.innerHTML = '<p id="m" style="font-family:system-ui,sans-serif;padding:28px;color:#475569"></p>'; document.getElementById("m").textContent = t; };

say("Loading checkout…");
(async () => {
  if (!slug) return say("Payment link not found.");
  try {
    const d = await api(`/public/links/${encodeURIComponent(slug)}`, { auth: false });
    const n = [1, 2, 3].includes(d.theme) ? d.theme : 1;
    location.replace(`/pay-${n}.html?id=${encodeURIComponent(slug)}`);
  } catch (e) { say(e.message); }
})();
