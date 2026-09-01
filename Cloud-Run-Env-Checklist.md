# Cloud Run environment — what to set, what to leave out

Derived from the code on 18 Aug 2026, not from `.env.local`. Authority is
`lib/config/settings.ts` (every read, with its default) plus
`lib/config/chatMessageTrace.ts` for tracing.

Rule of thumb: `envTrim(process.env.X, 'default')` means **there is a default — don't set
it unless you want something different**. A bare `process.env.X!` or `envTrim(process.env.X)`
with no second argument means **no default — you must set it**.

---

## 1. Must set — the app won't work without these

| Var | Why |
|---|---|
| `GEMINI_API_KEY` | `settings.ts:8`, non-null asserted. No model, no agent. |
| `SITE_PASSWORD` | `settings.ts:24`, non-null asserted. Gates the console. |
| `GCP_PROJECT_ID` | `settings.ts:16` — KB storage. |
| `GCS_BUCKET_NAME` | `settings.ts:15` — KB storage. |
| `GCP_CLIENT_EMAIL` | `settings.ts:17` — service account. |
| `GCP_PRIVATE_KEY` | `settings.ts:18`. Literal `\n` sequences are converted for you. |
| `ZOHO_CLIENT_ID` | `settings.ts:27` — KB access. |
| `ZOHO_CLIENT_SECRET` | `settings.ts:28` |
| `ZOHO_REFRESH_TOKEN` | `settings.ts:29` |
| `ZOHO_ORG_ID` | `settings.ts:30` |

## 2. Must set for ORDER TRACKING to work

| Var | Value | Why |
|---|---|---|
| `ORDER_TRACKING_ENABLED` | `true` | `settings.ts:117`. **No default — absent means false.** While false, `OrderStatusGate` returns null and the widget serves the old "can't look up your order" deflection. This is the single most likely reason a green local test looks dead in production. |
| `DOTWMS_API_KEY` | Welly's key | `settings.ts:61`, no default. Empty = every lookup fails. |
| `MACHSHIP_TOKEN` | the 44-char token | `settings.ts:86`, no default. Empty = no tracking data. |

## 3. Must set for ALERTS to work

| Var | Value | Why |
|---|---|---|
| `ALERTS_ENABLED` | `true` | `settings.ts:132`. No default — absent means off. |
| `ALERTS_TRANSPORT` | `webhook` | `settings.ts:133`. **Defaults to `log`**, which silently sends nothing. Must be set. |
| `ALERTS_WEBHOOK_SECRET` | the shared secret | `settings.ts:144`, no default. The transport **fails closed** without it (`transports.ts:74`) — it will not transmit the PII payload unauthenticated. |
| `ALERTS_WEBHOOK_URL` | your n8n URL | `settings.ts:143` already defaults to `https://membersaces.app.n8n.cloud/webhook/htg`. Set it explicitly anyway so the endpoint isn't buried in code. |

## 4. Should set for production hardening

| Var | Value | Why |
|---|---|---|
| `CHAT_ALLOWED_ORIGINS` | see below — **must include the Cloud Run host** | `settings.ts:165`. While empty, the Origin check is advisory and CSP `frame-ancestors` stays `*`. Setting it tightens both. **Trap, hit 20 Aug 2026:** the built-in `/htg-agent` console page is served from the Cloud Run domain, so if that origin is missing the console's own calls to `/api/chat` and `/api/chat-session` return 403 and the widget shows "Sorry, I encountered an error." The storefront domains alone are not enough. |
| `CHAT_REQUIRE_TOKEN` | `false` for now | `settings.ts:168`. Leave off until the browser token round-trip is smoke-tested. |
| `CHAT_TOKEN_SECRET` | a long random string | `settings.ts:169`, no default. Set it now so the token round-trip can be tested later without another deploy. Only enforced when `CHAT_REQUIRE_TOKEN=true`. |
| `NODE_ENV` | `production` | Cloud Run normally sets this. It also switches trace logging off by default (`chatMessageTrace.ts:39-43`). |

## 5. Leave unset — the defaults are already correct

Setting these adds risk and gains nothing.

`DOTWMS_BASE_URL` · `DOTWMS_INSTANCE_CODE` (H2G) · `DOTWMS_EXPORT_FILE_TYPE`
(GenericSQL_1323) · `DOTWMS_ORDER_PREFIX` (BC-) · `DOTWMS_SYSPRO_PREFIX` (SO) ·
`MACHSHIP_BASE_URL` · `FREIGHT_PROVIDER` (dotwms) · `FREIGHT_LOOKBACK_DAYS` (60) ·
`FREIGHT_REQUIRE_VERIFIED_EMAIL` (true) · `ALERTS_DEDUP_TTL_MIN` (60) ·
`ALERTS_MAX_PER_HOUR` (50) · `CHAT_REQUIRE_ORIGIN` (true) · `CHAT_TOKEN_TTL_MIN` (60) ·
`CHAT_RATE_WINDOW_MS` (60000) · `CHAT_RATE_PER_IP` (20) · `CHAT_RATE_GLOBAL` (300) ·
`CHAT_MAX_MESSAGE_CHARS` (8000) · `CHAT_MAX_HISTORY` (50) · `CHAT_MAX_UPLOADS` (10) ·
`CHAT_MAX_UPLOAD_BYTES` (10485760) · `ZOHO_DATACENTER` (com.au) ·
`ZOHO_ACCOUNTS_HOST` / `ZOHO_DESK_HOST` (both derived from the datacenter)

