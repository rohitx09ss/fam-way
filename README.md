# Dynamic UPI QR Payment Verification

Merchants generate a fixed-amount UPI QR with a **server-side 5-minute expiry**. A background worker
watches each merchant's Gmail inbox (IMAP over SSL) for FamPay payment emails, matches them to the
right QR, and shows the result in the dashboard.

```
backend/         FastAPI + SQLAlchemy  -> Render
merchant-panel/  React (Vite)          -> Vercel project 1
admin-panel/     React (Vite)          -> Vercel project 2
Database         Neon Postgres
```

## Honest verification model

A FamPay email is an **alert, not proof of settlement**. A matched email moves a request to
`PAYMENT_DETECTED` and the UI shows **PAYMENT DETECTED — VERIFICATION PENDING**. `VERIFIED` is set only when:

1. a verification adapter (`backend/app/verification.py`, e.g. your bank/payment-provider API) confirms it, or
2. the merchant presses "Mark as verified" after checking their bank app (audited).

With `VERIFICATION_ADAPTER=none` (default) nothing is ever auto-verified.

## Matching rules (`backend/app/matching.py`)

- Email must come from FamPay's official sender (`FAMPAY_OFFICIAL_SENDERS`, set once on the server, same for all merchants) **and** carry a DKIM/SPF pass for that same domain, as recorded by the receiving Gmail (`REQUIRE_EMAIL_AUTH`). Anything else is ignored or rejected.
- Transaction ID is unique per merchant (DB constraint) -> duplicates are recorded as `DUPLICATE`, never re-applied.
- QR carries the reference in the UPI note (`tn`). If the email contains it, amount + time window must also match.
- No reference: matches only if **exactly one** open request has that amount inside the time window
  (turn off with `ALLOW_UNIQUE_AMOUNT_MATCH=false`). Two or more -> `AMBIGUOUS`, nothing is assigned;
  the merchant picks the right QR in *Email review*.
- Time is judged by the payment's timestamp vs the QR window, so a slow email poll does not wrongly expire a paid QR.
  Payment after expiry -> `LATE`, request becomes `REVIEW_REQUIRED`.

## Deploy

### 1. Neon
Create a project, copy the connection string (`...?sslmode=require`). Tables are created on first start.

### 2. Render (backend)
New Web Service -> repo -> **Root directory `backend`**, build `pip install -r requirements.txt`,
start `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (or use `render.yaml`). Set env vars from `backend/.env.example`:
`DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY` (Fernet), `FAMPAY_OFFICIAL_SENDERS` (already `no-reply@famapp.in`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `FRONTEND_ORIGINS` (both Vercel URLs).
Swagger docs: `https://<service>.onrender.com/docs`.

> Render free sleeps when idle, and the inbox worker sleeps with it. Ping `/healthz` every 5 minutes
> (UptimeRobot) or use a paid instance if payments must be detected around the clock.

### 3. Vercel (two projects, same repo)
- Project 1: root `merchant-panel`, env `VITE_API_URL=https://<service>.onrender.com`
- Project 2: root `admin-panel`, same env
Then add both Vercel URLs to `FRONTEND_ORIGINS` on Render and redeploy.

## First run
1. Sign in at the admin panel with `ADMIN_EMAIL` / `ADMIN_PASSWORD`; create a merchant (or set `ALLOW_SIGNUP=true`).
2. Merchant panel -> Settings: store name, UPI ID, Gmail address, Gmail **app password**,
   turn on "Watch this inbox", then "Test inbox connection".
3. Payments -> Generate QR.

## Tune the email parser (important)
The parser already understands the real FamPay layout ("You have successfully received ₹1.0 from <name>",
Transaction ID, UTR, "11:54 AM IST, 03 November 2026"). The payer name, Transaction ID and UTR are saved and shown
in the merchant panel (QR panel, history table, email review). Existing databases get the new columns automatically on start.
If FamPay changes the wording, compare an email with the regexes at the top of `backend/app/email_parser.py`
(`AMOUNT_RE`, `TXN_RE`, `REF_RE`, timestamp patterns) and `PAYMENT_KEYWORDS`. Different wording needs a small tweak.
Many UPI apps do not include the QR note in the email; the unique-amount rule then applies.

## Local development
```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env   # DATABASE_URL=sqlite:///./dev.db works locally
uvicorn app.main:app --reload
pytest                                                    # success, duplicate, late, mismatch, ambiguous, auth, parser
cd ../merchant-panel && npm i && cp .env.example .env && npm run dev   # :5173
cd ../admin-panel    && npm i && cp .env.example .env && npm run dev   # :5174
```
Set `VITE_API_URL=http://localhost:8000` in the panel `.env` files.

## Security notes
- Gmail app passwords are Fernet-encrypted in the DB and never returned by any API.
- Separate admin/merchant login endpoints and role-checked JWTs; login throttling (per process).
- Audit log records logins, settings changes, payment state changes and manual decisions.
- Before production: rotate all default secrets, add Alembic migrations, and move login throttling to Redis if you scale out.
