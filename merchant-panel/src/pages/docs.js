import { shell, head, icon, esc, API, copyText } from "../core.js";

const page = shell("docs");
const code = (c) => `<div style="position:relative"><button class="btn btn-secondary btn-sm" data-c style="position:absolute;right:8px;top:14px">${icon("copy", 13)}</button><pre class="docs-code">${esc(c)}</pre></div>`;
page.innerHTML = `${head("API Docs", "Create orders from your own site and get notified when they are paid.")}
<div class="card docs" style="max-width:860px">
<h3>Authentication</h3><p>Create a key under <a href="/api-keys.html">API Keys</a> and send it as a Bearer token. Keep it on your server only.</p>
${code(`Authorization: Bearer pk_live_xxxxxxxxxxxxxxxx`)}
<h3>Create an order</h3><p><code class="i">POST ${esc(API)}/api/v1/orders</code> returns a <code class="i">pay_url</code>. Redirect your customer there.</p>
${code(`curl -X POST ${API}/api/v1/orders \\
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \\
  -d '{"amount": 499, "customer_name": "Asha", "order_id": "ORD-1001",
       "redirect_url": "https://yourshop.com/thanks", "expires_in_minutes": 30}'`)}
${code(`{ "order": "pl_8F2A91C3", "order_id": "ORD-1001", "amount": 499.0, "currency": "INR",
  "status": "ACTIVE", "pay_url": "https://…/pay/pl_8F2A91C3", "expires_at": "2026-11-09T10:30:00+00:00" }`)}
<h3>Check an order</h3><p><code class="i">GET ${esc(API)}/api/v1/orders/{order}</code></p>
<p>Status is <code class="i">ACTIVE</code>, <code class="i">PAID</code>, <code class="i">PENDING_VERIFICATION</code>, <code class="i">REVIEW</code> or <code class="i">EXPIRED</code>. When <code class="i">PAID</code> you also get <code class="i">transaction_id</code>, <code class="i">utr</code> and <code class="i">payer_name</code>.</p>
<h3>Webhooks</h3><p>Add an endpoint under <a href="/webhooks.html">Webhooks</a>. On every verified payment we POST JSON and retry up to 5 times until your server answers 2xx.</p>
${code(`{ "event": "payment.verified", "created_at": "…",
  "data": { "order": "pl_8F2A91C3", "order_id": "ORD-1001", "reference": "PAY…", "amount": 499.0,
            "currency": "INR", "status": "VERIFIED", "transaction_id": "FMPIB…", "utr": "6673…", "payer_name": "…" } }`)}
<p>Verify the signature before trusting a webhook. Header <code class="i">X-Signature</code> is <code class="i">sha256=</code> + HMAC-SHA256 of the raw request body with your signing secret.</p>
${code(`// Node.js
import crypto from "node:crypto";
const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-signature"]));`)}
${code(`# Python
import hmac, hashlib
expected = "sha256=" + hmac.new(SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, request.headers["X-Signature"])`)}
<h3>How a payment is marked paid</h3><p>The customer pays by UPI. We read FamPay's alert email from your inbox (official sender, valid signature), match it to the order's QR, and mark it paid. This is based on the email alert, not a bank statement, so use your bank records for high-value disputes.</p>
</div>`;
page.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) copyText(b.parentElement.querySelector("pre").textContent, "Copied"); });