## 6. Do NOT set in production

| Var | Why not |
|---|---|
| `MACHSHIP_USE_FIXTURE` | Returns canned fake tracking data. `fixture.ts:5-11` says "THIS IS NOT REAL DATA". Must stay absent. |
| `DOTWMS_TEST_ORDER` | Only read by `scripts/dotwms-access-check.mjs` and `chain-test.mjs`. |
| `DOTWMS_TEST_EMAIL` | Same — local diagnostics only. |
| `MACHSHIP_TOKEN_NAME` | **Dead key.** Not read anywhere in `lib/`, `app/` or `scripts/`. Safe to delete from `.env.local` too. |
| `ZOHO_PORTAL_ID` | **Not read by the app at all** — no reference in `lib/` or `app/`. Portal IDs come from agent config, not env. Scripts use it; the runtime doesn't. |
| `LANGCHAIN_API_KEY` / `LANGCHAIN_ENDPOINT` / `LANGCHAIN_PROJECT` | Only relevant if trace logging is on. `chatMessageTrace.ts:39-43` turns tracing off whenever `NODE_ENV=production` unless `ENABLE_CHAT_TRACE_LOGS=true`. Leave all four out unless you deliberately want LangSmith traces in prod. |
| `ENABLE_CHAT_TRACE_LOGS` | Leave unset. If you ever set it `true` in prod, note that customer messages are redacted before they reach LangSmith (`redactTraceInputs`), but you'd then also need the `LANGCHAIN_*` keys. |
| `ALERTS_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` | SMTP is the superseded fallback path. The chosen transport is the webhook. |
| `ALERTS_FROM` | **Dead config on the webhook path** — only the SMTP transport reads `message.from`. The real sender is the Gmail credential inside n8n. |
| `ALERTS_TO` | Ignored on the webhook path — the recipient is set in the n8n Gmail node, not here. |

## 7. Only if you use the report/export feature

`GOOGLE_DRIVE_FOLDER_ID` · `GOOGLE_SHEET_ID` · `GOOGLE_SHEET_TAB_NAME` — read by the
end-of-chat report and export routes. Not needed for the chat agent, order tracking or
alerts.

---

## The minimum set for this deployment

```
GEMINI_API_KEY=...
SITE_PASSWORD=...
GCP_PROJECT_ID=...
GCS_BUCKET_NAME=...
GCP_CLIENT_EMAIL=...
GCP_PRIVATE_KEY=...
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
ZOHO_ORG_ID=...

ORDER_TRACKING_ENABLED=true
DOTWMS_API_KEY=...
MACHSHIP_TOKEN=...

ALERTS_ENABLED=true
ALERTS_TRANSPORT=webhook
ALERTS_WEBHOOK_URL=https://membersaces.app.n8n.cloud/webhook/htg
ALERTS_WEBHOOK_SECRET=...

CHAT_ALLOWED_ORIGINS=https://goodness.com.au,https://www.goodness.com.au,https://sandbox-honest-to-goodness.mybigcommerce.com,https://aces-honest-to-goodness-agent-672026052958.australia-southeast2.run.app
CHAT_REQUIRE_TOKEN=false
CHAT_TOKEN_SECRET=...
```

Twenty variables. Everything else either has a correct default or belongs only on your
machine.

## After deploying, confirm the flag actually landed

The failure mode is silent: tracking looks fine but every lookup falls back to the old
deflection. Type a known-good order into the deployed widget and check you get a real
status, not "you can check the status of your order by visiting goodness.com.au".

## Symptom-to-cause quick reference

| What you see | Almost certainly |
|---|---|
| "Sorry, I encountered an error." on **every** message, including non-order ones | `CHAT_ALLOWED_ORIGINS` is missing the origin you're testing from — 403 on `/api/chat`. Check logs for `chat rejected: origin not allowed`. |
| Order lookups fall back to "visit goodness.com.au/order-status" | `ORDER_TRACKING_ENABLED` not set to `true` in this environment. |
| Alerts appear to succeed but no email arrives | `ALERTS_TRANSPORT` unset, so it defaulted to `log`. |
| Alert transport reports failure with no send | `ALERTS_WEBHOOK_SECRET` unset — the webhook transport fails closed rather than send PII unauthenticated. |
| Tracking returns plausible data for orders that shouldn't have it | `MACHSHIP_USE_FIXTURE=true` is set. Remove it. |
